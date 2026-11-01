/**
 * Config-gated `/rest/v1/*` reverse-proxy → PostgREST.
 *
 * supabase-js calls `${url}/rest/v1/<table|rpc>`; a standalone PostgREST serves at
 * root. In the LOCAL self-hosted deployment (design §5.2), cerefox-server is the
 * single gateway: it proxies `/rest/v1/*` to the local PostgREST upstream so the
 * unchanged CLI / MCP / web (and the server's own data client) reach the Data API
 * through one URL — no separate Kong/Caddy.
 *
 * Mounted ONLY when `CEREFOX_POSTGREST_UPSTREAM` is set. Cloud / normal deployments
 * don't set it, so this route never registers and behavior there is unchanged — the
 * route cannot "leak" into the shared server.
 *
 * Credentials (#351): a caller admitted by the gate with the API key reaches
 * PostgREST as the container's service role. See {@link upstreamCredentials}.
 */

import type { Hono } from "hono";

import type { AdmitReason } from "../auth.ts";

// Hop-by-hop / encoding headers we must not copy verbatim across the proxy.
const STRIP_RESPONSE_HEADERS = [
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "content-encoding",
  "te",
  "trailer",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
];

/**
 * Set the credentials PostgREST sees, in place; true when they were replaced.
 *
 * PostgREST accepts only a JWT, so a `cfx_lak_` API key forwarded as-is is
 * refused ("Expected 3 parts in JWT"), and the CLI and the local MCP server
 * could not use a gated container from another machine. When the gate
 * admitted the request because it presented a valid key, both auth headers
 * are replaced with the container's internal service-role JWT. The JWT is
 * added on the way upstream and never returned to the caller.
 *
 * Any other reason forwards the caller's headers untouched: a request let in
 * without a key (gate off, the loopback exemption) must never gain the
 * service role from this proxy. So must a request that reached here without
 * passing the gate at all, which has no reason set.
 *
 * Responses are passed through as PostgREST sends them, so "never returned"
 * rests on PostgREST, which does not echo request headers. The proxy itself
 * adds the JWT to no response and no log line.
 */
export function upstreamCredentials(
  headers: Headers,
  reason: AdmitReason | undefined,
  internalJwt: string,
): boolean {
  const jwt = internalJwt.trim();
  if (reason !== "valid_key" || !jwt) return false;
  headers.set("authorization", `Bearer ${jwt}`);
  headers.set("apikey", jwt);
  return true;
}

export function registerPostgrestProxy(app: Hono): void {
  const upstream = (process.env.CEREFOX_POSTGREST_UPSTREAM ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (!upstream) return; // gate: not a local self-hosted deployment → no proxy route

  app.all("/rest/v1/*", async (c) => {
    const url = new URL(c.req.url);
    const path = url.pathname.replace(/^\/rest\/v1/, "");
    const target = `${upstream}${path}${url.search}`;

    const headers = new Headers(c.req.raw.headers);
    headers.delete("host");
    headers.delete("accept-encoding"); // avoid upstream compression / decompress mismatch
    upstreamCredentials(headers, c.get("cerefoxAuthReason"), process.env.CEREFOX_SUPABASE_KEY ?? "");

    const method = c.req.method;
    const init: RequestInit & { duplex?: "half" } = { method, headers };
    if (method !== "GET" && method !== "HEAD") {
      init.body = c.req.raw.body;
      init.duplex = "half"; // required by Node/undici when streaming a request body
    }

    let resp: Response;
    try {
      resp = await fetch(target, init);
    } catch (err) {
      return c.json(
        {
          detail: `PostgREST upstream unreachable: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
        502,
      );
    }

    const respHeaders = new Headers(resp.headers);
    for (const h of STRIP_RESPONSE_HEADERS) respHeaders.delete(h);
    return new Response(resp.body, { status: resp.status, headers: respHeaders });
  });
}
