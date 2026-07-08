/**
 * Unit tests for `_shared/mcp-auth/` — the in-function auth gate for cerefox-mcp.
 *
 * No network: a real ES256 keypair is generated with SubtleCrypto, the public
 * half is served as a mock JWKS via an injected fetch, and tokens are signed
 * in-test. Covers both auth paths (static Bearer + OAuth JWT) and the full
 * reject matrix that stands in for the design §6 invariants (fail-closed,
 * alg allowlist / HS256-confusion defense, iss/aud/exp/owner claims).
 */

import { beforeAll, describe, expect, test } from "bun:test";

import {
  constantTimeEqual,
  createMcpAuthenticator,
  type McpAuthConfig,
} from "../mcp-auth/index.ts";

const ISSUER = "https://ref.supabase.co/auth/v1";
const JWKS_URI = `${ISSUER}/.well-known/jwks.json`;
const AUD = "authenticated";
const OWNER = "0b850e27-27b6-48eb-b019-e208fb7f92e7";
const STATIC_BEARER = "eyJlegacy.anon.key";
const FIXED_NOW = 1_800_000_000_000; // fixed clock (ms) for deterministic exp checks

// ── base64url + JWT signing helpers (test-side) ──────────────────────────────

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function strToB64Url(s: string): string {
  return bytesToB64Url(new TextEncoder().encode(s));
}

let keyPair: CryptoKeyPair;
let publicJwk: JsonWebKey;

beforeAll(async () => {
  keyPair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  publicJwk.kid = "test-key-1";
  publicJwk.alg = "ES256";
});

