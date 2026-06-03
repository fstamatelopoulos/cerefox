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
 */

import type { Hono } from "hono";

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
