/**
 * Internal helpers shared by `_shared/mcp-tools/` handlers.
 *
 * - `applyByteBudget`: drop whole rows until the cumulative serialized size
 *   fits within the budget. Used by `search` and `metadata-search`.
 * - `logUsage`: fire-and-forget write to `cerefox_usage_log` via RPC.
 *   Never blocks the tool response.
 *
 * Both helpers are mirrored from `supabase/functions/cerefox-mcp/shared.ts`
 * for the v0.4.0 extraction — once `_shared/mcp-tools/` is the source of
 * truth (after 22D refactors the EF to import from here), the EF's `shared.ts`
 * removes its copies.
 */

import type { MCPSupabaseClient } from "./types.ts";

/** Server-enforced response-size ceiling for MCP results. Agents can request
 *  smaller budgets via `max_bytes`; values above this are capped. */
export const MAX_RESPONSE_BYTES = 200_000;

/** Built-in default cosine-similarity floor for hybrid/semantic search. */
export const DEFAULT_MIN_SEARCH_SCORE = 0.5;

/**
 * Resolve the minimum cosine-similarity floor for hybrid/semantic search
 * (vector-only matches below this are dropped; FTS matches always pass).
 * Overridable via the `CEREFOX_MIN_SEARCH_SCORE` env var (0.0–1.0). The Python
 * runtime read this; the TS migration dropped it — restored here as the single
 * default used by the CLI, local/remote MCP, and the web API.
 *
 * Runtime-agnostic env read: works in Node/Bun; in the Deno Edge Function
 * `process` may be absent, so it falls back to the built-in default (the cloud
 * EF path doesn't use the host `.env` anyway).
 */
export function getMinSearchScore(): number {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.CEREFOX_MIN_SEARCH_SCORE;
  if (raw === undefined || raw === "") return DEFAULT_MIN_SEARCH_SCORE;
  const n = Number.parseFloat(raw);
  return Number.isNaN(n) || n < 0 || n > 1 ? DEFAULT_MIN_SEARCH_SCORE : n;
}

export function applyByteBudget(
  rows: unknown[],
  maxBytes: number,
): { accepted: unknown[]; truncated: boolean; usedBytes: number } {
  const accepted: unknown[] = [];
  let usedBytes = 0;
  let truncated = false;

  for (const row of rows) {
    const rowBytes = new TextEncoder().encode(JSON.stringify(row)).length;
    if (usedBytes + rowBytes > maxBytes) {
      truncated = true;
      break;
    }
    accepted.push(row);
    usedBytes += rowBytes;
  }

  return { accepted, truncated, usedBytes };
}

import type { AccessPath } from "./types.ts";

export interface LogUsageParams {
  operation: string;
  accessPath: AccessPath;
  query_text?: string | null;
  document_id?: string | null;
  project_id?: string | null;
  result_count?: number | null;
  requestor?: string | null;
  extra?: Record<string, unknown>;
}

/** Fire-and-forget usage logging. Never throws, never blocks the response.
 *  Failures are silently swallowed — usage logging is best-effort by design.
 *  Differs from the EF's `logUsage` only in that `accessPath` is a required
 *  parameter (was hardcoded to `"remote-mcp"` in the EF) so the local TS
 *  MCP server can pass `"local-mcp"` for the same call site. */
export function logUsage(supabase: MCPSupabaseClient, params: LogUsageParams): void {
  Promise.resolve(
    supabase.rpc("cerefox_log_usage", {
      p_operation: params.operation,
      p_access_path: params.accessPath,
      p_requestor: params.requestor ?? "mcp-agent",
      p_document_id: params.document_id ?? null,
      p_project_id: params.project_id ?? null,
      p_query_text: params.query_text ?? null,
      p_result_count: params.result_count ?? null,
      p_extra: params.extra ?? {},
    }),
  ).catch(() => {});
}
