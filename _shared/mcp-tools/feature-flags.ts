/**
 * Optional-feature gating for the MCP tool surface.
 *
 * Document relations (iteration 29) ship **dormant**: the table sits empty, the
 * `lifecycle_status` column defaults to `'active'`, search is untouched — but
 * the four relation tools would still appear in every agent's tool list, and an
 * agent that sees a tool may decide to use it. For a feature we intend to
 * evolve through experimentation, that is not "optional" enough.
 *
 * So exposure is gated on a deployment-wide flag (`relations_enabled` in
 * `cerefox_config`, default **false**), read through the same RPC as every
 * other setting. Turning it on is one command:
 *
 *   cerefox config set relations_enabled true
 *
 * Failure mode is deliberately closed: if the config read fails (older schema,
 * transient error), the feature stays hidden rather than appearing
 * intermittently.
 */

import type { MCPSupabaseClient } from "./types.ts";

/** Tools gated behind `relations_enabled`. */
export const RELATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  "cerefox_set_relation",
  "cerefox_delete_relation",
  "cerefox_get_relations",
  "cerefox_get_neighbors",
]);

/**
 * Cached per process. `tools/list` happens once per session, but `tools/call`
 * checks too (a long-lived session could hold a stale list), and a round trip
 * per call is not worth paying.
 */
const CACHE_TTL_MS = 60_000;
let cached: { value: boolean; at: number } | null = null;

/** Test seam: drop the cache so a flag change is picked up immediately. */
export function resetFeatureFlagCache(): void {
  cached = null;
}

export async function relationsEnabled(supabase: MCPSupabaseClient): Promise<boolean> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  try {
    const { data, error } = await supabase.rpc("cerefox_get_config", {
      p_key: "relations_enabled",
    });
    if (error) throw new Error(error.message);
    const value = String(data ?? "").trim().toLowerCase() === "true";
    cached = { value, at: Date.now() };
    return value;
  } catch {
    // Fail closed, and don't cache a failure — a transient error shouldn't
    // hide the feature for a full TTL once it is genuinely enabled.
    return false;
  }
}

/** Message shown when a gated tool is called while the feature is off. */
export function disabledToolMessage(name: string): string {
  return (
    `${name} is part of the document-relations feature, which is off by default. ` +
    `Enable it with: cerefox config set relations_enabled true ` +
    `(deployment-wide; every access path picks it up).`
  );
}
