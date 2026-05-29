/**
 * HTTP-boundary tests for the meta endpoints: /version, /docs,
 * /docs/{path}, /schema-version.
 *
 * Migrates `tests/api/test_docs_endpoints.py` to TS per the test
 * migration policy (design doc § 12, v0.6.0). The Python file used
 * FastAPI's TestClient + a mocked CerefoxClient; the TS port spawns
 * the real bin on a random port and hits its endpoints over HTTP.
 * /version + /docs + /docs/{path} don't touch Supabase so they run
 * unconditionally; /schema-version probe-and-skips on Supabase.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { probeSupabase, spawnWebServer, type SpawnedServer } from "./_helpers.js";

const LIVE_OK = probeSupabase();

describe("meta endpoints (HTTP boundary)", () => {
  let server: SpawnedServer | null = null;

  beforeAll(async () => {
    server = await spawnWebServer();
  });

  afterAll(async () => {
    if (server) await server.stop();
  });

  // ── /api/v1/version ────────────────────────────────────────────────────────

  test("/version returns {version, git_commit_short, build_date}", async () => {
    if (!server) return;
    const resp = await fetch(`${server.base}/api/v1/version`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(Object.keys(body).sort()).toEqual(
      ["build_date", "git_commit_short", "version"].sort(),
    );
    expect(typeof body.version).toBe("string");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  // ── /api/v1/docs ───────────────────────────────────────────────────────────

  test("/docs returns a non-empty list with {path,title,category} entries", async () => {
    if (!server) return;
    const resp = await fetch(`${server.base}/api/v1/docs`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    for (const entry of body) {
      expect(Object.keys(entry).sort()).toEqual(["category", "path", "title"]);
    }
  });

  test("/docs includes README + AGENT guides", async () => {
    if (!server) return;
    const resp = await fetch(`${server.base}/api/v1/docs`);
    const body = (await resp.json()) as Array<{ path: string }>;
    const paths = body.map((e) => e.path);
    expect(paths).toContain("README.md");
    expect(paths).toContain("AGENT_GUIDE.md");
    expect(paths).toContain("AGENT_QUICK_REFERENCE.md");
  });

  // ── /api/v1/docs/{path} ────────────────────────────────────────────────────

  test("/docs/README.md returns markdown content", async () => {
    if (!server) return;
    const resp = await fetch(`${server.base}/api/v1/docs/README.md`);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/markdown");
    const text = await resp.text();
    expect(text).toContain("Cerefox");
  });

  test("/docs/{unknown} returns 404", async () => {
    if (!server) return;
    const resp = await fetch(
      `${server.base}/api/v1/docs/guides/nonexistent-xyz.md`,
    );
    expect(resp.status).toBe(404);
  });

  test("/docs/{path} guards against path-traversal", async () => {
    if (!server) return;
    // Direct ../ inside a path param — Hono's `:path{.+}` matcher passes
    // them through to our handler. The resolver in `web/docs.ts` rejects
    // anything that escapes the docs roots.
    const attacks = [
      "/api/v1/docs/../../etc/passwd",
      "/api/v1/docs/guides/../../etc/passwd",
      "/api/v1/docs/..%2F..%2Fetc%2Fpasswd",
    ];
    for (const path of attacks) {
      const resp = await fetch(`${server.base}${path}`);
      // Either 404 (our guard caught it), 400, or the HTTP client
      // collapsed `../` before sending — in any case the body must
      // never contain real `/etc/passwd` content.
      expect([400, 404]).toContain(resp.status);
      const text = await resp.text();
      expect(text).not.toContain("root:x:");
    }
  });

  // ── /api/v1/schema-version ─────────────────────────────────────────────────

  test("/schema-version returns {bundled, deployed, mismatch}", async () => {
    if (!server) return;
    if (!LIVE_OK) {
      console.log("(skipped: Supabase not reachable)");
      return;
    }
    const resp = await fetch(`${server.base}/api/v1/schema-version`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    // Core mismatch-banner contract: bundled / deployed / mismatch. iter-26C
    // added compatibility classification fields (level, min) — assert the core
    // keys are present rather than an exact set so the endpoint can grow.
    for (const key of ["bundled", "deployed", "mismatch"]) {
      expect(Object.keys(body)).toContain(key);
    }
    expect(typeof body.mismatch).toBe("boolean");
    // bundled / deployed may be null if the schema.sql @version marker is
    // missing or the RPC isn't deployed; we don't assert specific values
    // beyond shape — same as the Python test's permissive contract.
  });

  test("/schema-version mismatch=false on a healthy deployment", async () => {
    if (!server) return;
    if (!LIVE_OK) return;
    const body = (await (
      await fetch(`${server.base}/api/v1/schema-version`)
    ).json()) as { bundled: string | null; deployed: string | null; mismatch: boolean };
    // When both values resolve, they should match the deployed schema.sql.
    // When either is null (legacy / pre-RPC), mismatch should stay false.
    if (body.bundled && body.deployed) {
      expect(body.mismatch).toBe(body.bundled !== body.deployed);
    } else {
      expect(body.mismatch).toBe(false);
    }
  });
});
