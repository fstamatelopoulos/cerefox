/**
 * `cerefox_get_audit_log` — retrieve audit log entries with filters
 * (document, author, operation, time range, limit).
 */

import type { MCPSupabaseClient } from "./types.ts";

import { logUsage, auditDocLabel, AUDIT_OPERATIONS } from "./_utils.ts";
import type { ToolContext, ToolDefinition } from "./types.ts";
import { AUTHOR_PARAM_READ, callerIdentity } from "./identity.ts";

/**
 * A timestamp an agent cannot mistake for local time (#199).
 *
 * `created_at` arrives as an ISO 8601 string in UTC. Truncating it to 19
 * characters dropped the `Z`, and an agent reading `2026-08-11T06:32:13` while
 * its own clock said 2026-08-10 concluded the server was a day ahead and dated
 * its log entries accordingly. The instant was right; the label was missing.
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
  const params: Record<string, unknown> = {};
  if (args.document_id) params.p_document_id = args.document_id;
  // v1.13.1: the filter is `by_author`; `author` is the caller's identity here
  // as on every other tool (it was the filter until 1.13.1).
  if (args.by_author) params.p_author = args.by_author;
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
    requestor: callerIdentity(args),
    result_count: entries.length,
  });

  if (!entries.length) return "No audit log entries found.";

  const lines = entries.map((e) => {
    const docLabel = auditDocLabel(e.doc_title, e.document_id, e.operation);
    const sizeInfo =
      e.size_before != null && e.size_after != null
        ? ` | ${e.size_before} -> ${e.size_after} chars`
        : e.size_after != null
          ? ` | ${e.size_after} chars`
          : "";
    return `${utcStamp(e.created_at)} | ${e.operation} | ${e.author} (${e.author_type}) | ${docLabel}${sizeInfo} | ${e.description}`;
  });
  return `Audit log (${entries.length} entries, newest first):\n\n${lines.join("\n")}`;
}

export const auditLogTool: ToolDefinition = {
  name: "cerefox_get_audit_log",
  description:
    "Retrieve audit log entries showing who changed what and when. Supports filtering by document, author, operation type, and time range. Returns entries with document titles, author attribution, size changes, and descriptions.",
  // Read-only: touches nothing. Safe for a client to run without prompting.
  annotations: {
    title: "Read audit log",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      document_id: { type: "string", description: "Filter by document UUID (optional)" },
      by_author: {
        type: "string",
        description: "Filter: only entries written by this author name (optional)",
      },
      operation: {
        type: "string",
        description: `Filter by operation type: ${AUDIT_OPERATIONS.join(", ")} (optional)`,
      },
      since: {
        type: "string",
        description: "ISO timestamp lower bound for temporal queries (optional)",
      },
      limit: {
        type: "integer",
        description: "Maximum number of entries to return (default: 50, max: 200)",
      },
      author: AUTHOR_PARAM_READ,
    },
  },
  handler,
};
