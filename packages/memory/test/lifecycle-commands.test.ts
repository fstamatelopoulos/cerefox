/**
 * Tests for the v0.5 lifecycle commands.
 *
 * doctor / status are live (probe Supabase + OpenAI) so they need the
 * maintainer's credentials and auto-skip when not reachable.
 *
 * configure-agent + self-update --check don't need a live backend — they
 * exercise local file I/O and registry HTTP only.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");
const BIN = join(PKG_ROOT, "dist", "bin", "cerefox.js");

function run(args: string[]): { stdout: string; stderr: string; status: number } {
  if (!existsSync(BIN)) throw new Error(`Run \`bun run build\` first.`);
  const result = spawnSync("node", [BIN, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? -1,
  };
}

const liveProbe = run(["list-projects", "--json"]);
const LIVE_OK = liveProbe.status === 0;

describe("configure-agent (local-only)", () => {
  const tmpConfig = join(tmpdir(), `cerefox-cfg-test-${Date.now()}.json`);
  const backupPath = `${tmpConfig}.pre-cerefox.bak`;

  afterAll(() => {
    rmSync(tmpConfig, { force: true });
    rmSync(backupPath, { force: true });
  });

  test("unknown --tool exits 1 with hint", () => {
    const { status, stderr } = run(["configure-agent", "--tool", "no-such-client"]);
    expect(status).toBe(1);
    expect(stderr).toContain("Unknown --tool");
  });

  test("--dry-run prints without writing", () => {
    expect(existsSync(tmpConfig)).toBe(false);
    const { stdout, status } = run([
      "configure-agent",
      "--tool",
      "claude-code",
      "--config-path",
      tmpConfig,
      "--dry-run",
      "--json",
    ]);
    expect(status).toBe(0);
    expect(existsSync(tmpConfig)).toBe(false);
    const parsed = JSON.parse(stdout) as {
      configPath: string;
      action: string;
      serverEntry: Record<string, unknown>;
    };
    expect(parsed.action).toBe("created");
    expect(parsed.serverEntry).toEqual({
      command: "npx",
      args: ["-y", "--package=@cerefox/memory", "cerefox-mcp"],
    });
  });

  test("real run creates the file with the cerefox entry", () => {
    const { status } = run([
      "configure-agent",
      "--tool",
      "claude-code",
      "--config-path",
      tmpConfig,
    ]);
    expect(status).toBe(0);
    expect(existsSync(tmpConfig)).toBe(true);
    const parsed = JSON.parse(readFileSync(tmpConfig, "utf8")) as {
      mcpServers: { cerefox: { command: string; args: string[] } };
    };
    expect(parsed.mcpServers.cerefox.command).toBe("npx");
    expect(parsed.mcpServers.cerefox.args).toContain("--package=@cerefox/memory");
  });

  test("second run preserves other servers and backs up the original", () => {
    // Pre-seed with another server entry.
    writeFileSync(
      tmpConfig,
      JSON.stringify({ mcpServers: { other: { command: "fake" } } }, null, 2),
    );
    const { stdout, status } = run([
      "configure-agent",
      "--tool",
      "claude-code",
      "--config-path",
      tmpConfig,
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain("merged");
    const parsed = JSON.parse(readFileSync(tmpConfig, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(parsed.mcpServers.other).toBeDefined();
    expect(parsed.mcpServers.cerefox).toBeDefined();
    expect(existsSync(backupPath)).toBe(true);
  });
});

describe("self-update --check (registry probe only)", () => {
  test("--check exits 0 and prints current/target", () => {
    const { stdout, status } = run(["self-update", "--check"]);
    expect(status).toBe(0);
    expect(stdout).toContain("Installed:");
    expect(stdout).toContain("Target:");
  });

  test("upgrade alias works the same way", () => {
    const { stdout, status } = run(["upgrade", "--check"]);
    expect(status).toBe(0);
    expect(stdout).toContain("Installed:");
  });
});

describe("doctor / status (live)", () => {
  if (!LIVE_OK) {
    test.skip(`Supabase not reachable; skipping`, () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      LIVE_OK;
    });
    return;
  }

  test("doctor --json returns an array of checks", () => {
    const { stdout, status } = run(["doctor", "--json"]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as Array<{ name: string; status: string }>;
    expect(Array.isArray(parsed)).toBe(true);
    // We expect at least binary, runtime, version, config, supabase, openai, schema.
    const names = parsed.map((c) => c.name);
    expect(names).toContain("binary");
    expect(names).toContain("supabase");
    expect(names).toContain("schema");
  });

  test("status --json returns a 3-element array", () => {
    const { stdout, status } = run(["status", "--json"]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as unknown[];
    expect(parsed.length).toBe(3);
  });
});
