/**
 * `cerefox_get_audit_log` — retrieve audit log entries with filters
 * (document, author, operation, time range, limit).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { logUsage } from "./_utils.js";
import type { ToolContext, ToolDefinition } from "./types.js";

async function handler(
  supabase: SupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const params: Record<string, unknown> = {};
  if (args.document_id) params.p_document_id = args.document_id;
  if (args.author) params.p_author = args.author;
  if (args.operation) params.p_operation = args.operation;
  if (args.since) params.p_since = args.since;
  if (args.until) params.p_until = args.until;
  if (args.limit) params.p_limit = Math.min(Number(args.limit) || 50, 200);

  const { data, error } = await supabase.rpc("cerefox_list_audit_entries", params);

  if (error) throw new Error(`RPC error: ${error.message}`);

  const entries = (data ?? []) as Array<{
    id: string;
    document_id: string | null;
    doc_title: string | null;
    operation: string;
    author: string;
    author_type: string;
    size_before: number | null;
    size_after: number | null;
    description: string;
    created_at: string;
  }>;

  logUsage(supabase, {
    operation: "get_audit_log",
    accessPath: ctx.accessPath,
    requestor: args.requestor as string | undefined,
    result_count: entries.length,
  });

  if (!entries.length) return "No audit log entries found.";

  const lines = entries.map((e) => {
    const docLabel =
      e.doc_title ?? (e.document_id ? e.document_id.slice(0, 8) + "..." : "(deleted)");
    const sizeInfo =
      e.size_before != null && e.size_after != null
        ? ` | ${e.size_before} -> ${e.size_after} chars`
        : e.size_after != null
          ? ` | ${e.size_after} chars`
          : "";
    return `${e.created_at.slice(0, 19)} | ${e.operation} | ${e.author} (${e.author_type}) | ${docLabel}${sizeInfo} | ${e.description}`;
  });
  return `Audit log (${entries.length} entries, newest first):\n\n${lines.join("\n")}`;
}

export const auditLogTool: ToolDefinition = {
  name: "cerefox_get_audit_log",
  description:
    "Retrieve audit log entries showing who changed what and when. Supports filtering by document, author, operation type, and time range. Returns entries with document titles, author attribution, size changes, and descriptions.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      document_id: { type: "string", description: "Filter by document UUID (optional)" },
      author: { type: "string", description: "Filter by author name (optional)" },
      operation: {
        type: "string",
        description:
          "Filter by operation type: create, update-content, update-metadata, delete, status-change, archive, unarchive (optional)",
      },
      since: {
        type: "string",
        description: "ISO timestamp lower bound for temporal queries (optional)",
      },
      limit: {
        type: "integer",
        description: "Maximum number of entries to return (default: 50, max: 200)",
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
