/**
 * `cerefox_get_document` — retrieve full document content by ID. Pass
 * `version_id` (from `cerefox_list_versions`) to retrieve an archived
 * version; omit for the current version.
 */

import type { MCPSupabaseClient } from "./types.ts";

import { logUsage } from "./_utils.ts";
import { McpInvalidParams, type ToolContext, type ToolDefinition } from "./types.ts";

async function handler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const document_id = args.document_id as string | undefined;
  const version_id = (args.version_id as string | null | undefined) ?? null;

  if (!document_id) throw new McpInvalidParams("document_id is required");

  const { data, error } = await supabase.rpc("cerefox_get_document", {
    p_document_id: document_id,
    p_version_id: version_id,
  });

  if (error) throw new Error(`RPC error: ${error.message}`);

  const row = data?.[0] as
    | {
        doc_title?: string;
        full_content?: string;
        chunk_count?: number;
        total_chars?: number;
      }
    | undefined;

  if (!row) return "Document not found.";

  logUsage(supabase, {
    operation: "get_document",
    accessPath: ctx.accessPath,
    requestor: args.requestor as string | undefined,
    document_id,
    result_count: 1,
  });

  const label = version_id !== null ? " (archived version)" : " (current)";
  return `# ${row.doc_title ?? "Untitled"}${label}\n\n${row.full_content ?? ""}`;
}

export const getDocumentTool: ToolDefinition = {
  name: "cerefox_get_document",
  description:
    "Retrieve the full reconstructed content of a document. Pass version_id to retrieve an archived version; omit it (or pass null) for the current version. Version UUIDs are returned by cerefox_list_versions.",
  inputSchema: {
    type: "object",
    required: ["document_id"],
    properties: {
      document_id: { type: "string", description: "UUID of the document to retrieve" },
      version_id: {
        type: "string",
        description: "UUID of a specific archived version to retrieve (optional)",
      },
      requestor: {
        type: "string",
        description:
          'Name of the agent or user making this request. Recorded in the usage log. Defaults to "mcp-agent" if not provided. May be enforced via server config.',
      },
    },
  },
  handler,
};
