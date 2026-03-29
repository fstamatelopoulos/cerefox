// ── cerefox_list_metadata_keys tool handler ───────────────────────────────
//
// Calls the cerefox_list_metadata_keys RPC directly instead of delegating
// to the cerefox-metadata Edge Function.

import { makeSupabaseClient } from "../shared.ts";

export async function handleListMetadataKeys(): Promise<string> {
  const supabase = makeSupabaseClient();

  const { data, error } = await supabase.rpc("cerefox_list_metadata_keys");

  if (error) {
    throw new Error(`RPC error: ${error.message}`);
  }

  const keys = (data ?? []) as Array<{
    key: string;
    doc_count: number;
    example_values: string[];
  }>;

  if (keys.length === 0) {
    return "No metadata keys found across documents.";
  }

  return JSON.stringify(keys, null, 2);
}
