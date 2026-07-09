/**
 * Unit tests for `_shared/ef-auth/` — the in-function access-token gate for the
 * primitive Edge Functions (iter-28E). No network, no crypto keys: the check is a
 * constant-time string compare against a configured token set.
 *
 * Covers the design §10 matrix: valid token accepted, garbage/empty/non-Bearer
 * rejected, FAILS CLOSED when no tokens configured, multi-token set (rotation),
 * and the `parseAccessTokens` secret-parsing edge cases.
 */

import { describe, expect, test } from "bun:test";

import {
  type AccessTokenConfig,
  checkAccessToken,
  parseAccessTokens,
} from "../ef-auth/index.ts";

const TOKEN = "cfx_pat_AbCdEf0123456789AbCdEf0123456789AbCdEf01";
const OTHER = "cfx_pat_ZzZzZz9876543210ZzZzZz9876543210ZzZzZz98";
const bearer = (t: string) => `Bearer ${t}`;
const cfg = (tokens: string[]): AccessTokenConfig => ({ tokens });

describe("checkAccessToken — accept", () => {
  test("accepts the configured token", () => {
    expect(checkAccessToken(bearer(TOKEN), cfg([TOKEN]))).toEqual({ ok: true });
  });

  test("accepts any token in a multi-token (rotation) set", () => {
    const c = cfg([OTHER, TOKEN]);
    expect(checkAccessToken(bearer(TOKEN), c)).toEqual({ ok: true });
    expect(checkAccessToken(bearer(OTHER), c)).toEqual({ ok: true });
  });
});

describe("checkAccessToken — reject", () => {
  test("rejects a wrong token", () => {
    const r = checkAccessToken(bearer("cfx_pat_wrong"), cfg([TOKEN]));
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: "bad_token" });
  });

  test("rejects a token that is a prefix/substring of a valid one", () => {
    expect(checkAccessToken(bearer(TOKEN.slice(0, -4)), cfg([TOKEN])).ok).toBe(false);
    expect(checkAccessToken(bearer(`${TOKEN}extra`), cfg([TOKEN])).ok).toBe(false);
  });

  test("rejects a missing header", () => {
    expect(checkAccessToken(null, cfg([TOKEN]))).toMatchObject({ ok: false, reason: "no_token" });
  });

  test("rejects a non-Bearer scheme", () => {
    expect(checkAccessToken(`Basic ${TOKEN}`, cfg([TOKEN]))).toMatchObject({
      ok: false,
      reason: "no_token",
    });
    // case-sensitive scheme: "bearer " is not accepted
    expect(checkAccessToken(`bearer ${TOKEN}`, cfg([TOKEN]))).toMatchObject({
      ok: false,
      reason: "no_token",
    });
  });

  test("rejects an empty credential after Bearer", () => {
    expect(checkAccessToken("Bearer ", cfg([TOKEN]))).toMatchObject({ ok: false, reason: "no_token" });
    expect(checkAccessToken("Bearer    ", cfg([TOKEN]))).toMatchObject({ ok: false, reason: "no_token" });
  });
});

describe("checkAccessToken — fail closed", () => {
  test("rejects everything when no tokens are configured", () => {
    expect(checkAccessToken(bearer(TOKEN), cfg([]))).toMatchObject({
      ok: false,
      reason: "no_tokens_configured",
    });
  });

  test("a blank credential cannot match even a fail-closed empty set", () => {
    // the no_token guard fires before the fail-closed check
    expect(checkAccessToken("Bearer ", cfg([]))).toMatchObject({ ok: false, reason: "no_token" });
  });
});

describe("parseAccessTokens", () => {
  test("splits a comma-separated secret and trims", () => {
    expect(parseAccessTokens(` ${TOKEN} , ${OTHER} `)).toEqual([TOKEN, OTHER]);
  });

  test("drops empty entries from stray/trailing commas", () => {
    expect(parseAccessTokens(`${TOKEN},,${OTHER},`)).toEqual([TOKEN, OTHER]);
  });

  test("returns [] for null/undefined/blank (=> fail closed)", () => {
    expect(parseAccessTokens(null)).toEqual([]);
    expect(parseAccessTokens(undefined)).toEqual([]);
    expect(parseAccessTokens("")).toEqual([]);
    expect(parseAccessTokens("   ")).toEqual([]);
    expect(parseAccessTokens(",, ,")).toEqual([]);
  });

  test("a single token parses to a one-element set", () => {
    expect(parseAccessTokens(TOKEN)).toEqual([TOKEN]);
  });

  test("round-trips into a working check", () => {
    const tokens = parseAccessTokens(`${TOKEN}, ${OTHER}`);
    expect(checkAccessToken(bearer(OTHER), cfg(tokens))).toEqual({ ok: true });
    expect(checkAccessToken(bearer("nope"), cfg(tokens)).ok).toBe(false);
  });
});
