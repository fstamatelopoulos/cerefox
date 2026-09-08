/**
 * Smoke tests for `cerefox web start/stop/status` daemon mode (iter-26 Part 26F).
 *
 * The full start→status→stop lifecycle binds a real port + spawns a detached
 * process, which is awkward in CI, so the live lifecycle is covered by the
 * manual test plan (§ 14). Here we cover the CLI surface + the
 * status-when-stopped path, which are deterministic and need no network.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG_ROOT, "dist", "bin", "cerefox.js");

function run(
  args: string[],
  extraEnv: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  if (!existsSync(BIN)) {
    throw new Error(`Built bin not found at ${BIN}. Run \`bun run build\` first.`);
  }
  const result = spawnSync("node", [BIN, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    timeout: 15_000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? -1,
  };
}

describe("cerefox web daemon CLI", () => {
  test("`web --help` lists the start/stop/status subcommands", () => {
    const { stdout, status } = run(["web", "--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("start");
    expect(stdout).toContain("stop");
    expect(stdout).toContain("status");
  });

  test("`web start --help` advertises host/port", () => {
    const { stdout, status } = run(["web", "start", "--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("--host");
    expect(stdout).toContain("--port");
    expect(stdout).toContain("background");
  });

  test("`web start --port` rejects an invalid port", () => {
    const { status, stderr } = run(["web", "start", "--port", "notaport"]);
    expect(status).toBe(2);
    expect(stderr).toContain("Invalid --port");
  });

  // v1.14.2 (#252): a daemon left running across an in-place `self-update`
  // keeps serving the previous build. `web status` and `doctor` must say so;
  // silence is what turned a stale daemon into a blank page nobody could
  // explain. Driven through a stub server + a pidfile in an isolated
  // CEREFOX_CONFIG_DIR, so it touches neither a store nor the real daemon.
  test("`web status` flags a daemon serving a different version", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cfx-web-status-"));
    // Bun.serve, not node:http: a node:http server hosted from the bun test
    // process was not reachable from the spawned node child, which cost an
    // hour of chasing a bug that was in the harness.
    const stub = Bun.serve({
      port: 0,
      fetch: () => Response.json({ version: "0.0.1-stale", git_commit_short: null }),
    });
    try {
      writeFileSync(
        join(dir, "web.pid"),
        JSON.stringify({
          // Our own pid: alive, so the status is "running", not "stale".
          pid: process.pid,
          port: stub.port,
          host: "127.0.0.1",
          startedAt: new Date().toISOString(),
        }),
      );
      // Async spawn, NOT the spawnSync helper: spawnSync blocks bun's event
      // loop, so the in-process stub cannot answer the child's probe and the
      // daemon reads as "alive but not responding". That cost an hour; the
      // comment is cheaper than the second hour.
      const proc = Bun.spawn(["node", BIN, "web", "status"], {
        env: { ...process.env, CEREFOX_CONFIG_DIR: dir },
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      expect(await proc.exited).toBe(0);
      expect(stdout).toContain("running");
      expect(stdout).toContain("0.0.1-stale");
      // The remediation has to be in the output, not just the diagnosis.
      expect(stdout).toContain("cerefox web stop && cerefox web start");
    } finally {
      await stub.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("`web status` reports a state line (stopped/running/stale)", () => {
    // Deterministic regardless of whether a daemon happens to be running:
    // the output is always one of the three known status lines.
    const { stdout, status } = run(["web", "status"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/Cerefox web: (stopped|running|stale|process)/);
  });
});
