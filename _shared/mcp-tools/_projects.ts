/**
 * Project-membership helpers shared by the `ingest` and
 * `set-document-projects` tools.
 *
 * Two semantics are needed by callers:
 *
 * - **Non-destructive add** (`ensureDocumentInProject`): used when an ingest
 *   call supplies a singular `project_name`. Resolves (or creates) the
 *   project, then ensures the `(document, project)` row exists. Idempotent;
 *   does NOT remove any existing memberships. Per issue #38: the v0.1.20
 *   fix that stopped agent updates from silently wiping operator-curated
 *   memberships.
 *
 * - **Destructive replace** (`setDocumentProjectsByName`): used when a call
 *   supplies an explicit `project_names` list (or via the dedicated
 *   `cerefox_set_document_projects` tool). DELETE-then-INSERT replaces the
 *   document's memberships with exactly the given set.
 *
 * Both call sites need consistent name resolution (case-insensitive
 * `ilike` match against `cerefox_projects.name`); centralising here
 * prevents drift.
 */

import type { AccessPath, MCPSupabaseClient } from "./types.ts";

import { applyMembershipReplace } from "./_document-meta.ts";
import { storeWriteRemediation } from "./_utils.ts";

/** Who to attribute an implicit/explicit project write to in the audit log. */
export interface ProjectAuditContext {
  author: string;
  authorType: string;
}

/**
 * Resolve (or create) a project by name via cerefox_create_project with
 * p_if_exists='return' — the single implementation (0.14.0, #219): the RPC
 * audits an actual creation in the SAME transaction as the insert, and an
 * existing project is returned untouched with no audit entry. Returns the
 * project id, or null on failure (best-effort, matching the historical
 * posture of the assignment paths).
 */
export interface ResolvedProject {
  projectId: string;
  projectName: string;
}

export async function resolveOrCreateProject(
  supabase: MCPSupabaseClient,
  projectName: string,
  audit?: ProjectAuditContext,
): Promise<ResolvedProject | null> {
  const { data, error } = await supabase.rpc("cerefox_create_project", {
    p_name: projectName,
    p_description: "",
    p_author: audit?.author ?? "unknown",
    p_author_type: audit?.authorType ?? "agent",
    p_if_exists: "return",
  });
  if (error) {
    // Deployment-state failures must be LOUD: swallowing them here is what
    // turned a version skew into a membership wipe downstream (round-4
    // verifier — the destructive replace ran after every resolution
    // silently nulled out). Anything else stays best-effort.
    const remediation = storeWriteRemediation(error.message ?? "", "cerefox_create_project");
    if (remediation) throw new Error(`Project resolution failed for '${projectName}': ${remediation}`);
    console.warn("resolveOrCreateProject: RPC failed", error);
    return null;
  }
  const row = (data as Array<{ project_id?: string; project_name?: string }> | null)?.[0];
  return row?.project_id ? { projectId: row.project_id, projectName: row.project_name ?? projectName } : null;
}

/** Ensure `(documentId, project)` exists. Resolves project by name
 *  (case-insensitive); creates the project if missing. Idempotent.
 *  Returns the resolved project_id, or `null` if creation failed.
 *  Pass `audit` so an implicit creation lands in the audit trail
 *  attributed to the write that caused it (0.14.0). */
export async function ensureDocumentInProject(
  supabase: MCPSupabaseClient,
  documentId: string,
  projectName: string,
  audit?: ProjectAuditContext,
): Promise<string | null> {
  const resolved = await resolveOrCreateProject(supabase, projectName, audit);
  const projectId = resolved?.projectId ?? null;
  if (!projectId) return null;

  const { data: existing } = await supabase
    .from("cerefox_document_projects")
    .select("document_id")
    .eq("document_id", documentId)
    .eq("project_id", projectId)
    .limit(1);
  if (existing?.length) return projectId;

  const { error: insertErr } = await supabase
    .from("cerefox_document_projects")
    .insert({ document_id: documentId, project_id: projectId });
  if (insertErr && !String(insertErr.message ?? "").includes("duplicate key")) {
    console.warn("ensureDocumentInProject: insert failed", insertErr);
  }
  return projectId;
}

/** DELETE-then-INSERT replacement of a document's project memberships.
 *  Resolves each name → project_id (creating if absent); preserves order.
 *  Empty `projectNames` clears all memberships. Returns the resolved
 *  project_ids in input order. */
