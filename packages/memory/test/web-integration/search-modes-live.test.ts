/**
 * Live: every search mode runs its own search on every surface (#377).
 *
 * Until 1.25.0, MCP's `semantic` (and any unknown mode) ran the default docs
 * search, the CLI had no `semantic` at all, and `/api/v1/search` ran an
 * unknown mode as docs too. The unit test pins each mode to its RPC; this
 * checks, against a real store, that the CLI and the API now agree on what
 * `semantic` returns and both refuse a mode that does not exist.
 *
 * Read-only: it searches and never writes. Skips when the target is
 * unreachable.
 */

import { afterAll, beforeAll, describe, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { liveTest } from "../_live-test.ts";
import { probeSupabase, spawnWebServer, type SpawnedServer } from "./_helpers.js";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIN = join(PKG_ROOT, "dist", "bin", "cerefox.js");
const LIVE_OK = probeSupabase();
const Q = "release process";

function cli(args: string[]) {
  const r = spawnSync("node", [BIN, ...args], { encoding: "utf8", env: { ...process.env } });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

interface ChunkRow {
  chunk_id?: string;
  document_id: string;
  score: number;
  full_content?: string;
}

describe("search modes on the CLI and the API (#377, live)", () => {
  let server: SpawnedServer | null = null;

  beforeAll(async () => {
    if (LIVE_OK) server = await spawnWebServer();
  });
  afterAll(async () => {
    await server?.stop();
  });

  liveTest("the CLI runs --mode semantic and returns chunks, best first", () => {
    if (!LIVE_OK) return;
    const r = cli(["search", Q, "--mode", "semantic", "--match-count", "5", "--json", "--author", "e2e-test"]);
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: expect.any(String) });
    const out = JSON.parse(r.stdout) as { mode: string; results: ChunkRow[] };
    expect(out.mode).toBe("semantic");
    expect(out.results.length).toBeGreaterThan(0);
    // Chunks, not documents: a chunk id on every row, no document body.
    expect(out.results.every((row) => typeof row.chunk_id === "string" && row.full_content === undefined)).toBe(true);
    for (let i = 1; i < out.results.length; i++) expect(out.results[i - 1].score).toBeGreaterThanOrEqual(out.results[i].score);
  });

  liveTest("the CLI and the API return the same semantic chunks in the same order", async () => {
    if (!LIVE_OK || !server) return;
    const r = cli(["search", Q, "--mode", "semantic", "--match-count", "5", "--json", "--author", "e2e-test"]);
    const viaCli = (JSON.parse(r.stdout) as { results: ChunkRow[] }).results.map((row) => row.chunk_id);
    const resp = await fetch(`${server.base}/api/v1/search?q=${encodeURIComponent(Q)}&mode=semantic&count=5`);
    expect(resp.status).toBe(200);
    const viaApi = ((await resp.json()) as { results: Array<{ chunk_id: string }> }).results.map((row) => row.chunk_id);
    expect(viaApi).toEqual(viaCli);
  });

  liveTest("semantic is not the docs search any more", () => {
    if (!LIVE_OK) return;
    const sem = cli(["search", Q, "--mode", "semantic", "--json", "--author", "e2e-test"]);
    const docs = cli(["search", Q, "--json", "--author", "e2e-test"]);
    const semRows = (JSON.parse(sem.stdout) as { results: ChunkRow[] }).results;
    const docRows = (JSON.parse(docs.stdout) as { results: ChunkRow[] }).results;
    expect(semRows.some((row) => row.chunk_id)).toBe(true);
    expect(docRows.some((row) => row.chunk_id)).toBe(false);
  });

  liveTest("an unknown mode is refused by the CLI and the API", async () => {
    if (!LIVE_OK) return;
    const r = cli(["search", Q, "--mode", "chunks"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toContain('expected one of "docs", "hybrid", "fts", "semantic"');
    if (!server) return;
    const resp = await fetch(`${server.base}/api/v1/search?q=${encodeURIComponent(Q)}&mode=chunks`);
    expect(resp.status).toBe(400);
    expect(JSON.stringify(await resp.json())).toContain("Invalid mode");
  });
});
