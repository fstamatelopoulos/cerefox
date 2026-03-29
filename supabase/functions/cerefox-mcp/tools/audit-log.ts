// ── cerefox_get_audit_log tool handler ────────────────────────────────────
//
// Calls the cerefox_list_audit_entries RPC directly instead of delegating
// to the cerefox-get-audit-log Edge Function.

import { makeSupabaseClient } from "../shared.ts";

export async function handleGetAuditLog(args: Record<string, unknown>): Promise<string> {
  const supabase = makeSupabaseClient();

  // Build RPC params from provided args, omitting absent optional filters
  const params: Record<string, unknown> = {};
  if (args.document_id) params.p_document_id = args.document_id;
  if (args.author) params.p_author = args.author;
  if (args.operation) params.p_operation = args.operation;
  if (args.since) params.p_since = args.since;
  if (args.until) params.p_until = args.until;
  if (args.limit) params.p_limit = Math.min(Number(args.limit) || 50, 200);

  const { data, error } = await supabase.rpc("cerefox_list_audit_entries", params);

  if (error) {
    throw new Error(`RPC error: ${error.message}`);
  }

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

  if (!entries.length) {
    return "No audit log entries found.";
  }

  const lines = entries.map((e) => {
    const docLabel = e.doc_title ??
      (e.document_id ? e.document_id.slice(0, 8) + "..." : "(deleted)");
    const sizeInfo = e.size_before != null && e.size_after != null
      ? ` | ${e.size_before} -> ${e.size_after} chars`
      : e.size_after != null
      ? ` | ${e.size_after} chars`
      : "";
    return `${e.created_at.slice(0, 19)} | ${e.operation} | ${e.author} (${e.author_type}) | ${docLabel}${sizeInfo} | ${e.description}`;
  });

  return `Audit log (${entries.length} entries, newest first):\n\n${lines.join("\n")}`;
}
