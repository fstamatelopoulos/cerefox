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
 * Origin of the deployed project, e.g. `https://<ref>.supabase.co`.
 *
 * Behind Supabase's internal proxy `req.url` is `http://…`, but the public origin
 * is always https (and Anthropic requires the `resource`/`authorization_servers`
 * URLs to be https and to match the connector URL exactly). So we honor
 * `x-forwarded-proto`/`x-forwarded-host` and default to https for any non-local host.
 */
function projectOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const isLocal = host.startsWith("localhost") || host.startsWith("127.");
  const proto = req.headers.get("x-forwarded-proto") ?? (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}

/** Absolute URL of this MCP server (the `resource` identifier — must match exactly). */
export function resourceUrl(req: Request): string {
  return `${projectOrigin(req)}${FUNCTION_PATH}`;
}

/** The Supabase auth server issuer for this project. */
export function issuerUrl(req: Request): string {
  return `${projectOrigin(req)}/auth/v1`;
}

/** True when the request targets the (public) protected-resource metadata route. */
export function isProtectedResourceMetadata(req: Request): boolean {
  const path = new URL(req.url).pathname;
  // Accept both the plain suffix and the RFC 9728 path-insertion form
  // (…/oauth-protected-resource/functions/v1/cerefox-mcp).
  return path.includes(PRS_SUFFIX);
}

/** RFC 9728 Protected Resource Metadata document. */
export function protectedResourceMetadata(req: Request): Response {
  const body = {
    resource: resourceUrl(req),
    // Anthropic reads authorization_servers[0]; Supabase serves valid AS metadata here.
    authorization_servers: [issuerUrl(req)],
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
export function unauthorizedChallenge(req: Request, result: AuthResult): Response {
  const metadataUrl = `${resourceUrl(req)}${PRS_SUFFIX}`;
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
 * Build the authenticator from Function secrets. Deriving issuer/JWKS from the
 * request keeps the function project-portable (no hardcoded ref).
 *
 * Secrets (set via `supabase secrets set`, reliable unlike auto-injected vars):
 *   CEREFOX_MCP_STATIC_BEARER — legacy anon JWT for back-compat (falls back to the
 *                               auto-injected SUPABASE_ANON_KEY when present).
 *   CEREFOX_OAUTH_OWNER_ID    — pinned owner user id (optional; unset = accept any
 *                               validly-signed authenticated token).
 */
export function buildAuthenticator(req: Request): McpAuthenticator {
  const issuer = issuerUrl(req);
  const staticBearer =
    Deno.env.get("CEREFOX_MCP_STATIC_BEARER") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? null;
  const ownerUserId = Deno.env.get("CEREFOX_OAUTH_OWNER_ID") ?? null;
  return createMcpAuthenticator({
    issuer,
    jwksUri: `${issuer}/.well-known/jwks.json`,
    expectedAudience: "authenticated",
    ownerUserId,
    staticBearer,
    allowedAlgs: ["ES256", "RS256"],
  });
}
