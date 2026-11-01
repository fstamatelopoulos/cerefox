/**
 * The `/rest/v1` proxy swaps a valid API key for the container's internal JWT (#351).
 *
 * The CLI and the local MCP server reach a Cerefox Local through this proxy.
 * PostgREST accepts only a JWT, so before the swap a gated container on another
 * host refused them ("Expected 3 parts in JWT; got 1"). The swap is the
 * security-sensitive part: it must fire only for a request the gate admitted
 * with a valid key, and the internal JWT must never reach the caller.
 *
 * A stub upstream stands in for PostgREST and echoes what it received.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { API_KEY_PREFIX, apiAuth, restGatewayKeys } from "../src/web/auth.ts";
import { registerPostgrestProxy, upstreamCredentials } from "../src/web/routes/postgrest-proxy.ts";

const KEY = `${API_KEY_PREFIX}testkeytestkeytestkeytestkey`;
const OTHER = `${API_KEY_PREFIX}differentdifferentdifferent`;
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig";

const ENV_KEYS = [
  "CEREFOX_POSTGREST_UPSTREAM",
  "CEREFOX_SUPABASE_KEY",
  "CEREFOX_API_KEY",
  "CEREFOX_API_REQUIRE_KEY",
] as const;
const saved: Record<string, string | undefined> = {};

let upstream: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  // Echoes the auth headers it received; a 401 path echoes them too, so a
  // leak through an upstream error would show up in the body.
  upstream = Bun.serve({
    port: 0,
    fetch(req) {
      const body = {
        authorization: req.headers.get("authorization"),
        apikey: req.headers.get("apikey"),
        path: new URL(req.url).pathname,
      };
      const status = new URL(req.url).pathname === "/fail" ? 401 : 200;
      return Response.json(body, { status });
    },
  });
  process.env.CEREFOX_POSTGREST_UPSTREAM = `http://127.0.0.1:${upstream.port}`;
  process.env.CEREFOX_SUPABASE_KEY = JWT;
});

afterAll(() => {
  upstream.stop(true);
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** The container's wiring: gate on `/rest/v1` with restGatewayKeys, then the proxy. */
function gatedApp(apiKey: string, requireEverywhere = true): Hono {
  process.env.CEREFOX_API_KEY = apiKey;
  if (requireEverywhere) process.env.CEREFOX_API_REQUIRE_KEY = "1";
  else delete process.env.CEREFOX_API_REQUIRE_KEY;
  const app = new Hono();
  app.use("/rest/v1/*", apiAuth(() => restGatewayKeys()));
  registerPostgrestProxy(app);
  return app;
}

async function call(app: Hono, headers: Record<string, string>, path = "/cerefox_projects", host = "nas.local:8081") {
  const res = await app.request(`http://${host}/rest/v1${path}`, { headers: { Host: host, ...headers } });
  const text = await res.text();
  return { res, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

describe("upstreamCredentials — the swap decision", () => {
  test("replaces both auth headers only for a valid key", () => {
    const h = new Headers({ authorization: `Bearer ${KEY}`, apikey: KEY });
    expect(upstreamCredentials(h, "valid_key", JWT)).toBe(true);
    expect(h.get("authorization")).toBe(`Bearer ${JWT}`);
    expect(h.get("apikey")).toBe(JWT);
  });

  test("never for a request admitted without a key, or one that skipped the gate", () => {
    for (const reason of ["loopback", "disabled", undefined] as const) {
      const h = new Headers({ authorization: `Bearer ${KEY}`, apikey: KEY });
      expect(upstreamCredentials(h, reason, JWT)).toBe(false);
      expect(h.get("authorization")).toBe(`Bearer ${KEY}`);
      expect(h.get("apikey")).toBe(KEY);
    }
    const bare = new Headers();
    expect(upstreamCredentials(bare, "loopback", JWT)).toBe(false);
    expect(bare.get("authorization")).toBeNull();
  });

  test("does nothing without an internal JWT", () => {
    for (const jwt of ["", "   "]) {
      const h = new Headers({ authorization: `Bearer ${KEY}` });
      expect(upstreamCredentials(h, "valid_key", jwt)).toBe(false);
      expect(h.get("authorization")).toBe(`Bearer ${KEY}`);
    }
  });
});

describe("the gated proxy end to end", () => {
  test("a valid key reaches PostgREST as the internal JWT, in both headers", async () => {
    const app = gatedApp(KEY);
    // How supabase-js sends it (the CLI, the local MCP server).
    const both = await call(app, { apikey: KEY, Authorization: `Bearer ${KEY}` });
    expect(both.res.status).toBe(200);
    expect(both.body).toMatchObject({ authorization: `Bearer ${JWT}`, apikey: JWT });
    // Authorization alone gets an apikey too.
    const authOnly = await call(app, { Authorization: `Bearer ${KEY}` });
    expect(authOnly.body).toMatchObject({ authorization: `Bearer ${JWT}`, apikey: JWT });
  });

  test("the container's own data client, presenting the internal JWT, is unchanged", async () => {
    const res = await call(gatedApp(KEY), { apikey: JWT, Authorization: `Bearer ${JWT}` });
    expect(res.res.status).toBe(200);
    expect(res.body).toMatchObject({ authorization: `Bearer ${JWT}`, apikey: JWT });
  });

  test("a keyless, wrong, blank or non-Bearer caller is refused and never reaches PostgREST", async () => {
    const app = gatedApp(KEY);
    const cases: Record<string, string>[] = [
      {},
      { apikey: KEY }, // the key in apikey alone is not a presented key
      { Authorization: `Bearer ${OTHER}` },
      { Authorization: "Bearer " },
      { Authorization: `Basic ${KEY}` },
      { Authorization: KEY },
      { apikey: KEY, Authorization: `Bearer ${OTHER}` },
    ];
    for (const headers of cases) {
      const r = await call(app, headers);
      expect(r.res.status).toBe(401);
      expect(r.body?.path).toBeUndefined(); // the upstream's echo never ran
      expect(r.text).not.toContain(JWT);
    }
  });

  test("gate off: headers pass through untouched, and nothing gains the service role", async () => {
    const app = gatedApp("", false);
    // An IP Host: a keyless server refuses a name it was not told about (browserGuard).
    const r = await call(app, { apikey: KEY, Authorization: `Bearer ${KEY}` }, "/cerefox_projects", "127.0.0.1:8010");
    expect(r.res.status).toBe(200);
    expect(r.body).toMatchObject({ authorization: `Bearer ${KEY}`, apikey: KEY });
    const bare = await call(app, {}, "/cerefox_projects", "127.0.0.1:8010");
    expect(bare.body).toMatchObject({ authorization: null, apikey: null });
  });

  test("the proxy puts the internal JWT in no response header, success or upstream error", async () => {
    const app = gatedApp(KEY);
    for (const path of ["/cerefox_projects", "/fail"]) {
      const r = await call(app, { Authorization: `Bearer ${KEY}` }, path);
      const leaked = [...r.res.headers.values()].some((v) => v.includes(JWT));
      expect(leaked).toBe(false);
      // The stub echoes what it received; the proxy forwards the body, so this
      // only proves the swap happened. The real PostgREST never echoes headers.
      expect(r.body.authorization).toBe(`Bearer ${JWT}`);
    }
  });
});
