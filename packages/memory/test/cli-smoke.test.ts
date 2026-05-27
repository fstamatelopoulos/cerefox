/**
 * `cerefox` CLI smoke test.
 *
 * Spawns the built bin and verifies the basic contract holds:
 *
 *   1. `--version` prints a semver and exits 0.
 *   2. `--help` lists at least the 25 expected subcommands and exits 0.
 *   3. Unknown subcommand exits 1 (user error per the documented exit-code table).
 *   4. Stub commands (any v0.5-pending command) exit 2 (system error) with
 *      a "not yet implemented" message pointing at plan.md.
 *   5. `cerefox web` and `cerefox reindex` print the deferred-implementation
 *      message and exit 0 (they're intentional v0.5 user-facing stubs, not bugs).
 *
 * The smoke test depends on `bun run build` having produced `dist/bin/cerefox.js`
 * — same prerequisite as the v0.4 `stdio-smoke.test.ts`.
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
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? -1,
  };
}

describe("cerefox CLI smoke (built bin)", () => {
  test("bin exists after build", () => {
    if (!existsSync(BIN)) {
      throw new Error(`Run \`bun run build\` from packages/memory first.`);
    }
  });

  test("--version exits 0 and prints a semver", () => {
    const { stdout, status } = run(["--version"]);
    expect(status).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("--help exits 0 and lists every expected subcommand", () => {
    const { stdout, status } = run(["--help"]);
    expect(status).toBe(0);
    // Spot-check a representative slice from each category.
    const expectedCommands = [
      // Reads
      "search",
      "get-doc",
      "list-docs",
      "list-versions",
      "list-projects",
      "list-metadata-keys",
      "metadata-search",
      "get-audit-log",
      // Writes
      "ingest",
      "ingest-dir",
      "delete-doc",
      // Servers
      "mcp",
      "web",
      // Lifecycle
      "init",
      "doctor",
      "status",
      "configure-agent",
      "self-update",
      "upgrade",
      "sync-self-docs",
      // Ops
      "backup",
      "restore",
      "sync-docs",
      "docs",
      "reindex",
      "config-get",
      "config-set",
      "completion",
    ];
    for (const cmd of expectedCommands) {
      expect(stdout).toContain(cmd);
    }
  });

  test("unknown subcommand exits 1 (user error)", () => {
    const { status } = run(["this-command-does-not-exist"]);
    expect(status).toBe(1);
  });

  test("stub command (completion) exits 2 (system error) with not-yet-implemented hint", () => {
    // `completion` lands in Part 23G.1 (tab completion). Pick a command
    // we know stays a stub longer than the surrounding parts so this
    // assertion doesn't break as the migration proceeds. Once 23G ships,
    // either swap to a still-stubbed command or remove this test.
    const { stderr, status } = run(["completion", "bash"]);
    expect(status).toBe(2);
    expect(stderr).toContain("not yet implemented");
    expect(stderr).toContain("23G.1");
  });

  test("`cerefox web` prints v0.5-deferred message and exits 0", () => {
    const { stdout, stderr, status } = run(["web"]);
    expect(status).toBe(0);
    const all = stdout + stderr;
    expect(all).toContain("v0.6");
    expect(all).toContain("uv run cerefox web");
  });

  test("`cerefox reindex` prints v0.7-deferred message and exits 0", () => {
    const { stdout, stderr, status } = run(["reindex"]);
    expect(status).toBe(0);
    const all = stdout + stderr;
    expect(all).toContain("v0.7");
    expect(all).toContain("uv run cerefox reindex");
  });
});
