// ── cerefox_list_versions tool handler ────────────────────────────────────
//
// Calls the cerefox_list_document_versions RPC directly instead of
// delegating to the cerefox-list-versions Edge Function.

import { makeSupabaseClient } from "../shared.ts";

export async function handleListVersions(args: Record<string, unknown>): Promise<string> {
  const document_id = args.document_id as string | undefined;

  if (!document_id) {
    throw new Error("document_id is required");
  }

  const supabase = makeSupabaseClient();

  const { data, error } = await supabase.rpc("cerefox_list_document_versions", {
    p_document_id: document_id,
  });

  if (error) {
    throw new Error(`RPC error: ${error.message}`);
  }

  const versions = (data ?? []) as Array<{
    version_id: string;
    version_number: number;
    source: string;
    chunk_count: number;
    total_chars: number;
    created_at: string;
  }>;

  if (!versions.length) {
    return "No archived versions found for this document.";
  }

  const lines = versions.map((v) =>
    `v${v.version_number} | ${v.created_at.slice(0, 10)} | ${v.source} | ${v.chunk_count} chunks / ${v.total_chars.toLocaleString()} chars | id: ${v.version_id}`
  );

  return `Archived versions (newest first):\n\n${lines.join("\n")}`;
}
