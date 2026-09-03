/**
 * The #229 auth gate, enforced by a REAL server over HTTP.
 *
 * `../web-auth.test.ts` exhausts the decision table as a pure function. This
 * file proves the part a unit test cannot: that the middleware is actually
 * mounted, on both surfaces, ahead of the routes it protects.
 *
 * ## Why every request here comes from loopback
 *
 * A test cannot easily originate a connection from a non-loopback address, and
 * faking one would mean trusting a header — the exact thing the design forbids.
 * So the remote path is exercised the honest way instead:
 * `CEREFOX_API_REQUIRE_KEY=1` makes the gate demand a key from *every* caller,
 * loopback included. The branch under test (key present / absent / wrong) is
 * the same code either way; only the loopback shortcut is bypassed.
 *
 * These tests need no database: they assert on the gate, which runs before any
 * route touches Supabase. They do need the built bin.
 */

import { afterAll, describe, expect, test } from "bun:test";

import { spawnWebServer, type SpawnedServer } from "./_helpers.js";

const KEY = "cfx_lak_integrationtestkey_do_not_use";

describe("/api/v1 + /rest/v1 auth gate (HTTP boundary)", () => {
  const servers: SpawnedServer[] = [];

  afterAll(async () => {
    for (const s of servers) await s.stop();
  });

  async function server(env: Record<string, string | undefined>): Promise<SpawnedServer | null> {
    const s = await spawnWebServer(env);
    if (s) servers.push(s);
    return s;
  }

  test("no key configured: the server behaves exactly as before #229", async () => {
    // The compatibility promise, asserted rather than assumed. Every existing
    // install is in this state on upgrade.
    const s = await server({ CEREFOX_API_KEY: undefined, CEREFOX_API_REQUIRE_KEY: undefined });
    if (!s) return;
    const resp = await fetch(`${s.base}/api/v1/version`);
    expect(resp.status).toBe(200);
  });

  test("key configured, loopback caller: still no credential needed", async () => {
    // This is what keeps the browser and every local agent working untouched.
    const s = await server({ CEREFOX_API_KEY: KEY, CEREFOX_API_REQUIRE_KEY: undefined });
    if (!s) return;
    const resp = await fetch(`${s.base}/api/v1/version`);
    expect(resp.status).toBe(200);
  });

  describe("with the gate forced on (stands in for a remote caller)", () => {
    let s: SpawnedServer | null = null;

    test("a request with no credential is challenged", async () => {
      s = await server({ CEREFOX_API_KEY: KEY, CEREFOX_API_REQUIRE_KEY: "1" });
      if (!s) return;
      const resp = await fetch(`${s.base}/api/v1/version`);
      expect(resp.status).toBe(401);
      expect(resp.headers.get("WWW-Authenticate") ?? "").toContain("Bearer");
      const body = (await resp.json()) as { detail?: string };
      // `detail`, because that is the field the frontend's ApiError reads and
      // the one every other /api/v1 error uses.
      expect(body.detail ?? "").toBeTruthy();
    });

    test("a wrong key is refused", async () => {
      if (!s) return;
      const resp = await fetch(`${s.base}/api/v1/version`, {
        headers: { Authorization: "Bearer cfx_lak_wrong" },
      });
      expect(resp.status).toBe(401);
    });

    test("the right key is accepted", async () => {
      if (!s) return;
      const resp = await fetch(`${s.base}/api/v1/version`, {
        headers: { Authorization: `Bearer ${KEY}` },
      });
      expect(resp.status).toBe(200);
    });

    test("X-Forwarded-For claiming loopback does NOT open the gate", async () => {
      // The request really is from loopback here, so this alone cannot prove
      // the header is ignored. What it proves is that the header does not
      // create an exemption of its own: with the gate forced on, a caller
      // asserting `127.0.0.1` is still challenged. Combined with the unit
      // test's structural check (no header ever reaches `decideAuth`), the
      // property is covered from both sides.
      if (!s) return;
      for (const header of ["X-Forwarded-For", "X-Real-IP", "X-Forwarded-Host"]) {
        const resp = await fetch(`${s.base}/api/v1/version`, {
          headers: { [header]: "127.0.0.1" },
        });
        expect(resp.status).toBe(401);
      }
    });

    test("a write route is gated too, not only the cheap read", async () => {
      if (!s) return;
      const resp = await fetch(`${s.base}/api/v1/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "should never be stored", content: "# no\n" }),
      });
      expect(resp.status).toBe(401);
    });

    test("the PostgREST passthrough is gated too", async () => {
      // The most likely way this ships half-done: /rest/v1/* is a SECOND
      // surface on the same port, live on Cerefox Local, forwarding caller
      // headers verbatim to PostgREST. A gate on /api/v1 alone would move the
      // hole rather than close it.
      //
      // 404 is a pass here as well as 401: the proxy route only registers when
      // CEREFOX_POSTGREST_UPSTREAM is set, which it is not in this suite. What
      // must never happen is a 2xx.
      if (!s) return;
      const resp = await fetch(`${s.base}/rest/v1/cerefox_documents?limit=1`);
      expect([401, 404]).toContain(resp.status);
      expect(resp.ok).toBe(false);
    });
  });
});
