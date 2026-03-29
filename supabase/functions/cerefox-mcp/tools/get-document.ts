// ── cerefox_get_document tool handler ─────────────────────────────────────
//
// Calls the cerefox_get_document RPC directly instead of delegating to
// the cerefox-get-document Edge Function.

import { makeSupabaseClient } from "../shared.ts";

export async function handleGetDocument(args: Record<string, unknown>): Promise<string> {
  const document_id = args.document_id as string | undefined;
  const version_id = (args.version_id as string | null | undefined) ?? null;

  if (!document_id) {
    throw new Error("document_id is required");
  }

  const supabase = makeSupabaseClient();

  const { data, error } = await supabase.rpc("cerefox_get_document", {
    p_document_id: document_id,
    p_version_id: version_id,
  });

  if (error) {
    throw new Error(`RPC error: ${error.message}`);
  }

  const row = data?.[0] as {
    doc_title?: string;
    full_content?: string;
    chunk_count?: number;
    total_chars?: number;
  } | undefined;

  if (!row) {
    return "Document not found.";
  }

  const label = version_id !== null ? " (archived version)" : " (current)";
  return `# ${row.doc_title ?? "Untitled"}${label}\n\n${row.full_content ?? ""}`;
}
