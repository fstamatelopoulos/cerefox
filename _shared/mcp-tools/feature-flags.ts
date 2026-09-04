/**
 * Optional-feature gating, read from `cerefox_config`.
 *
 * Two features are governed by store-level boolean flags:
 *
 * - **Document relations** (iteration 29) ship **dormant**: the table sits
 *   empty, the `lifecycle_status` column defaults to `'active'`, search is
 *   untouched — but the four relation tools would still appear in every
 *   agent's tool list, and an agent that sees a tool may decide to use it.
 *   For a feature we intend to evolve through experimentation, that is not
 *   "optional" enough. Gated on `relations_enabled` (default **false**).
 *
 * - **The review workflow** (#241): agent writes land `pending_review` and a
 *   person approves them. Gated on `review_workflow_enabled` (**false** on a
 *   fresh install, **true** on a store that predates the flag). The write-side
 *   decision lives in `cerefox_ingest_document` and does NOT read the flag
 *   (author_type alone, v1.13.1); this reader is for the presentation side —
 *   every surface that would show a `review_status` asks here first and omits
 *   it when the workflow is off. The flag hides, it never rewrites.
 *
 * Both are read through the same RPC as every other setting, so turning one
 * on is one command: `cerefox config set <key> true`.
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
 * Cached per process, per key. `tools/list` happens once per session, but
 * `tools/call` checks too (a long-lived session could hold a stale list), and
 * a round trip per call is not worth paying. The web server busts the cache
 * when it writes config itself; a flip made from another process shows up
 * within the TTL.
 */
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { value: boolean; at: number }>();

/** Test seam (and the web config route's): drop the cache so a flag change
 * is picked up immediately. */
export function resetFeatureFlagCache(): void {
  cache.clear();
}

async function readBoolFlag(supabase: MCPSupabaseClient, key: string): Promise<boolean> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  try {
    const { data, error } = await supabase.rpc("cerefox_get_config", { p_key: key });
    if (error) throw new Error(error.message);
    const value = String(data ?? "").trim().toLowerCase() === "true";
    cache.set(key, { value, at: Date.now() });
    return value;
  } catch {
    // Fail closed, and don't cache a failure — a transient error shouldn't
    // hide the feature for a full TTL once it is genuinely enabled.
    return false;
  }
}

export async function relationsEnabled(supabase: MCPSupabaseClient): Promise<boolean> {
  return readBoolFlag(supabase, "relations_enabled");
}

/** Whether `review_status` is a thing on this store (#241). */
export async function reviewWorkflowEnabled(supabase: MCPSupabaseClient): Promise<boolean> {
  return readBoolFlag(supabase, "review_workflow_enabled");
}

/** Message shown when a gated tool is called while the feature is off. */
export function disabledToolMessage(name: string): string {
  return (
    `${name} is part of the document-relations feature, which is off by default. ` +
    `Enable it with: cerefox config set relations_enabled true ` +
    `(deployment-wide; every access path picks it up).`
  );
}
