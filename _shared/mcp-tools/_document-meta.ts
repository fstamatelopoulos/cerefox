/**
 * Document meta-facet cores + orchestrator (iteration 39, v1.10.0).
 *
 * The web document-save was the last multi-facet write not built on shared
 * cores: it raw-updated title (silently skipping the FTS refresh that title
 * boosting requires), raw-replaced metadata (bypassing the #212 merge
 * guards), replaced memberships with its own helper (no audit, no usage
 * log), and recorded one entry describing the REQUEST shape rather than
 * what changed.
 *
 * These cores are the single implementation for each facet; the orchestrator
 * sequences them for surfaces (web today) that edit several facets in one
 * user action. Deliberately NO combined audit entry: per-facet entries are
 * the house pattern (iteration 33 — the trail distinguishes what happened),
 * and each core emits the same description regardless of interface. Every
 * facet diffs against the STORED value first — a facet the request carried
 * but did not change is skipped entirely, so the trail never records
 * non-events.
 *
 * Errors are TYPED (review round 1): callers map FacetNotFoundError → 404 /
 * notFound and FacetValidationError → 400 / userError without string-matching
 * prose that another module owns.
 */

import type { AccessPath, MCPSupabaseClient } from "./types.ts";

import { logUsage, storeWriteRemediation } from "./_utils.ts";

export interface FacetActor {
  author: string;
  authorType: string;
}

/** The document (or a referenced project) does not exist or is in the trash. */
export class FacetNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FacetNotFoundError";
  }
}

/** The request is well-formed but fails a semantic check the caller can fix. */
export class FacetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FacetValidationError";
  }
}

/** Key-order-independent JSONB-style equality for metadata objects. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Replace-mode normalization mirroring the RPC: a null value means
 *  "remove this key", so null-valued keys vanish before comparison —
 *  otherwise a request that NORMALIZES to the stored value would fire the
 *  RPC and record a non-change (review round 1). */
export function normalizeMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== null) out[k] = v;
  }
  return out;
}

/**
 * Rename a document — a thin wrapper over `cerefox_rename_document`
 * (0.15.0), which commits the row update, the chunk-FTS refresh (title
 * boosting), and the audit entry in ONE transaction. The client-side
 * sequencing this replaces could commit the rename and then fail the
 * refresh, leaving the document ranking under its old title with no retry
 * path. Unchanged title → RPC-side no-op, no entry.
 */
export async function changeDocumentTitle(
  supabase: MCPSupabaseClient,
  documentId: string,
  newTitle: string,
  who: FacetActor,
): Promise<{ changed: boolean; title: string }> {
  const trimmed = (newTitle ?? "").trim();
  if (!trimmed) throw new FacetValidationError("Title cannot be empty.");

  const { data, error } = await supabase.rpc("cerefox_rename_document", {
    p_document_id: documentId,
    p_new_title: trimmed,
    p_author: who.author,
    p_author_type: who.authorType,
  });
  if (error) {
    const msg = error.message ?? String(error);
    if (/not found/i.test(msg)) throw new FacetNotFoundError(msg);
    if (/cannot be empty/i.test(msg)) throw new FacetValidationError(msg);
    // 0.15.0 grew the server surface; against a 0.14.x server the RPC is
    // absent — say "redeploy", with the shared remediation prose.
    const remediation = storeWriteRemediation(msg, "cerefox_rename_document");
    if (remediation) throw new Error(`Title update failed: ${remediation}`);
    throw new Error(`Title update failed: ${msg}`);
  }
  const row = (data as Array<{ renamed: boolean; new_title: string }> | null)?.[0];
  return { changed: row?.renamed ?? false, title: row?.new_title ?? trimmed };
}

/**
 * The shared replace + audit + usage-log tail used by BOTH membership twins
 * (ids here, names in `replaceDocumentProjects`) — review round 1 caught the
 * two carrying drifting copies. Unified semantics: an unchanged set is a
 * complete no-op (no entry — the trail never records non-events; this also
 * changes the previously always-logging name path).
 */
