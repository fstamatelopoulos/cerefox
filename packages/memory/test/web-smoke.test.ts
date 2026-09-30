/**
 * Web-server smoke test: boot `cerefox web` from the built bin and verify
 * `/api/v1/version` answers with the expected JSON shape.
 *
 * Part 24A scope — version endpoint only. Later Parts (24C onward) add
 * endpoints that hit Supabase and adopt the probe-and-skip pattern from
 * `stdio-smoke.test.ts`. Version is local-only, so no skip needed here.
 *
 * Runs against the bundle in `dist/bin/cerefox.js`, so a `bun run build`
 * must precede `bun test`. This matches `stdio-smoke.test.ts`'s shape.
 */

import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");
const BIN = join(PKG_ROOT, "dist", "bin", "cerefox.js");

// Bind to a high random port to avoid clashing with any locally-running
// Python / TS web server on 8000.
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;

async function waitForPort(
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
      // Connection refused yet; keep trying.
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe("cerefox web smoke", () => {
  test("bin exists after build", () => {
    if (!existsSync(BIN)) {
      throw new Error(`Built bin not found at ${BIN}. Run \`bun run build\` first.`);
    }
  });

  test("/api/v1/version returns version JSON", async () => {
    if (!existsSync(BIN)) {
      throw new Error(`run \`bun run build\` first`);
    }

    const child = spawn("node", [BIN, "web", "--port", String(PORT)], {
      cwd: REPO_ROOT,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    // A compatibility refusal exits immediately; noticing that turns a 5s
    // timeout into an instant, explicable skip.
    let exited = false;
    child.on("exit", () => {
      exited = true;
    });

    try {
      const ready = await waitForPort(`${BASE}/api/v1/version`, 5_000, () => exited);
      if (!ready) {
        // `cerefox web` deliberately refuses to boot when the deployed schema is
        // below this client's minimum ("Refusing to start"). That is correct
        // behaviour, not a broken build — a developer whose store is mid-upgrade
        // should see a skip here, not a red suite. Same probe-and-skip spirit as
        // the Supabase-backed suites.
        if (/Refusing to start|below the required/.test(stderr)) {
          console.log(
            "(skipped: deployed schema is below this client's minimum — run `cerefox server deploy`)",
          );
          return;
        }
        throw new Error(`Web server did not become ready within 5s. stderr:\n${stderr}`);
      }

      const resp = await fetch(`${BASE}/api/v1/version`);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body).toHaveProperty("version");
      expect(typeof body.version).toBe("string");
      expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(body).toHaveProperty("git_commit_short");
      expect(body).toHaveProperty("build_date");
    } finally {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  test("/api/v1/schema-version reads the BUNDLED schema version from the built bin", async () => {
    // Every published install answered `bundled: null`: the route guessed the
    // path relative to its own source file, which is wrong once bundled into
    // dist/bin/cerefox.js, so the web UI's redeploy banner could never fire.
    // Run the built bin from an unrelated cwd with no config, so only the
    // bundled dist/server-assets layout can satisfy it and no database is
    // touched (ctx is null without credentials; `deployed` is then null).
    if (!existsSync(BIN)) throw new Error("run `bun run build` first");
    const expected = readFileSync(join(REPO_ROOT, "src", "cerefox", "db", "schema.sql"), "utf8").match(
      /^--\s*@version:\s*(\S+)/m,
    )?.[1];
    expect(expected).toMatch(/^\d+\.\d+\.\d+/);

    const empty = mkdtempSync(join(tmpdir(), "cfx-smoke-"));
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !/^(CEREFOX_|SUPABASE_|OPENAI_)/.test(k)) env[k] = v;
    }
    env.CEREFOX_CONFIG_DIR = empty;
    const port = PORT + 1;
    const child = spawn("node", [BIN, "web", "--port", String(port)], {
      cwd: empty,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    let exited = false;
    child.on("exit", () => {
      exited = true;
    });
    try {
      const url = `http://127.0.0.1:${port}/api/v1/schema-version`;
      const ready = await waitForPort(url, 5_000, () => exited);
      if (!ready) throw new Error(`Web server did not become ready. stderr:\n${stderr}`);
      const body = (await (await fetch(url)).json()) as { bundled: string | null; deployed: string | null };
      expect(body.bundled).toBe(expected);
      expect(body.deployed).toBeNull();
    } finally {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 100));
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
