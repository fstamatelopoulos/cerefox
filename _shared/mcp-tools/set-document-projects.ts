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

import type { MCPSupabaseClient } from "./types.ts";

import { replaceDocumentProjects } from "./_projects.ts";
import { McpInvalidParams, type ToolContext, type ToolDefinition } from "./types.ts";

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

  // The clean/dedup, existence check, name→id resolution, DELETE-then-INSERT
  // replace, audit entry, and usage log all live in the shared core so the
  // `cerefox document set-projects` CLI command behaves identically.
  const { cleanNames, projectIds } = await replaceDocumentProjects(supabase, {
    documentId: document_id,
    projectNames: project_names_raw as string[],
    author,
    authorType: "agent",
    accessPath: ctx.accessPath,
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
