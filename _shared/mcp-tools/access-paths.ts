/**
 * The `access_path` vocabulary — a dependency-free leaf module so the frontend
 * can import it through the `@cerefox/access-paths` vite alias (same pattern
 * as `@cerefox/audit-ops` and `@cerefox/schemas`) without dragging server-side
 * helpers into the bundle. `_shared/mcp-tools/types.ts` re-exports the type
 * for Node/Deno consumers; there is exactly ONE definition.
 *
 * **Why this is a shared const and not three literals** (iter-40, #226): the
 * domain was previously written out by hand in three places — the `AccessPath`
 * union here, `deriveAccessPathStats()` in the frontend, and the Analytics
 * page's filter dropdown. A hand-maintained list that must match another
 * hand-maintained list drifts; on this project that exact shape produced the
 * missing RLS table, the unguarded test suites, and the Edge Function bundle
 * allow-list. Adding `"api"` would have been the fourth instance.
 *
 * Now the union is derived from this array, and the frontend's label map is a
 * `Record<AccessPath, string>`, so a value added here that is not given a
 * label fails the frontend typecheck rather than quietly vanishing from a
 * dropdown. `deriveAccessPathStats()` still resolves by name on purpose (an
 * unknown path must not silently inflate the agent total) and is covered by
 * its own tests.
 *
 * There is deliberately NO database CHECK on `cerefox_usage_log.access_path`
 * (verified: the column is free text). This type is the guard.
 */

/**
 * Logical channels through which a Cerefox operation can reach the backend.
 *
 *   - `remote-mcp`    — `cerefox-mcp` Edge Function (HTTP MCP transport).
 *   - `local-mcp`     — `@cerefox/memory`'s stdio MCP bin.
 *   - `cli`           — the `cerefox` CLI bin.
 *   - `webapp`        — `/api/v1` called by the bundled web UI, i.e. a caller
 *                       that supplied no identity of its own.
 *   - `edge-function` — a primitive Cerefox Edge Function (GPT Actions,
 *                       direct HTTP).
 *   - `api`           — `/api/v1` called by something that named itself
 *                       (#226). Derived from the presence of caller identity,
 *                       never accepted from the request; see
 *                       `packages/memory/src/web/identity.ts`.
 */
export const ACCESS_PATHS = [
  "remote-mcp",
  "local-mcp",
  "cli",
  "webapp",
  "edge-function",
  "api",
] as const;

export type AccessPath = (typeof ACCESS_PATHS)[number];
