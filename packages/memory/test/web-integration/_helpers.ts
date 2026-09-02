/**
 * Shared helpers for HTTP-boundary tests under `web-integration/`.
 *
 * Each test file in this directory:
 *   - spawns the built `cerefox web` bin on a random high port,
 *   - probes Supabase availability before exercising any DB-touching
 *     endpoint (skip if unreachable, same shape as `stdio-smoke.test.ts`),
 *   - cleans up any state it created via the `[E2E web-...]` prefix.
 *
 * These tests are the v0.6 HTTP-boundary parity layer (plan.md §
 * Iteration 24 + design doc § 12 "Test migration policy"). They
 * replace `tests/api/test_docs_endpoints.py` and add the curl-level
 * destructive-endpoint coverage that was the 24L follow-up gap.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "../../../../_shared/config/index.js";

// Populate process.env from <repo>/.env (or ~/.cerefox/.env) before
// tests run. Mirrors what `node bin/cerefox.js …` does when it boots.
// Idempotent; safe to call multiple times across test files.
loadEnv();

const HERE = dirname(fileURLToPath(import.meta.url));
export const PKG_ROOT = join(HERE, "..", "..");
export const REPO_ROOT = join(PKG_ROOT, "..", "..");
export const BIN = join(PKG_ROOT, "dist", "bin", "cerefox.js");

export function freshPort(): number {
  return 18000 + Math.floor(Math.random() * 5000);
}

/**
 * Probe Supabase reachability. Delegates to the single shared implementation
 * in `../_live-probe.ts` — this file used to carry its own copy calling
 * `cerefox list-projects`, a verb renamed in v0.9.0, so every test in this
 * directory skipped for eleven releases while reporting success.
 */
export { probeSupabase } from "../_live-probe.ts";

export interface SpawnedServer {
  child: ChildProcess;
  port: number;
  base: string;
  stop: () => Promise<void>;
}

export async function waitForPort(
  url: string,
  deadlineMs = 5_000,
  hasExited?: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (hasExited?.()) return false;   // process gave up; no point polling on
    try {
      const resp = await fetch(url, { method: "GET" });
      if (resp.ok || resp.status === 404) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

export async function spawnWebServer(): Promise<SpawnedServer | null> {
  if (!existsSync(BIN)) {
    throw new Error(`Built bin not found at ${BIN}. Run \`bun run build\` first.`);
  }
  const port = freshPort();
  const child = spawn("node", [BIN, "web", "--port", String(port)], {
    cwd: REPO_ROOT,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (c: Buffer) => {
    stderr += c.toString();
  });
  // A compatibility refusal EXITS immediately. Without noticing that we would
  // poll the full deadline and blow the hook's own timeout, turning a clean
  // skip into an opaque failure.
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });
  const base = `http://127.0.0.1:${port}`;
  const ready = await waitForPort(`${base}/api/v1/version`, 5_000, () => exited);
  if (!ready) {
    child.kill("SIGTERM");
    // `cerefox web` refuses to boot when the deployed schema is below this
    // client's minimum. That is correct behaviour, so surface it as a skip
    // (null) rather than a failure — the same treatment an unreachable Supabase
    // already gets. Callers already handle a null server by skipping.
    if (/Refusing to start|below the required/.test(stderr)) {
      return null;
    }
    throw new Error(`Web server did not become ready within 5s. stderr:\n${stderr}`);
  }
  const stop = async () => {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 100));
  };
  return { child, port, base, stop };
}

/**
 * (Removed in iter-40.) `ingestViaEdgeFunction()` created fixtures through the
 * deployed `cerefox-ingest` Edge Function. It dated from v0.6, when the web
 * `/api/v1/ingest` route was a 503 stub. That has not been true since v0.7, so
 * the helper only bought a live Edge Function invocation per fixture — against
 * a free-tier quota, from a suite that is not one of the two CEREFOX_LIVE_E2E
 * suites allowed to spend it. Its only caller now ingests over HTTP like every
 * other test here. Deleted rather than left in place: an unused helper that
 * quietly bills is one someone reaches for again.
 */
