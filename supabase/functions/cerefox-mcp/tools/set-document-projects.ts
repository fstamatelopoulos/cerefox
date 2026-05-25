// ── cerefox_set_document_projects tool handler ────────────────────────────
//
// Destructive replace of a document's project memberships. Mirror of the
// Python CerefoxClient.set_document_projects + _handle_set_document_projects.
//
// Inputs: document_id (UUID), project_names (string[]), optional author.
//
// Semantics:
//   - Verifies the document exists and isn't soft-deleted.
//   - Resolves each project name to a project_id, creating projects that
//     don't exist (case-insensitive name match against cerefox_projects).
//   - DELETE-then-INSERT replace on cerefox_document_projects → exactly the
//     listed projects remain.
//   - Empty list = clear all memberships.
//   - Logs an audit entry with operation="update-metadata" (project
//     membership is metadata, not content).
//   - Returns a human-readable summary; the document's content is untouched.
//
// Use cases (per AGENT_GUIDE.md):
//   - Agent wants to change project membership without rewriting the doc.
//   - Agent wants to add a doc to multiple projects at once (cleaner than N
//     ingest calls).
//   - Operator wants to consolidate / clean up project membership via an
//     agent without touching content.

import { makeSupabaseClient, logUsage } from "../shared.ts";

export async function handleSetDocumentProjects(
  args: Record<string, unknown>,
): Promise<string> {
  const document_id = (args.document_id as string | undefined)?.trim();
  const project_names_raw = args.project_names;
  const author = (args.author as string | undefined) ?? "mcp-agent";

  if (!document_id) {
    throw new Error(
      "Missing required argument: document_id (UUID from a prior cerefox_search result).",
    );
  }
  if (project_names_raw === undefined || project_names_raw === null
      || !Array.isArray(project_names_raw)) {
    throw new Error(
      "Missing or invalid argument: project_names must be a JSON array of strings "
      + "(empty array allowed to clear all memberships).",
    );
  }
  if (!project_names_raw.every((n) => typeof n === "string")) {
    throw new Error("project_names must contain only strings.");
  }

  // Strip empties; preserve order; dedup case-insensitively.
  const seenLower = new Set<string>();
  const cleanNames: string[] = [];
  for (const n of project_names_raw as string[]) {
    const stripped = n.trim();
    if (!stripped) continue;
    const key = stripped.toLowerCase();
    if (seenLower.has(key)) continue;
    seenLower.add(key);
    cleanNames.push(stripped);
  }

  const supabase = makeSupabaseClient();

  // Verify the document exists and isn't soft-deleted.
  const { data: doc } = await supabase
    .from("cerefox_documents")
    .select("id, title")
    .eq("id", document_id)
    .is("deleted_at", null)
    .limit(1);
  if (!doc?.length) {
    throw new Error(`Document not found (or soft-deleted): ${document_id}`);
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
  await supabase
    .from("cerefox_document_projects")
    .delete()
    .eq("document_id", document_id);
  if (projectIds.length > 0) {
    const rows = projectIds.map((pid) => ({ document_id, project_id: pid }));
    await supabase.from("cerefox_document_projects").insert(rows);
  }

  // Audit entry — project membership is metadata, not content.
  try {
    await supabase.rpc("cerefox_create_audit_entry", {
      p_document_id: document_id,
      p_version_id: null,
      p_operation: "update-metadata",
      p_author: author,
      p_author_type: "agent",
      p_size_before: null,
      p_size_after: null,
      p_description: cleanNames.length > 0
        ? `Set document projects to [${cleanNames.join(", ")}]`
        : "Cleared all project memberships",
    });
  } catch (err) {
    console.warn("set-document-projects: audit entry failed", err);
  }

  // Usage log.
  logUsage(supabase, {
    operation: "set-document-projects",
    requestor: author,
    document_id,
    result_count: projectIds.length,
  });

  if (cleanNames.length === 0) {
    return (
      `Cleared all project memberships for document ${document_id}. `
      + "The document no longer belongs to any project."
    );
  }
  return (
    `Set project memberships for document ${document_id}:\n`
    + `  Projects (${cleanNames.length}): ${cleanNames.join(", ")}\n`
    + `  Project IDs: ${projectIds.join(", ")}\n`
    + "  Note: this REPLACED the previous membership set. Any projects not "
    + "listed above are no longer associated with this document."
  );
}
