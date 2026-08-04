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

/** Built-in default response-size ceiling for MCP/EF results. */
export const MAX_RESPONSE_BYTES = 200_000;

/**
 * Server-enforced response-size ceiling for MCP/Edge-Function results (agents
 * can request smaller via `max_bytes`; larger is capped). Overridable via
 * `CEREFOX_MAX_RESPONSE_BYTES`. Read by the Python runtime; restored after the
 * TS migration. The web UI + CLI are intentionally unlimited and do not use this.
 * Runtime-agnostic env read (Deno EF safely falls back to the default).
 */
export function getMaxResponseBytes(): number {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.CEREFOX_MAX_RESPONSE_BYTES;
  if (raw === undefined || raw === "") return MAX_RESPONSE_BYTES;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) || n <= 0 ? MAX_RESPONSE_BYTES : n;
}

/** Built-in default cosine-similarity floor for hybrid/semantic search. */
export const DEFAULT_MIN_SEARCH_SCORE = 0.5;

/**
 * Nomic's cosine-score distribution sits higher than OpenAI's: unrelated text
 * lands ~0.4–0.55 (vs ~0.1–0.3), so the 0.5 floor calibrated for
 * text-embedding-3-small lets weak matches through on the local embedder
 * (rc.3 dogfood: an unrelated doc passed at vec≈0.54). 0.6 restores the
 * intended precision; relevant nomic matches score ~0.7+.
 */
export const DEFAULT_MIN_SEARCH_SCORE_LOCAL = 0.6;

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
  const fallback =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.CEREFOX_EMBEDDER === "local"
      ? DEFAULT_MIN_SEARCH_SCORE_LOCAL
      : DEFAULT_MIN_SEARCH_SCORE;
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseFloat(raw);
  return Number.isNaN(n) || n < 0 || n > 1 ? fallback : n;
}

/**
 * CEREFOX_MIN_TERM_COVERAGE (v1.0.4): user-configurable default for the
 * OR-fallback term-coverage gate. Returns undefined when unset/invalid —
 * callers then OMIT p_min_term_coverage from the RPC call, deferring to the
 * server default (0.5) and staying compatible with pre-0.9.1 servers
 * (an unknown named argument fails the PostgREST function match).
 */
export function getMinTermCoverage(): number | undefined {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.CEREFOX_MIN_TERM_COVERAGE;
  if (raw === undefined || raw === "") return undefined;
  const n = Number.parseFloat(raw);
  return Number.isNaN(n) || n < 0 || n > 1 ? undefined : n;
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