export async function applyMembershipReplace(
  supabase: MCPSupabaseClient,
  opts: {
    documentId: string;
    projectIds: string[];
    projectNames: string[];
    accessPath: AccessPath;
  } & FacetActor,
): Promise<{ changed: boolean }> {
  const { data: current, error: curErr } = await supabase
    .from("cerefox_document_projects")
    .select("project_id")
    .eq("document_id", opts.documentId);
  if (curErr) throw new Error(`Membership read failed: ${curErr.message}`);
  const currentSet = new Set((current ?? []).map((r: { project_id: string }) => r.project_id));
  if (
    opts.projectIds.length === currentSet.size &&
    opts.projectIds.every((id) => currentSet.has(id))
  ) {
    return { changed: false };
  }

  const { error: delErr } = await supabase
    .from("cerefox_document_projects")
    .delete()
    .eq("document_id", opts.documentId);
  if (delErr) throw new Error(`Membership replace failed: ${delErr.message}`);
  if (opts.projectIds.length > 0) {
    const rows = opts.projectIds.map((pid) => ({
      document_id: opts.documentId,
      project_id: pid,
    }));
    const { error: insErr } = await supabase.from("cerefox_document_projects").insert(rows);
    if (insErr) throw new Error(`Membership replace failed: ${insErr.message}`);
  }

  const { error: auditErr } = await supabase.rpc("cerefox_create_audit_entry", {
    p_document_id: opts.documentId,
    p_version_id: null,
    p_operation: "update-metadata",
    p_author: opts.author,
    p_author_type: opts.authorType,
    p_size_before: null,
    p_size_after: null,
    p_description:
      opts.projectNames.length > 0
        ? `Set document projects to [${opts.projectNames.join(", ")}]`
        : "Cleared all project memberships",
  });
  if (auditErr) console.warn("applyMembershipReplace: audit entry failed", auditErr.message);

  logUsage(supabase, {
    operation: "set-document-projects",
    accessPath: opts.accessPath,
    requestor: opts.author,
    document_id: opts.documentId,
    result_count: opts.projectIds.length,
  });

  return { changed: true };
}

/** Guard shared by the facet writes: the document must exist and not be in
 *  the trash (a trashed document is immutable until restored — 0.12.0). */
async function assertDocumentLive(
  supabase: MCPSupabaseClient,
  documentId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("cerefox_documents")
    .select("id")
    .eq("id", documentId)
    .is("deleted_at", null)
    .limit(1);
  if (error) throw new Error(`Document read failed: ${error.message}`);
  if (!data?.length) {
    throw new FacetNotFoundError(`Document not found (or in the trash): ${documentId}`);
  }
}

/**
 * Replace a document's project memberships from project IDS (the web UI's
 * currency; the name-based twin `replaceDocumentProjects` serves MCP/CLI and
 * delegates to the same tail). Validates the document and every id BEFORE
 * the destructive replace. No-op when the set is unchanged.
 */
export async function setDocumentProjectsByIds(
  supabase: MCPSupabaseClient,
  opts: {
    documentId: string;
    projectIds: string[];
    accessPath: AccessPath;
  } & FacetActor,
): Promise<{ changed: boolean; names: string[] }> {
  const wanted = [...new Set(opts.projectIds)];

  // Diff FIRST: an unchanged set is a complete no-op and needs no
  // validation (its ids provably exist — they are current memberships).
  const { data: current, error: curErr } = await supabase
    .from("cerefox_document_projects")
    .select("project_id")
    .eq("document_id", opts.documentId);
  if (curErr) throw new Error(`Membership read failed: ${curErr.message}`);
  const currentSet = new Set((current ?? []).map((r: { project_id: string }) => r.project_id));
  if (wanted.length === currentSet.size && wanted.every((id) => currentSet.has(id))) {
    return { changed: false, names: [] };
  }

  await assertDocumentLive(supabase, opts.documentId);

  let names: string[] = [];
  if (wanted.length > 0) {
    const { data: found, error: valErr } = await supabase
      .from("cerefox_projects")
      .select("id, name")
      .in("id", wanted);
    if (valErr) throw new Error(`Project validation failed: ${valErr.message}`);
    const byId = new Map<string, string>(
      (found ?? []).map((r: { id: string; name: string }) => [r.id, r.name] as [string, string]),
    );
    const missing = wanted.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new FacetValidationError(
        `Unknown project id(s): ${missing.join(", ")} — memberships left unchanged.`,
      );
    }
    names = wanted.map((id) => byId.get(id)!);
  }

  const r = await applyMembershipReplace(supabase, {
    documentId: opts.documentId,
    projectIds: wanted,
    projectNames: names,
    accessPath: opts.accessPath,
    author: opts.author,
    authorType: opts.authorType,
  });
  return { changed: r.changed, names };
}

