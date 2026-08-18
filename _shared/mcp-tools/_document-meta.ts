/**
 * Document meta-facet cores + orchestrator (iteration 39, v1.10.0).
 *
 * The web document-save was the last multi-facet write not built on shared
 * cores: it raw-updated title (silently skipping the FTS refresh that title
 * boosting requires), raw-replaced metadata (bypassing the #212 merge
 * guards), replaced memberships with its own helper (no audit, no usage
 * log), and recorded one entry describing the REQUEST shape
 * ("title=false, metadata=true, projects=true") rather than what changed.
 *
 * These cores are the single implementation for each facet; the orchestrator
 * sequences them for surfaces (web today) that edit several facets in one
 * user action. Deliberately NO combined audit entry: per-facet entries are
 * the house pattern (iteration 33 — the trail distinguishes what happened),
 * and each core emits the same description regardless of interface. Every
 * facet diffs against the STORED value first — a facet the request carried
 * but did not change is skipped entirely, so the trail never records
 * non-events.
 */

import type { AccessPath, MCPSupabaseClient } from "./types.ts";

import { logUsage } from "./_utils.ts";

export interface FacetActor {
  author: string;
  authorType: string;
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

/**
 * Change a document's title: table write + `cerefox_update_chunk_fts`
 * refresh (title boosting bakes the title into every current chunk's FTS
 * vector at weight A) + a factual audit entry. Semantic embeddings pick the
 * new title up on the next content update / reindex — the documented,
 * deliberate deferral both surfaces share. No-op (with no trail entry) when
 * the title is unchanged.
 */
export async function changeDocumentTitle(
  supabase: MCPSupabaseClient,
  documentId: string,
  newTitle: string,
  who: FacetActor,
): Promise<{ changed: boolean; title: string }> {
  const trimmed = (newTitle ?? "").trim();
  if (!trimmed) throw new Error("Title cannot be empty.");

  const { data: doc, error: readErr } = await supabase
    .from("cerefox_documents")
    .select("title")
    .eq("id", documentId)
    .limit(1);
  if (readErr) throw new Error(`Title read failed: ${readErr.message}`);
  if (!doc?.length) throw new Error(`Document not found: ${documentId}`);
  const oldTitle = doc[0].title as string;
  if (oldTitle === trimmed) return { changed: false, title: oldTitle };

  const { error: updErr } = await supabase
    .from("cerefox_documents")
    .update({ title: trimmed, updated_at: new Date().toISOString() })
    .eq("id", documentId);
  if (updErr) throw new Error(`Title update failed: ${updErr.message}`);

  const { error: ftsErr } = await supabase.rpc("cerefox_update_chunk_fts", {
    p_document_id: documentId,
    p_new_title: trimmed,
  });
  if (ftsErr) {
    throw new Error(`Title updated but FTS refresh failed: ${ftsErr.message}`);
  }

  const { error: auditErr } = await supabase.rpc("cerefox_create_audit_entry", {
    p_document_id: documentId,
    p_operation: "update-metadata",
    p_author: who.author,
    p_author_type: who.authorType,
    p_description: `Title changed: '${oldTitle}' → '${trimmed}'`,
  });
  if (auditErr) console.warn("changeDocumentTitle: audit entry failed", auditErr.message);

  return { changed: true, title: trimmed };
}

/**
 * Replace a document's project memberships from project IDS (the web UI's
 * currency; the name-based twin `replaceDocumentProjects` serves MCP/CLI).
 * Validates every id BEFORE the destructive replace — proceeding with a
 * partial set would drop memberships the caller asked to keep — and emits
 * the same audit description as the name path. No-op when the set is
 * unchanged.
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

  const { data: current, error: curErr } = await supabase
    .from("cerefox_document_projects")
    .select("project_id")
    .eq("document_id", opts.documentId);
  if (curErr) throw new Error(`Membership read failed: ${curErr.message}`);
  const currentSet = new Set((current ?? []).map((r: { project_id: string }) => r.project_id));
  if (wanted.length === currentSet.size && wanted.every((id) => currentSet.has(id))) {
    return { changed: false, names: [] };
  }

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
      throw new Error(`Unknown project id(s): ${missing.join(", ")} — memberships left unchanged.`);
    }
    names = wanted.map((id) => byId.get(id)!);
  }

  const { error: delErr } = await supabase
    .from("cerefox_document_projects")
    .delete()
    .eq("document_id", opts.documentId);
  if (delErr) throw new Error(`Membership replace failed: ${delErr.message}`);
  if (wanted.length > 0) {
    const rows = wanted.map((pid) => ({ document_id: opts.documentId, project_id: pid }));
    const { error: insErr } = await supabase.from("cerefox_document_projects").insert(rows);
    if (insErr) throw new Error(`Membership replace failed: ${insErr.message}`);
  }

  const { error: auditErr } = await supabase.rpc("cerefox_create_audit_entry", {
    p_document_id: opts.documentId,
    p_version_id: null,
    p_operation: "update-metadata",
    p_author: who(opts).author,
    p_author_type: who(opts).authorType,
    p_size_before: null,
    p_size_after: null,
    p_description:
      names.length > 0
        ? `Set document projects to [${names.join(", ")}]`
        : "Cleared all project memberships",
  });
  if (auditErr) console.warn("setDocumentProjectsByIds: audit entry failed", auditErr.message);

  logUsage(supabase, {
    operation: "set-document-projects",
    accessPath: opts.accessPath,
    requestor: opts.author,
    document_id: opts.documentId,
  });

  return { changed: true, names };
}

function who(o: FacetActor): FacetActor {
  return { author: o.author, authorType: o.authorType };
}

export interface FacetUpdateResult {
  titleChanged: boolean;
  metadataChanged: boolean;
  projectsChanged: boolean;
}

/**
 * Orchestrate a multi-facet document meta update (title / metadata /
 * memberships) for surfaces that edit them in one user action. Sequencing
 * wrapper ONLY: each facet applies through its single implementation and
 * writes its own audit entry — there is deliberately no combined entry and
 * no new description style. Facets the request carries unchanged are
 * skipped silently.
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

  if (opts.title !== undefined) {
    const r = await changeDocumentTitle(supabase, opts.documentId, opts.title, who(opts));
    result.titleChanged = r.changed;
  }

  if (opts.metadata !== undefined) {
    const { data: doc, error } = await supabase
      .from("cerefox_documents")
      .select("metadata")
      .eq("id", opts.documentId)
      .limit(1);
    if (error) throw new Error(`Metadata read failed: ${error.message}`);
    if (!doc?.length) throw new Error(`Document not found: ${opts.documentId}`);
    const stored = doc[0].metadata ?? {};
    if (stableStringify(stored) !== stableStringify(opts.metadata)) {
      // Replace mode: the save surface edits the whole object. The RPC
      // carries the #212 guards and writes its own per-key audit report.
      const { error: rpcErr } = await supabase.rpc("cerefox_set_document_metadata", {
        p_document_id: opts.documentId,
        p_metadata: opts.metadata,
        p_replace: true,
        p_author: opts.author,
        p_author_type: opts.authorType,
      });
      if (rpcErr) throw new Error(`Metadata update failed: ${rpcErr.message}`);
      result.metadataChanged = true;
    }
  }

  if (opts.projectIds !== undefined) {
    const r = await setDocumentProjectsByIds(supabase, {
      documentId: opts.documentId,
      projectIds: opts.projectIds,
      author: opts.author,
      authorType: opts.authorType,
      accessPath: opts.accessPath,
    });
    result.projectsChanged = r.changed;
  }

  return result;
}
