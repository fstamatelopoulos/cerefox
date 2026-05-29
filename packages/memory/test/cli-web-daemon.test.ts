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
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG_ROOT, "dist", "bin", "cerefox.js");

function run(args: string[]): { stdout: string; stderr: string; status: number } {
  if (!existsSync(BIN)) {
    throw new Error(`Built bin not found at ${BIN}. Run \`bun run build\` first.`);
  }
  const result = spawnSync("node", [BIN, ...args], {
    encoding: "utf8",
    env: { ...process.env },
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

  test("`web status` reports a state line (stopped/running/stale)", () => {
    // Deterministic regardless of whether a daemon happens to be running:
    // the output is always one of the three known status lines.
    const { stdout, status } = run(["web", "status"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/Cerefox web: (stopped|running|stale|process)/);
  });
});
