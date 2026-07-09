/**
 * OAuth 2.1 protected-resource glue for cerefox-mcp (design §3–6).
 *
 * Pure auth logic lives in `_shared/mcp-auth/`; this file is the HTTP/Deno layer:
 * it builds the authenticator from Function secrets, serves the RFC 9728 metadata
 * document, and formats the 401 challenge. It is imported only by the EF.
 */

import { CORS_HEADERS } from "./shared.ts";
import {
  type AuthResult,
  createMcpAuthenticator,
  type McpAuthenticator,
} from "../../../_shared/mcp-auth/index.ts";

/** Stable public path of this function (used to build absolute metadata URLs). */
export const FUNCTION_PATH = "/functions/v1/cerefox-mcp";

/** The protected-resource metadata route, matched as a suffix of the request path. */
const PRS_SUFFIX = "/.well-known/oauth-protected-resource";

/**
 * Origin of the deployed project, e.g. `https://<ref>.supabase.co`, from the
 * platform-injected `SUPABASE_URL` — NOT from request headers.
 *
 * SECURITY (design §6): the token issuer and JWKS URL are derived from this origin.
 * Deriving it from client-influenced headers (`x-forwarded-host`/`-proto`) would let
 * a caller point token validation at an attacker-controlled JWKS and forge a token
 * that passes (JWKS-poisoning auth bypass). `SUPABASE_URL` is set by the platform for
 * every Edge Function and is not client-controllable (every other Cerefox EF already
 * depends on it). It is also the exact public https origin Anthropic requires for the
 * RFC 9728 `resource` identifier — so this both hardens auth and removes the earlier
 * `http://` (internal-proxy) scheme workaround.
 */
function projectOrigin(): string {
  return (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
}

/** Absolute URL of this MCP server (the `resource` identifier — must match exactly). */
export function resourceUrl(): string {
  return `${projectOrigin()}${FUNCTION_PATH}`;
}

/** The Supabase auth server issuer for this project. */
export function issuerUrl(): string {
  return `${projectOrigin()}/auth/v1`;
}

/** True when the request targets the (public) protected-resource metadata route. */
export function isProtectedResourceMetadata(req: Request): boolean {
  const path = new URL(req.url).pathname;
  // Accept both the plain suffix and the RFC 9728 path-insertion form
  // (…/oauth-protected-resource/functions/v1/cerefox-mcp).
  return path.includes(PRS_SUFFIX);
}

/** RFC 9728 Protected Resource Metadata document. */
export function protectedResourceMetadata(): Response {
  const body = {
    resource: resourceUrl(),
    // Anthropic reads authorization_servers[0]; Supabase serves valid AS metadata here.
    authorization_servers: [issuerUrl()],
    bearer_methods_supported: ["header"],
    scopes_supported: ["openid", "email"],
    resource_name: "Cerefox",
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/**
 * 401 with an explicit `resource_metadata` pointer (RFC 9728 §5.1), so clients
 * discover our metadata route rather than probing the domain root.
 */
export function unauthorizedChallenge(result: AuthResult): Response {
  const metadataUrl = `${resourceUrl()}${PRS_SUFFIX}`;
  const invalid = result.ok === false && result.reason !== "no_token";
  const params = [`resource_metadata="${metadataUrl}"`];
  if (invalid) params.push(`error="invalid_token"`);
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer ${params.join(", ")}`,
    },
  });
}

/**
 * Build the authenticator from Function secrets + the injected SUPABASE_URL.
 *
 * Secrets (set via `supabase secrets set`):
 *   CEREFOX_OAUTH_OWNER_ID       — pinned owner user id. The OAuth path fails CLOSED
 *                                  when this is unset (design §6 / Finding 3), unless
 *                                  CEREFOX_OAUTH_ALLOW_ANY_USER="true" is set.
 *   CEREFOX_OAUTH_ALLOW_ANY_USER — explicit opt-out of the owner pin (multi-user /
 *                                  sign-ups-disabled setups). Default off.
 *
 * The non-OAuth static path is the **Cerefox access token** (`CEREFOX_ACCESS_TOKENS`,
 * iter-28E) — the same credential the primitive EFs accept — checked in the handler
 * via `_shared/ef-auth` (see index.ts), NOT here. The legacy `CEREFOX_MCP_STATIC_BEARER`
 * (anon JWT) is retired: `staticBearer` is left unset so this authenticator handles
 * OAuth only.
 */
export function buildAuthenticator(): McpAuthenticator {
  const issuer = issuerUrl();
  const ownerUserId = Deno.env.get("CEREFOX_OAUTH_OWNER_ID") ?? null;
  const allowAnyUser = Deno.env.get("CEREFOX_OAUTH_ALLOW_ANY_USER") === "true";
  return createMcpAuthenticator({
    issuer,
    jwksUri: `${issuer}/.well-known/jwks.json`,
    expectedAudience: "authenticated",
    ownerUserId,
    allowAnyUser,
    staticBearer: null,
    allowedAlgs: ["ES256", "RS256"],
  });
}
