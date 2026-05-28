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
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");
const BIN = join(PKG_ROOT, "dist", "bin", "cerefox.js");

// Bind to a high random port to avoid clashing with any locally-running
// Python / TS web server on 8000.
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;

async function waitForPort(url: string, deadlineMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
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

    try {
      const ready = await waitForPort(`${BASE}/api/v1/version`);
      if (!ready) {
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
});
