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
    // v0.9.0: the surface is resource-verb. Top-level `--help` lists the
    // resource groups + the flat commands (old flat verbs are hidden husks).
    const expectedCommands = [
      // Primary verb (stays flat)
      "search",
      // Resource groups
      "document",
      "project",
      "version",
      "metadata",
      "audit",
      "config",
      "backup",
      "server",
      // Servers
      "mcp",
      "web",
      // Lifecycle / misc (flat)
      "init",
      "doctor",
      "status",
      "configure-agent",
      "self-update",
      "upgrade",
      "sync-self-docs",
      "sync-docs",
      "docs",
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

  test("completion command emits a shell-specific script", () => {
    const { stdout, status } = run(["completion", "bash"]);
    expect(status).toBe(0);
    expect(stdout).toContain("_cerefox_completion()");
    expect(stdout).toContain("complete -F _cerefox_completion cerefox");
  });

  test("completion: unknown shell → exit 1", () => {
    const { status, stderr } = run(["completion", "csh"]);
    expect(status).toBe(1);
    expect(stderr).toContain("Unknown shell");
  });

  test("bare invocation shows state-aware friendly entry (exit 0)", () => {
    const { stdout, status } = run([]);
    expect(status).toBe(0);
    expect(stdout).toContain("Cerefox v");
    // Either "No config detected" or "Config detected" depending on env,
    // but always one of the two.
    expect(stdout).toMatch(/config detected/i);
  });

  test("--help footer lists resource groups + exit codes", () => {
    const { stdout, status } = run(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("Resource groups");
    expect(stdout).toContain("Top-level commands");
    expect(stdout).toContain("Exit codes:");
  });

  test("`cerefox web --help` advertises the in-process server options", () => {
    // v0.6 wires the Hono server in-process — the v0.5 deferred-message
    // stub is gone. Boot-and-bind behaviour lives in web-smoke.test.ts;
    // here we just check the CLI surface advertises the right flags.
    const { stdout, status } = run(["web", "--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("--host");
    expect(stdout).toContain("--port");
    expect(stdout).toContain("--watch");
  });

  test("`cerefox server reindex --help` advertises the v0.7 in-process flags", () => {
    // v0.9 moved reindex under the `server` group; the handler is unchanged.
    const { stdout, status } = run(["server", "reindex", "--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("--all");
    expect(stdout).toContain("--batch");
    expect(stdout).toContain("--dry-run");
    expect(stdout).toContain("--document-id");
  });

  test("`cerefox project delete --help` advertises name-or-id + safety flags", () => {
    const { stdout, status } = run(["project", "delete", "--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("name-or-id");
    expect(stdout).toContain("--yes");
    expect(stdout).toContain("--force");
  });

  test("renamed flat verbs are husks: exit 1 + point to the new form", () => {
    const { stdout, stderr, status } = run(["get-doc", "abc"]);
    expect(status).toBe(1);
    expect(stdout + stderr).toContain("document get");
  });
});