export async function setDocumentProjectsByName(
  supabase: MCPSupabaseClient,
  documentId: string,
  projectNames: string[],
  audit?: ProjectAuditContext,
): Promise<string[]> {
  // Resolve EVERYTHING before touching memberships (concurrently — the
  // names are independent), and abort if any requested name failed to
  // resolve: proceeding would wipe memberships the caller asked to keep.
  const wanted = projectNames.filter((n) => !!n);
  const resolved = await Promise.all(wanted.map((n) => resolveOrCreateProject(supabase, n, audit)));
  const failed = wanted.filter((_, i) => !resolved[i]);
  if (failed.length > 0) {
    throw new Error(
      `Could not resolve project(s): ${failed.join(", ")} — memberships left unchanged.`,
    );
  }
  const projectIds = resolved.map((r) => r!.projectId);

  await supabase
    .from("cerefox_document_projects")
    .delete()
    .eq("document_id", documentId);
  if (projectIds.length > 0) {
    const rows = projectIds.map((pid) => ({ document_id: documentId, project_id: pid }));
    await supabase.from("cerefox_document_projects").insert(rows);
  }
  return projectIds;
}

export interface ReplaceDocumentProjectsResult {
  documentTitle: string;
  /** Names after stripping blanks + case-insensitive dedup, in input order. */
  cleanNames: string[];
  projectIds: string[];
}

/**
 * Full-set replace of a document's project memberships, with audit + usage
 * logging. The shared core behind both the `cerefox_set_document_projects`
 * MCP tool and the `cerefox document set-projects` CLI command, so the two
 * behave identically.
 *
 * Cleans the incoming names (strip blanks, preserve order, case-insensitive
 * dedup), verifies the document exists and isn't soft-deleted, resolves each
 * name → project_id (creating the project if absent), then DELETE-then-INSERT
 * replaces the membership set. An empty (or all-blank) list clears all
 * memberships. Writes an `update-metadata` audit entry (content is untouched)
 * and a usage-log entry.
 *
 * Throws if the document is missing or soft-deleted. Callers validate
 * argument *shape* (e.g. that `projectNames` is an array of strings).
 */
export async function replaceDocumentProjects(
  supabase: MCPSupabaseClient,
  opts: {
    documentId: string;
    projectNames: string[];
    author: string;
    authorType: string;
    accessPath: AccessPath;
  },
): Promise<ReplaceDocumentProjectsResult> {
  const { documentId, projectNames, author, authorType, accessPath } = opts;

  // Strip empties; preserve order; dedup case-insensitively.
  const seenLower = new Set<string>();
  const cleanNames: string[] = [];
  for (const n of projectNames) {
    const stripped = (n ?? "").trim();
    if (!stripped) continue;
    const key = stripped.toLowerCase();
    if (seenLower.has(key)) continue;
    seenLower.add(key);
    cleanNames.push(stripped);
  }

  // Verify the document exists and isn't soft-deleted.
  const { data: doc } = await supabase
    .from("cerefox_documents")
    .select("id, title")
    .eq("id", documentId)
    .is("deleted_at", null)
    .limit(1);
  if (!doc?.length) {
    throw new Error(`Document not found (or soft-deleted): ${documentId}`);
  }

  // Resolve each name → project_id (create if absent) CONCURRENTLY, and
  // abort before the destructive replace if any name failed to resolve —
  // wiping memberships because resolution errored is the round-4 wipe bug.
  const resolved = await Promise.all(
    cleanNames.map((name) => resolveOrCreateProject(supabase, name, { author, authorType })),
  );
  const failed = cleanNames.filter((_, i) => !resolved[i]);
  if (failed.length > 0) {
    throw new Error(
      `Could not resolve project(s): ${failed.join(", ")} — memberships left unchanged.`,
    );
  }
  const projectIds = resolved.map((r) => r!.projectId);

  // Delegate the replace + audit + usage-log tail to the shared core
  // (review round 1: the id-based twin had a drifting copy). Unified
  // semantics: an unchanged set is a complete no-op with NO audit entry —
  // the trail never records non-events (this changes the previously
  // always-logging behavior of this path, deliberately).
  await applyMembershipReplace(supabase, {
    documentId,
    projectIds,
    projectNames: cleanNames,
    accessPath,
    author,
    authorType,
  });

  return { documentTitle: doc[0].title as string, cleanNames, projectIds };
}

/** Resolve a project name → project_id (case-insensitive), or `null` if
 *  not found. Does NOT create. Used by search / metadata-search to translate
 *  `project_name` parameters to UUIDs. */
export async function lookupProjectId(
  supabase: MCPSupabaseClient,
  projectName: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("cerefox_projects")
    .select("id")
    .ilike("name", projectName)
    .limit(1);
  if (error || !data?.length) return null;
  return data[0].id;
}