export interface FacetUpdateResult {
  titleChanged: boolean;
  metadataChanged: boolean;
  projectsChanged: boolean;
}

/** Thrown when a later facet fails after earlier ones committed: carries
 *  what DID apply so the surface can report the partial state honestly
 *  (the facets are separate transactions by design — full cross-facet
 *  atomicity would need one mega-RPC for three loosely related writes). */
export class FacetUpdateError extends Error {
  applied: FacetUpdateResult;
  cause2: Error;
  constructor(applied: FacetUpdateResult, cause: Error) {
    const done = [
      applied.metadataChanged ? "metadata" : null,
      applied.projectsChanged ? "projects" : null,
      applied.titleChanged ? "title" : null,
    ].filter(Boolean);
    super(
      done.length > 0
        ? `${cause.message} (already applied before the failure: ${done.join(", ")})`
        : cause.message,
    );
    this.name = "FacetUpdateError";
    this.applied = applied;
    this.cause2 = cause;
  }
}

/**
 * Orchestrate a multi-facet document meta update (metadata / memberships /
 * title) for surfaces that edit them in one user action. Sequencing wrapper
 * ONLY: each facet applies through its single implementation and writes its
 * own audit entry — deliberately no combined entry. Order runs from the
 * facet most likely to be rejected (metadata: free-form user input) to the
 * least (title: one atomic RPC), minimizing partial application; a mid-way
 * failure raises FacetUpdateError naming what already committed.
 */
export async function updateDocumentFacets(
  supabase: MCPSupabaseClient,
  opts: {
    documentId: string;
    title?: string;
    metadata?: Record<string, unknown>;
    projectIds?: string[];
    accessPath: AccessPath;
  } & FacetActor,
): Promise<FacetUpdateResult> {
  const result: FacetUpdateResult = {
    titleChanged: false,
    metadataChanged: false,
    projectsChanged: false,
  };
  const who: FacetActor = { author: opts.author, authorType: opts.authorType };

  const step = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      throw err instanceof FacetUpdateError
        ? err
        : new FacetUpdateError(result, err instanceof Error ? err : new Error(String(err)));
    }
  };

  if (opts.metadata !== undefined) {
    await step(async () => {
      const { data: doc, error } = await supabase
        .from("cerefox_documents")
        .select("metadata")
        .eq("id", opts.documentId)
        .is("deleted_at", null)
        .limit(1);
      if (error) throw new Error(`Metadata read failed: ${error.message}`);
      if (!doc?.length) {
        throw new FacetNotFoundError(`Document not found (or in the trash): ${opts.documentId}`);
      }
      const stored = (doc[0].metadata ?? {}) as Record<string, unknown>;
      const wanted = normalizeMetadata(opts.metadata!);
      if (stableStringify(stored) !== stableStringify(wanted)) {
        // Replace mode: the save surface edits the whole object (an empty
        // object CLEARS all keys — "remove the last key" must not be a
        // silent no-op). The RPC carries the #212 guards and writes its own
        // per-key audit report.
        const { error: rpcErr } = await supabase.rpc("cerefox_set_document_metadata", {
          p_document_id: opts.documentId,
          p_metadata: wanted,
          p_replace: true,
          p_author: opts.author,
          p_author_type: opts.authorType,
        });
        if (rpcErr) {
          const msg = rpcErr.message ?? String(rpcErr);
          if (/not found/i.test(msg)) throw new FacetNotFoundError(msg);
          throw new Error(`Metadata update failed: ${msg}`);
        }
        result.metadataChanged = true;
      }
    });
  }

  if (opts.projectIds !== undefined) {
    await step(async () => {
      const r = await setDocumentProjectsByIds(supabase, {
        documentId: opts.documentId,
        projectIds: opts.projectIds!,
        accessPath: opts.accessPath,
        ...who,
      });
      result.projectsChanged = r.changed;
    });
  }

  if (opts.title !== undefined) {
    await step(async () => {
      const r = await changeDocumentTitle(supabase, opts.documentId, opts.title!, who);
      result.titleChanged = r.changed;
    });
  }

  return result;
}
