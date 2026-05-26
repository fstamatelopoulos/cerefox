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

import type { SupabaseClient } from "@supabase/supabase-js";

/** Ensure `(documentId, project)` exists. Resolves project by name
 *  (case-insensitive); creates the project if missing. Idempotent.
 *  Returns the resolved project_id, or `null` if creation failed. */
export async function ensureDocumentInProject(
  supabase: SupabaseClient,
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
  supabase: SupabaseClient,
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

/** Resolve a project name → project_id (case-insensitive), or `null` if
 *  not found. Does NOT create. Used by search / metadata-search to translate
 *  `project_name` parameters to UUIDs. */
export async function lookupProjectId(
  supabase: SupabaseClient,
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
