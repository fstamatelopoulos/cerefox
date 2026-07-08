/**
 * mcp-auth — in-function authentication for the `cerefox-mcp` Edge Function.
 *
 * Context: to be an OAuth 2.1 protected resource server, `cerefox-mcp` must serve
 * unauthenticated discovery routes and issue its own 401 challenges. That requires
 * deploying it with `--no-verify-jwt` (the Supabase gateway otherwise rejects the
 * request before the function runs). With the gateway gate removed, **this module
 * becomes the only auth gate** — see the invariants in
 * `docs/specs/oauth-mcp-server-design.md` §5–6.
 *
 * Two accepted credentials (design §5):
 *   Path 1 — legacy static Bearer (the anon JWT existing clients already send),
 *            constant-time compared against an explicitly-set value.
 *   Path 2 — an OAuth 2.1 access token: a project-signed JWT validated against the
 *            project JWKS (asymmetric alg allowlist, iss/aud/exp/nbf, owner `sub`).
 *
 * Portability: this file uses ONLY Web Platform globals (`crypto.subtle`, `fetch`,
 * `atob`, `TextEncoder`) — no `node:`, `jsr:`, or `npm:` imports — so the identical
 * source runs under Deno (the Edge Function) and Bun (`bun test`). JWT verification
 * is implemented directly on SubtleCrypto rather than pulling in `jose`; ES256/RS256
 * JWS signatures are already in the raw formats SubtleCrypto's `verify` expects.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type AuthPath = "static" | "oauth";

export interface AuthSuccess {
  ok: true;
  path: AuthPath;
  /** The authenticated subject (owner user id) for OAuth; undefined for static. */
  sub?: string;
}

export interface AuthFailure {
  ok: false;
  /** Machine-readable reason, also used to shape the WWW-Authenticate challenge. */
  reason:
    | "no_token"
    | "malformed_token"
    | "bad_signature"
    | "bad_claims"
    | "not_owner"
    | "no_verifier";
  /** Human detail for logs (never returned to the client). */
  detail?: string;
}

export type AuthResult = AuthSuccess | AuthFailure;

interface Jwk {
  kty: string;
  kid?: string;
  alg?: string;
  crv?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
  use?: string;
}

interface Jwks {
  keys: Jwk[];
}

