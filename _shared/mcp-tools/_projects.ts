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

import { logUsage } from "./_utils.ts";

/** Ensure `(documentId, project)` exists. Resolves project by name
 *  (case-insensitive); creates the project if missing. Idempotent.
 *  Returns the resolved project_id, or `null` if creation failed. */
export async function ensureDocumentInProject(
  supabase: MCPSupabaseClient,
  documentId: string,
  projectName: string,
): Promise<string | null> {
  let projectId: string | null = null;
  const { data: proj } = await supabase
    .from("cerefox_projects")
    .select("id")
    .ilike("name", projectName)
    .limit(1);
  if (proj?.length) {
    projectId = proj[0].id;
  } else {
    const { data: newProj } = await supabase
      .from("cerefox_projects")
      .insert({ name: projectName })
      .select("id");
    projectId = newProj?.[0]?.id ?? null;
  }
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
): Promise<string[]> {
  const projectIds: string[] = [];
  for (const name of projectNames) {
    if (!name) continue;
    const { data: proj } = await supabase
      .from("cerefox_projects")
      .select("id")
      .ilike("name", name)
      .limit(1);
    if (proj?.length) {
      projectIds.push(proj[0].id);
    } else {
      const { data: newProj } = await supabase
        .from("cerefox_projects")
        .insert({ name })
        .select("id");
      if (newProj?.[0]?.id) projectIds.push(newProj[0].id);
    }
  }

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

  // Resolve each name → project_id (create if absent). Preserve order.
  const projectIds: string[] = [];
  for (const name of cleanNames) {
    const { data: proj } = await supabase
      .from("cerefox_projects")
      .select("id")
      .ilike("name", name)
      .limit(1);
    if (proj?.length) {
      projectIds.push(proj[0].id);
    } else {
      const { data: newProj } = await supabase
        .from("cerefox_projects")
        .insert({ name })
        .select("id");
      if (newProj?.[0]?.id) projectIds.push(newProj[0].id);
    }
  }

  // DELETE-then-INSERT replace (matches Python assign_document_projects).
  await supabase.from("cerefox_document_projects").delete().eq("document_id", documentId);
  if (projectIds.length > 0) {
    const rows = projectIds.map((pid) => ({ document_id: documentId, project_id: pid }));
    await supabase.from("cerefox_document_projects").insert(rows);
  }

  // Audit entry — project membership is metadata, not content.
  try {
    await supabase.rpc("cerefox_create_audit_entry", {
      p_document_id: documentId,
      p_version_id: null,
      p_operation: "update-metadata",
      p_author: author,
      p_author_type: authorType,
      p_size_before: null,
      p_size_after: null,
      p_description:
        cleanNames.length > 0
          ? `Set document projects to [${cleanNames.join(", ")}]`
          : "Cleared all project memberships",
    });
  } catch (err) {
    console.warn("replaceDocumentProjects: audit entry failed", err);
  }

  logUsage(supabase, {
    operation: "set-document-projects",
    accessPath,
    requestor: author,
    document_id: documentId,
    result_count: projectIds.length,
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
