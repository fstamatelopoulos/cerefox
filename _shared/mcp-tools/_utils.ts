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
  return DEFAULT_SEARCH_ALPHA;
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
  return readEnv("CEREFOX_EMBEDDER") === "local"
    ? DEFAULT_MIN_SEARCH_SCORE_LOCAL
    : DEFAULT_MIN_SEARCH_SCORE;
}

/**
 * Retrieval tuning is server-side state, not a per-machine preference.
 *
 * These used to read CEREFOX_MIN_SEARCH_SCORE / CEREFOX_SEARCH_ALPHA /
 * CEREFOX_MIN_TERM_COVERAGE so a client could override the store's setting.
 * That was the wrong model: the right similarity floor depends on which
 * embedder produced the vectors, and the embedder is a property of the STORE —
 * every client querying one database must use the same one (`doctor` enforces
 * exactly that). So there is no case where two clients should legitimately
 * disagree, and an override only creates a way for search to behave differently
 * depending on who asked.
 *
 * All three now return undefined: the parameter is omitted and the RPC resolves
 * `cerefox_config`, then the built-in default. One `cerefox config set` — or the
 * Settings page — governs every access path.
 *
 * Cerefox Local still needs its higher floor for the nomic embedder; it seeds
 * `min_search_score` into its own `cerefox_config` at container init rather than
 * carrying it in the environment.
 *
 * A per-call argument (`--min-score`, the MCP `min_score` param) still wins, as
 * it always did. `cerefox doctor` reports the retired variables if still set.
 */
export function getConfiguredMinSearchScore(): number | undefined {
  return undefined;
}

export function getConfiguredSearchAlpha(): number | undefined {
  return undefined;
}

export function getMinTermCoverage(): number | undefined {
  return undefined;
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
/** Pull the two hashes out of an RPC `CEREFOX_CONFLICT` message.
 *
 *  The ONE site coupled to the SQL `RAISE` wording ("expected hash %, current
 *  hash %"). Three tools (ingest, edit, delete) rephrase conflicts for agents;
 *  before this helper each carried its own copy of these regexes, and a
 *  wording change in rpcs.sql would have had to be mirrored three times, with
 *  a missed one silently degrading that tool's conflict output to "unknown". */
export function extractConflictHashes(message: string): { expected: string; current: string } {
  return {
    expected: message.match(/expected hash ([0-9a-f]{64})/)?.[1] ?? "unknown",
    current: message.match(/current hash ([0-9a-f]{64})/)?.[1] ?? "unknown",
  };
}

/** Does this RPC error mean the function (or this signature of it) is not on
 *  the server — i.e. the client is newer than the deployed schema?
 *
 *  The ONE site coupled to how that condition surfaces: PostgREST's PGRST202
 *  ("Could not find the function … in the schema cache") and Postgres' 42883
 *  ("function … does not exist", seen through connections that bypass
 *  PostgREST or during a deploy's DROP/CREATE window). Five call sites
 *  (delete/restore MCP handlers, delete/restore CLI verbs, partial edits)
 *  each carried a hand-rolled subset of these predicates before this helper. */
/** Is this RPC error the delete/restore RPCs' "Document % not found"?
 *
 *  Anchored on the SQLSTATE (22023, invalid_parameter_value — PostgREST
 *  passes it through as `error.code`) AND the prose, because 22023 alone is
 *  shared with other validation raises (zero chunks, token required) and the
 *  prose alone would match any gateway error containing "not found". One
 *  site instead of four hand-rolled substring checks. */
export function isDocumentNotFoundError(error: { code?: string; message?: string }): boolean {
  return error.code === "22023" && /not found/i.test(error.message ?? "");
}

export {
  AUDIT_OPERATIONS,
  auditDocLabel,
  isStoreLevelAuditOp,
  STORE_LEVEL_AUDIT_OPS,
} from "./audit-ops.ts";

/**
 * A store whose RPCs are 0.14.0+ but whose cerefox_audit_log operation CHECK
 * was never widened (migration 0028 unapplied — e.g. a partial deploy) rejects
 * every in-transaction audit insert with 23514. The write itself rolls back,
 * so the remediation is "apply the migration", never "fix your input".
 */
export function isAuditCheckError(message: string): boolean {
  return /cerefox_audit_log_operation_check/.test(message);
}

/** Postgres 23505 through PostgREST — one predicate, not N copied regexes. */
export function isDuplicateKeyError(message: string): boolean {
  return /duplicate key|unique constraint|23505/i.test(message);
}

/**
 * One classifier for a failed store-level write RPC (set_config, the project
 * writes): returns the remediation text, or null when the failure is not a
 * deployment-state problem. Keeps the CLI and web surfaces in lockstep —
 * round 4 found the two carrying hand-copied, already-diverging prose.
 */
export function storeWriteRemediation(
  message: string,
  fnName: string,
  // The schema floor the CALLING feature requires — round 2 caught the
  // hardcoded "0.14.0" contradicting doctor on a 0.14.1 store missing a
  // 0.15.0-only function.
  requiredSchema = "0.14.0",
): string | null {
  if (isMissingFunctionError(message, fnName)) {
    return (
      `The deployed server predates schema ${requiredSchema} — or PostgREST's schema cache ` +
      "is stale right after a deploy. If you just deployed, retry in a few " +
      "seconds; otherwise run `cerefox server deploy`."
    );
  }
  if (isAuditCheckError(message)) {
    return (
      "The server's audit-log constraint predates migration 0028 (partial " +
      "deploy). Run `cerefox server deploy` to apply pending migrations, then retry."
    );
  }
  return null;
}

export function isMissingFunctionError(message: string, fnName: string): boolean {
  return (
    (message.includes("Could not find the function") && message.includes(fnName)) ||
    (message.includes("does not exist") && message.includes(fnName))
  );
}

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
