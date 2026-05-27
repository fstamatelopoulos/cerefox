/**
 * `cerefox_set_document_projects` — destructive replace of a document's
 * project memberships. Empty list clears all memberships. Logged as
 * `update-metadata` in the audit log; document content is untouched.
 *
 * Mirrors Python `CerefoxClient.set_document_projects` +
 * `_handle_set_document_projects`. v0.1.20 introduced this tool to give
 * agents an explicit full-set primitive without rewriting content (issue
 * #38, Part 4).
 */

import type { MCPSupabaseClient } from "./types.js";

import { logUsage } from "./_utils.js";
import { McpInvalidParams, type ToolContext, type ToolDefinition } from "./types.js";

async function handler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const document_id = (args.document_id as string | undefined)?.trim();
  const project_names_raw = args.project_names;
  const author = (args.author as string | undefined) ?? "mcp-agent";

  if (!document_id) {
    throw new McpInvalidParams(
      "Missing required argument: document_id (UUID from a prior cerefox_search result).",
    );
  }
  if (
    project_names_raw === undefined ||
    project_names_raw === null ||
    !Array.isArray(project_names_raw)
  ) {
    throw new McpInvalidParams(
      "Missing or invalid argument: project_names must be a JSON array of strings " +
        "(empty array allowed to clear all memberships).",
    );
  }
  if (!project_names_raw.every((n) => typeof n === "string")) {
    throw new McpInvalidParams("project_names must contain only strings.");
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
  await supabase.from("cerefox_document_projects").delete().eq("document_id", document_id);
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
      p_description:
        cleanNames.length > 0
          ? `Set document projects to [${cleanNames.join(", ")}]`
          : "Cleared all project memberships",
    });
  } catch (err) {
    console.warn("set-document-projects: audit entry failed", err);
  }

  logUsage(supabase, {
    operation: "set-document-projects",
    accessPath: ctx.accessPath,
    requestor: author,
    document_id,
    result_count: projectIds.length,
  });

  if (cleanNames.length === 0) {
    return (
      `Cleared all project memberships for document ${document_id}. ` +
      "The document no longer belongs to any project."
    );
  }
  return (
    `Set project memberships for document ${document_id}:\n` +
    `  Projects (${cleanNames.length}): ${cleanNames.join(", ")}\n` +
    `  Project IDs: ${projectIds.join(", ")}\n` +
    "  Note: this REPLACED the previous membership set. Any projects not " +
    "listed above are no longer associated with this document."
  );
}

export const setDocumentProjectsTool: ToolDefinition = {
  name: "cerefox_set_document_projects",
  description:
    "Set the document's project memberships to EXACTLY the given list. Destructive replace: any existing memberships not in this list are removed. Pass an empty list to clear all project memberships. Projects are looked up by name (case-insensitive); missing projects are created. Logged as update-metadata in the audit log — content is untouched. Use cerefox_ingest with project_names if you want to set memberships AND update content in one call. Use this tool when you only need to change project membership without re-writing the document body.",
  inputSchema: {
    type: "object",
    required: ["document_id", "project_names"],
    properties: {
      document_id: {
        type: "string",
        description:
          "UUID of the document. Get this from a prior cerefox_search result (the [id: ...] tag after the title).",
      },
      project_names: {
        type: "array",
        items: { type: "string" },
        description:
          "Explicit list of project names. Each created if absent. Order is preserved. Empty list = remove from all projects.",
      },
      author: {
        type: "string",
        description:
          'Agent or tool name recorded in the audit log. Defaults to "mcp-agent". May be enforced via server config.',
      },
    },
  },
  handler,
};
