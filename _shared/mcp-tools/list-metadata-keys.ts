/**
 * `cerefox_list_metadata_keys` — discover the metadata vocabulary in use
 * across all documents. Returns each key with doc count + up to 5 example
 * values. Agents call this before `cerefox_metadata_search` or before
 * supplying their own metadata on `cerefox_ingest`.
 */

import type { MCPSupabaseClient } from "./types.ts";

import { logUsage } from "./_utils.ts";
import type { ToolContext, ToolDefinition } from "./types.ts";

async function handler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const { data, error } = await supabase.rpc("cerefox_list_metadata_keys");

  if (error) throw new Error(`RPC error: ${error.message}`);

  const keys = (data ?? []) as Array<{
    key: string;
    doc_count: number;
    example_values: string[];
  }>;

  logUsage(supabase, {
    operation: "list_metadata_keys",
    accessPath: ctx.accessPath,
    requestor: args.requestor as string | undefined,
    result_count: keys.length,
  });

  if (keys.length === 0) return "No metadata keys found across documents.";

  return JSON.stringify(keys, null, 2);
}

export const listMetadataKeysTool: ToolDefinition = {
  name: "cerefox_list_metadata_keys",
  description:
    "List all metadata keys currently in use across documents in the Cerefox knowledge base. Returns each key with its document count and up to 5 example values.",
  inputSchema: {
    type: "object",
    properties: {
      requestor: {
        type: "string",
        description:
          'Name of the agent or user making this request. Recorded in the usage log. Defaults to "mcp-agent" if not provided. May be enforced via server config.',
      },
    },
  },
  handler,
};
