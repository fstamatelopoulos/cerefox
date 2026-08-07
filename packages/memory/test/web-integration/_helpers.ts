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

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
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
 * Probe Supabase reachability via the same `cerefox list-projects --json`
 * call the stdio smoke uses. Returns true when the live backend answered;
 * tests gate their DB-touching assertions on this.
 */
export function probeSupabase(): boolean {
  if (!existsSync(BIN)) return false;
  const result = spawnSync("node", [BIN, "list-projects", "--json"], {
    cwd: REPO_ROOT,
    env: { ...process.env },
    timeout: 5_000,
  });
  return result.status === 0;
}

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
 * Create a test document via the deployed `cerefox-ingest` Edge
 * Function. Used by tests that need a real document_id to exercise
 * mutations against (since v0.6's web `/api/v1/ingest` returns 503).
 *
 * Reads CEREFOX_SUPABASE_URL + CEREFOX_ACCESS_TOKEN from the env (the EFs
 * validate the Cerefox access token in-function, iter-28E).
 * Returns the new document's id.
 */
export async function ingestViaEdgeFunction(opts: {
  title: string;
  content: string;
  author?: string;
}): Promise<string> {
  const url = process.env.CEREFOX_SUPABASE_URL;
  const key = process.env.CEREFOX_ACCESS_TOKEN;
  if (!url || !key) {
    throw new Error("CEREFOX_SUPABASE_URL + CEREFOX_ACCESS_TOKEN required for ingestViaEdgeFunction");
  }
  const resp = await fetch(`${url}/functions/v1/cerefox-ingest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: opts.title,
      content: opts.content,
      source: "test",
      author: opts.author ?? "web-integration-test",
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`cerefox-ingest EF returned ${resp.status}: ${text}`);
  }
  const body = (await resp.json()) as { document_id?: string; id?: string };
  const id = body.document_id ?? body.id;
  if (!id) {
    throw new Error(`cerefox-ingest EF returned no document_id: ${JSON.stringify(body)}`);
  }
  return id;
}