export interface McpAuthConfig {
  /** Expected token issuer, e.g. `https://<ref>.supabase.co/auth/v1`. */
  issuer: string;
  /** JWKS URL, e.g. `<issuer>/.well-known/jwks.json`. */
  jwksUri: string;
  /** Expected `aud` claim. Supabase issues `"authenticated"`. */
  expectedAudience: string;
  /**
   * Pinned owner user id. When set, an OAuth token's `sub` MUST equal it.
   * When null/undefined, any validly-signed `authenticated` token is accepted
   * (safe only because a single-user project has exactly one user — pinning is
   * still the setup default; see design §5).
   */
  ownerUserId?: string | null;
  /**
   * Expected value for the legacy static-Bearer path (the anon JWT). When
   * null/undefined the static path is disabled and rejects everything
   * (fail-closed — never accept-all).
   */
  staticBearer?: string | null;
  /** Accepted JWS algorithms. Default `["ES256", "RS256"]`. Never HS256/none. */
  allowedAlgs?: string[];
  /** Clock skew tolerance in seconds. Default 60. */
  clockSkewSec?: number;
  /** JWKS cache TTL in seconds. Default 600. */
  jwksCacheTtlSec?: number;
  /** Injectable clock (ms since epoch). Default `Date.now`. */
  now?: () => number;
  /** Injectable fetch (for tests). Default global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface McpAuthenticator {
  authenticate(authorizationHeader: string | null): Promise<AuthResult>;
}

// ── Base64url / encoding helpers ─────────────────────────────────────────────

function base64UrlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Copy a view's bytes into a fresh, plain `ArrayBuffer`. SubtleCrypto expects a
 * `BufferSource`; under strict typed-array generics (TS 5.7) a `Uint8Array` may be
 * inferred as `ArrayBufferLike`-backed, so we normalize to `ArrayBuffer` here.
 */
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

function base64UrlToString(input: string): string {
  return new TextDecoder().decode(base64UrlToBytes(input));
}

/**
 * Length-independent constant-time string comparison. Iterates over the longer
 * length so the loop count doesn't leak which operand is shorter, and folds a
 * length mismatch into the result rather than short-circuiting.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

// ── JWT verification (SubtleCrypto) ──────────────────────────────────────────

interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

interface JwtPayload {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  role?: string;
  client_id?: string;
  [k: string]: unknown;
}

function importParamsFor(alg: string, jwk: Jwk): {
  importAlgo: EcKeyImportParams | RsaHashedImportParams;
  verifyAlgo: EcdsaParams | AlgorithmIdentifier;
} | null {
  if (alg === "ES256" && jwk.kty === "EC") {
    return {
      importAlgo: { name: "ECDSA", namedCurve: "P-256" },
      verifyAlgo: { name: "ECDSA", hash: { name: "SHA-256" } },
    };
  }
  if (alg === "RS256" && jwk.kty === "RSA") {
    return {
      importAlgo: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      verifyAlgo: { name: "RSASSA-PKCS1-v1_5" },
    };
  }
  return null;
}

async function verifyJwtSignature(
  token: string,
  header: JwtHeader,
  jwks: Jwks,
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, sigB64] = parts;

  // Select the key by kid; if the token has no kid, accept a lone matching key.
  const candidates = jwks.keys.filter((k) => {
    if (header.kid) return k.kid === header.kid;
    return true;
  });
  if (candidates.length === 0) return false;

  const signature = toArrayBuffer(base64UrlToBytes(sigB64));
  const signed = toArrayBuffer(new TextEncoder().encode(`${headerB64}.${payloadB64}`));

  for (const jwk of candidates) {
    const params = importParamsFor(header.alg, jwk);
    if (!params) continue;
    try {
      const key = await crypto.subtle.importKey(
        "jwk",
        jwk as JsonWebKey,
        params.importAlgo,
        false,
        ["verify"],
      );
      const ok = await crypto.subtle.verify(params.verifyAlgo, key, signature, signed);
      if (ok) return true;
    } catch {
      // try the next candidate key
    }
  }
  return false;
}

// ── Authenticator factory ────────────────────────────────────────────────────

const BEARER_PREFIX = "Bearer ";

export function createMcpAuthenticator(config: McpAuthConfig): McpAuthenticator {
  const allowedAlgs = config.allowedAlgs ?? ["ES256", "RS256"];
  const clockSkewSec = config.clockSkewSec ?? 60;
  const jwksCacheTtlSec = config.jwksCacheTtlSec ?? 600;
  const now = config.now ?? (() => Date.now());
  const fetchImpl = config.fetchImpl ?? fetch;

  // Isolate-lifetime JWKS cache (closure state). Key rotation is picked up on
  // TTL expiry or isolate recycle.
  let cache: { jwks: Jwks; fetchedAt: number } | null = null;

  async function getJwks(): Promise<Jwks | null> {
    if (cache && now() - cache.fetchedAt < jwksCacheTtlSec * 1000) {
      return cache.jwks;
    }
    try {
      const resp = await fetchImpl(config.jwksUri);
      if (!resp.ok) return cache?.jwks ?? null;
      const jwks = (await resp.json()) as Jwks;
      if (!jwks || !Array.isArray(jwks.keys)) return cache?.jwks ?? null;
      cache = { jwks, fetchedAt: now() };
      return jwks;
    } catch {
      // On a transient fetch failure, fall back to a still-cached set if any;
      // otherwise fail closed (caller rejects).
      return cache?.jwks ?? null;
    }
  }

  function validateClaims(payload: JwtPayload): AuthResult {
    const nowSec = Math.floor(now() / 1000);

    if (payload.iss !== config.issuer) {
      return { ok: false, reason: "bad_claims", detail: "iss mismatch" };
    }
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(config.expectedAudience)) {
      return { ok: false, reason: "bad_claims", detail: "aud mismatch" };
    }
    if (typeof payload.exp !== "number" || payload.exp + clockSkewSec < nowSec) {
      return { ok: false, reason: "bad_claims", detail: "expired" };
    }
    if (typeof payload.nbf === "number" && payload.nbf - clockSkewSec > nowSec) {
      return { ok: false, reason: "bad_claims", detail: "not yet valid" };
    }
    if (!payload.sub) {
      return { ok: false, reason: "bad_claims", detail: "missing sub" };
    }
    if (config.ownerUserId && payload.sub !== config.ownerUserId) {
      return { ok: false, reason: "not_owner", detail: "sub is not the owner" };
    }
    return { ok: true, path: "oauth", sub: payload.sub };
  }

  async function authenticate(authorizationHeader: string | null): Promise<AuthResult> {
    if (!authorizationHeader || !authorizationHeader.startsWith(BEARER_PREFIX)) {
      return { ok: false, reason: "no_token" };
    }
    const token = authorizationHeader.slice(BEARER_PREFIX.length).trim();
    if (!token) return { ok: false, reason: "no_token" };

    // Path 1 — legacy static Bearer (constant-time). Fail-closed when unset.
    if (config.staticBearer && constantTimeEqual(token, config.staticBearer)) {
      return { ok: true, path: "static" };
    }

    // Path 2 — OAuth access token (JWT against JWKS).
    const parts = token.split(".");
    if (parts.length !== 3) {
      return { ok: false, reason: "malformed_token", detail: "not a JWT" };
    }
    let header: JwtHeader;
    let payload: JwtPayload;
    try {
      header = JSON.parse(base64UrlToString(parts[0])) as JwtHeader;
      payload = JSON.parse(base64UrlToString(parts[1])) as JwtPayload;
    } catch {
      return { ok: false, reason: "malformed_token", detail: "bad JSON" };
    }

    // Algorithm allowlist BEFORE any crypto — reject none/HS256 outright, which
    // is what defends against alg-confusion with the HS256 legacy anon JWT.
    if (!allowedAlgs.includes(header.alg)) {
      return { ok: false, reason: "bad_signature", detail: `alg ${header.alg} not allowed` };
    }

    const jwks = await getJwks();
    if (!jwks) return { ok: false, reason: "no_verifier", detail: "JWKS unavailable" };

    const verified = await verifyJwtSignature(token, header, jwks);
    if (!verified) return { ok: false, reason: "bad_signature", detail: "signature invalid" };

    return validateClaims(payload);
  }

  return { authenticate };
}
