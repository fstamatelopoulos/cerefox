/**
 * `cerefox_list_versions` — list a document's archived version history
 * (newest first). Returns version_id (use with `cerefox_get_document`),
 * version_number, source, chunk_count, total_chars, created_at.
 */

import type { MCPSupabaseClient } from "./types.ts";

import { logUsage } from "./_utils.ts";
import { McpInvalidParams, type ToolContext, type ToolDefinition } from "./types.ts";
import { AUTHOR_PARAM_READ, callerIdentity } from "./identity.ts";

/**
 * Version timestamps carried only a DATE (`slice(0, 10)`), which is
 * indistinguishable from a local date — and this is the tool an agent was
 * reading when it dated a day's entries into the future (#199). Emit the
 * instant with its zone.
 */
function utcStamp(iso: string): string {
  const trimmed = iso.slice(0, 19);
  return trimmed.includes("T") ? `${trimmed}Z` : `${trimmed} UTC`;
}

async function handler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const document_id = args.document_id as string | undefined;
  if (!document_id) throw new McpInvalidParams("document_id is required");

  const { data, error } = await supabase.rpc("cerefox_list_document_versions", {
    p_document_id: document_id,
  });

  if (error) throw new Error(`RPC error: ${error.message}`);

  const versions = (data ?? []) as Array<{
    version_id: string;
    version_number: number;
    source: string;
    chunk_count: number;
    total_chars: number;
    created_at: string;
  }>;

  logUsage(supabase, {
    operation: "list_versions",
    accessPath: ctx.accessPath,
    requestor: callerIdentity(args),
    document_id,
    result_count: versions.length,
  });

  if (!versions.length) return "No archived versions found for this document.";

  const lines = versions.map(
    (v) =>
      `v${v.version_number} | ${utcStamp(v.created_at)} | ${v.source} | ${v.chunk_count} chunks / ${v.total_chars.toLocaleString()} chars | id: ${v.version_id}`,
  );
  return `Archived versions (newest first):\n\n${lines.join("\n")}`;
}

export const listVersionsTool: ToolDefinition = {
  name: "cerefox_list_versions",
  description:
    "List all archived versions of a document, newest first. Returns version_id (use with cerefox_get_document), version_number, source, chunk_count, total_chars, and created_at.",
  // Read-only: touches nothing. Safe for a client to run without prompting.
  annotations: {
    title: "List document versions",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    required: ["document_id"],
    properties: {
      document_id: {
        type: "string",
        description: "UUID of the document whose version history to list",
      },
      author: AUTHOR_PARAM_READ,
    },
  },
  handler,
};
