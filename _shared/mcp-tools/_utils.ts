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
 * Read an env var in any of Cerefox's three runtimes.
 *
 * Node/Bun expose `process.env` (populated from the user's `.env` by
 * `_shared/config`). Supabase Edge Functions run Deno, where `process` may be
 * absent but **Function secrets are readable via `Deno.env`** — so reading
 * both means a secret set on the project configures the remote MCP / EF path
 * the same way `.env` configures the local one. (Before this, the retrieval
 * tunables silently fell back to built-in defaults on the remote path.)
 */
function readEnv(name: string): string | undefined {
  const g = globalThis as {
    process?: { env?: Record<string, string | undefined> };
    Deno?: { env?: { get(k: string): string | undefined } };
  };
  const fromProcess = g.process?.env?.[name];
  if (fromProcess !== undefined && fromProcess !== "") return fromProcess;
  try {
    const fromDeno = g.Deno?.env?.get(name);
    return fromDeno === "" ? undefined : fromDeno;
  } catch {
    // Deno without --allow-env: treat as unset.
    return undefined;
  }
}

/** Parse a 0–1 env value; undefined when unset or out of range. */
function readUnitInterval(name: string): number | undefined {
  const raw = readEnv(name);
  if (raw === undefined) return undefined;
  const n = Number.parseFloat(raw);
  return Number.isNaN(n) || n < 0 || n > 1 ? undefined : n;
}

/**
 * Default hybrid fusion weight: 1.0 = pure semantic, 0.0 = pure keyword.
 * Overridable via `CEREFOX_SEARCH_ALPHA` (parity with the other retrieval
 * tunables; previously alpha was per-call only).
 */
export const DEFAULT_SEARCH_ALPHA = 0.7;

export function getSearchAlpha(): number {
  return readUnitInterval("CEREFOX_SEARCH_ALPHA") ?? DEFAULT_SEARCH_ALPHA;
}

/**
 * The retrieval tunables a client should actually SEND to the RPCs (#133).
 *
 * Returns undefined when the operator has expressed no preference, so the
 * parameter is omitted and the server resolves it: `cerefox_config` first,
 * then the built-in default. That is what lets one `cerefox config set` govern
 * every access path. When a value IS configured here it wins, preserving the
 * chain: per-call argument > client env > deployment config > built-in.
 *
 * `min_search_score` has one subtlety: the local embedder needs a higher floor
 * (nomic scores unrelated text ~0.4–0.55), so an explicitly local embedder
 * counts as "configured" even when CEREFOX_MIN_SEARCH_SCORE is unset —
 * otherwise omitting the parameter would silently apply the OpenAI-calibrated
 * default to a local deployment.
 */
export function getConfiguredMinSearchScore(): number | undefined {
  const explicit = readUnitInterval("CEREFOX_MIN_SEARCH_SCORE");
  if (explicit !== undefined) return explicit;
  if (readEnv("CEREFOX_EMBEDDER") === "local") return DEFAULT_MIN_SEARCH_SCORE_LOCAL;
  return undefined;
}

export function getConfiguredSearchAlpha(): number | undefined {
  return readUnitInterval("CEREFOX_SEARCH_ALPHA");
}

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
  const fallback =
    readEnv("CEREFOX_EMBEDDER") === "local"
      ? DEFAULT_MIN_SEARCH_SCORE_LOCAL
      : DEFAULT_MIN_SEARCH_SCORE;
  return readUnitInterval("CEREFOX_MIN_SEARCH_SCORE") ?? fallback;
}

/**
 * CEREFOX_MIN_TERM_COVERAGE (v1.0.4): user-configurable default for the
 * OR-fallback term-coverage gate. Returns undefined when unset/invalid —
 * callers then OMIT p_min_term_coverage from the RPC call, deferring to the
 * server default (0.5) and staying compatible with pre-0.9.1 servers
 * (an unknown named argument fails the PostgREST function match).
 */
export function getMinTermCoverage(): number | undefined {
  return readUnitInterval("CEREFOX_MIN_TERM_COVERAGE");
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
