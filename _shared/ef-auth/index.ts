/**
 * ef-auth — in-function access-token authentication for the primitive Edge
 * Functions (and `cerefox-mcp`'s static-token path).
 *
 * Context (iter-28E, `docs/specs/ef-auth-migration-design.md`): the 8 primitive
 * EFs move to `--no-verify-jwt` and authenticate the caller *in-function* against
 * a **rotatable, Cerefox-managed access token** instead of the unrotatable legacy
 * anon JWT. With the gateway gate removed, **this check is the only auth gate** on
 * those functions — so it fails closed and compares in constant time.
 *
 * The accepted set (`CEREFOX_ACCESS_TOKENS`, comma-separated) holds one or more
 * tokens so rotation is zero-downtime: add the new token, migrate clients, drop
 * the old. A request is accepted iff its Bearer credential equals ANY token in the
 * set (constant-time, no short-circuit on the first match).
 *
 * Portability: Web-Platform globals only (`TextEncoder` via the reused
 * `constantTimeEqual`) — the identical source runs under Deno (the EF) and Bun
 * (`bun test`). The single audited constant-time primitive lives in
 * `../mcp-auth/index.ts` and is reused here rather than re-implemented.
 */

import { constantTimeEqual } from "../mcp-auth/index.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TokenAuthSuccess {
  ok: true;
}

export interface TokenAuthFailure {
  ok: false;
  /** Machine-readable reason. Human detail (never returned to the client) in `detail`. */
  reason: "no_token" | "no_tokens_configured" | "bad_token";
  detail?: string;
}

export type TokenAuthResult = TokenAuthSuccess | TokenAuthFailure;

export interface AccessTokenConfig {
  /**
   * The accepted token set (from `CEREFOX_ACCESS_TOKENS`). When empty the check
   * FAILS CLOSED (rejects everything) — an EF must never accept-all because a
   * missing secret left the gate open.
   */
  tokens: string[];
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parse the `CEREFOX_ACCESS_TOKENS` secret into a token set: split on commas,
 * trim, drop empties (so trailing commas / whitespace don't create a `""` token
 * that a blank credential could match). Returns `[]` for null/undefined/blank —
 * which makes the check fail closed.
 */
export function parseAccessTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

// ── Check ────────────────────────────────────────────────────────────────────

const BEARER_PREFIX = "Bearer ";

/**
 * Validate the `Authorization: Bearer <token>` header against the accepted set.
 * Constant-time, fail-closed. Never logs or returns the token value.
 */
export function checkAccessToken(
  authorizationHeader: string | null,
  config: AccessTokenConfig,
): TokenAuthResult {
  if (!authorizationHeader || !authorizationHeader.startsWith(BEARER_PREFIX)) {
    return { ok: false, reason: "no_token" };
  }
  const token = authorizationHeader.slice(BEARER_PREFIX.length).trim();
  if (!token) return { ok: false, reason: "no_token" };

  // Fail closed: no tokens configured => reject everything (never accept-all).
  if (config.tokens.length === 0) {
    return {
      ok: false,
      reason: "no_tokens_configured",
      detail: "CEREFOX_ACCESS_TOKENS is unset/empty; refusing to accept-all",
    };
  }

  // Compare against every accepted token WITHOUT short-circuiting, so timing
  // doesn't leak which (or how many) tokens matched.
  let matched = false;
  for (const accepted of config.tokens) {
    if (constantTimeEqual(token, accepted)) matched = true;
  }

  return matched ? { ok: true } : { ok: false, reason: "bad_token" };
}

// ── Edge Function gate (drop-in for each primitive EF) ───────────────────────

/**
 * One-call auth gate for a primitive Edge Function. Returns a 401 `Response` to
 * short-circuit the handler when the token is missing/wrong/unconfigured, or
 * `null` to continue. Placed **before** the `/version` branch so version is gated
 * too (design §3, decision 2026-07-10).
 *
 * Deno-free by design: the caller passes the raw `CEREFOX_ACCESS_TOKENS` env
 * value (read via `Deno.env.get` in the EF) rather than this module touching the
 * `Deno` global — so the identical source still imports cleanly under Bun for
 * unit tests. `Response`/`console` are Web globals available in both runtimes.
 */
export function efAuthGate(
  authorization: string | null,
  tokensRaw: string | null | undefined,
  headers: Record<string, string>,
): Response | null {
  const result = checkAccessToken(authorization, { tokens: parseAccessTokens(tokensRaw) });
  if (result.ok) return null;

  // Log the machine reason (never the token). `no_token` is the normal
  // unauthenticated probe (noise); `bad_token` / `no_tokens_configured` are
  // worth surfacing in the dashboard logs.
  if (result.reason !== "no_token") {
    console.warn(
      `[ef-auth] rejected: ${result.reason}${result.detail ? ` (${result.detail})` : ""}`,
    );
  }
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...headers, "WWW-Authenticate": "Bearer" },
  });
}