async function signEs256(payload: Record<string, unknown>): Promise<string> {
  const header = { alg: "ES256", typ: "JWT", kid: "test-key-1" };
  const signingInput = `${strToB64Url(JSON.stringify(header))}.${strToB64Url(JSON.stringify(payload))}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: { name: "SHA-256" } },
      keyPair.privateKey,
      new TextEncoder().encode(signingInput),
    ),
  );
  return `${signingInput}.${bytesToB64Url(sig)}`;
}

/** An unsigned HS256-claiming token (alg-confusion attempt). */
function forgeHs256(payload: Record<string, unknown>): string {
  const header = { alg: "HS256", typ: "JWT" };
  return `${strToB64Url(JSON.stringify(header))}.${strToB64Url(JSON.stringify(payload))}.ZmFrZXNpZw`;
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const nowSec = Math.floor(FIXED_NOW / 1000);
  return {
    iss: ISSUER,
    sub: OWNER,
    aud: AUD,
    role: "authenticated",
    client_id: "claude-client",
    iat: nowSec - 10,
    exp: nowSec + 3600,
    ...overrides,
  };
}

function makeAuth(overrides: Partial<McpAuthConfig> = {}) {
  return createMcpAuthenticator({
    issuer: ISSUER,
    jwksUri: JWKS_URI,
    expectedAudience: AUD,
    ownerUserId: OWNER,
    staticBearer: STATIC_BEARER,
    now: () => FIXED_NOW,
    fetchImpl: (async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch,
    ...overrides,
  });
}

// ── constantTimeEqual ────────────────────────────────────────────────────────

describe("constantTimeEqual", () => {
  test("equal strings match", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
  });
  test("different strings don't match", () => {
    expect(constantTimeEqual("abc123", "abc124")).toBe(false);
  });
  test("different lengths don't match", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
  test("empty vs non-empty", () => {
    expect(constantTimeEqual("", "x")).toBe(false);
  });
});

// ── static Bearer path ───────────────────────────────────────────────────────

describe("static Bearer path", () => {
  test("accepts the exact static token", async () => {
    const r = await makeAuth().authenticate(`Bearer ${STATIC_BEARER}`);
    expect(r).toEqual({ ok: true, path: "static" });
  });

  test("rejects a wrong static token as a malformed JWT (not accept-all)", async () => {
    const r = await makeAuth().authenticate("Bearer not-the-key");
    expect(r.ok).toBe(false);
  });

  test("fail-closed when no static token is configured", async () => {
    const r = await makeAuth({ staticBearer: null }).authenticate(`Bearer ${STATIC_BEARER}`);
    // With the static path disabled, the anon-key string is not a JWT → rejected.
    expect(r.ok).toBe(false);
  });
});

// ── missing / malformed tokens ───────────────────────────────────────────────

describe("missing and malformed", () => {
  test("no header", async () => {
    expect((await makeAuth().authenticate(null)).ok).toBe(false);
    expect((await makeAuth().authenticate(null)) as { reason: string }).toMatchObject({
      reason: "no_token",
    });
  });
  test("non-Bearer scheme", async () => {
    expect((await makeAuth().authenticate("Basic abc")).ok).toBe(false);
  });
  test("empty Bearer", async () => {
    expect((await makeAuth().authenticate("Bearer   ")).ok).toBe(false);
  });
  test("garbage token", async () => {
    const r = await makeAuth().authenticate("Bearer not.a.jwt.at.all");
    expect(r.ok).toBe(false);
  });
});

// ── OAuth JWT path — accept ──────────────────────────────────────────────────

describe("OAuth JWT — valid", () => {
  test("accepts a well-formed owner token", async () => {
    const token = await signEs256(validPayload());
    const r = await makeAuth().authenticate(`Bearer ${token}`);
    expect(r).toEqual({ ok: true, path: "oauth", sub: OWNER });
  });

  test("accepts any authenticated token when owner is not pinned", async () => {
    const token = await signEs256(validPayload({ sub: "some-other-user" }));
    const r = await makeAuth({ ownerUserId: null }).authenticate(`Bearer ${token}`);
    expect(r.ok).toBe(true);
  });
});

// ── OAuth JWT path — reject matrix ───────────────────────────────────────────

describe("OAuth JWT — reject matrix", () => {
  test("HS256 alg-confusion token is rejected before crypto", async () => {
    const token = forgeHs256(validPayload());
    const r = await makeAuth().authenticate(`Bearer ${token}`);
    expect(r).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  test("expired token", async () => {
    const nowSec = Math.floor(FIXED_NOW / 1000);
    const token = await signEs256(validPayload({ exp: nowSec - 3600 }));
    const r = await makeAuth().authenticate(`Bearer ${token}`);
    expect(r).toMatchObject({ ok: false, reason: "bad_claims" });
  });

  test("wrong issuer", async () => {
    const token = await signEs256(validPayload({ iss: "https://evil.example/auth/v1" }));
    const r = await makeAuth().authenticate(`Bearer ${token}`);
    expect(r).toMatchObject({ ok: false, reason: "bad_claims" });
  });

  test("wrong audience", async () => {
    const token = await signEs256(validPayload({ aud: "anon" }));
    const r = await makeAuth().authenticate(`Bearer ${token}`);
    expect(r).toMatchObject({ ok: false, reason: "bad_claims" });
  });

  test("non-owner sub is rejected when owner is pinned", async () => {
    const token = await signEs256(validPayload({ sub: "intruder" }));
    const r = await makeAuth().authenticate(`Bearer ${token}`);
    expect(r).toMatchObject({ ok: false, reason: "not_owner" });
  });

  test("valid signature from a different key is rejected", async () => {
    const other = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const header = { alg: "ES256", typ: "JWT", kid: "test-key-1" };
    const input = `${strToB64Url(JSON.stringify(header))}.${strToB64Url(JSON.stringify(validPayload()))}`;
    const sig = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: { name: "SHA-256" } },
        other.privateKey,
        new TextEncoder().encode(input),
      ),
    );
    const token = `${input}.${bytesToB64Url(sig)}`;
    const r = await makeAuth().authenticate(`Bearer ${token}`);
    expect(r).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  test("fail-closed when JWKS is unavailable", async () => {
    const token = await signEs256(validPayload());
    const auth = makeAuth({
      fetchImpl: (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
    });
    const r = await auth.authenticate(`Bearer ${token}`);
    expect(r).toMatchObject({ ok: false, reason: "no_verifier" });
  });
});
