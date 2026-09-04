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

import { liveTest } from "./_live-test.ts";
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

const liveProbe = run(["project", "list", "--json"]);
const LIVE_OK = liveProbe.status === 0;

/**
 * The cerefox MCP entry these tests just wrote, whatever it is keyed under.
 *
 * #168 makes the entry NAME follow CEREFOX_ENV_LABEL, and the CLI resolves that
 * from the config directory it is pointed at — which the parent process cannot
 * override, because a named CEREFOX_CONFIG_DIR is deliberately authoritative
 * over ambient values (`_shared/config/env.ts`). Hard-coding `cerefox` here
 * made these assertions pass or fail on which environment the developer had
 * exported, which is nothing to do with what they are testing.
 *
 * These tests are about the entry's SHAPE. The entry's NAME has its own test in
 * `mcp-server-name.test.ts`, which controls the label explicitly.
 */
function cerefoxServerEntry(servers: Record<string, unknown>): { command: string; args: string[] } {
  const names = Object.keys(servers).filter((n) => /^cerefox(-|$)/.test(n));
  if (names.length !== 1) {
    throw new Error(
      `expected exactly one cerefox MCP entry, found: ${names.join(", ") || "(none)"} ` +
        `(all keys: ${Object.keys(servers).join(", ") || "(none)"})`,
    );
  }
  return servers[names[0]] as { command: string; args: string[] };
}

describe("configure-agent (local-only)", () => {
  const tmpConfig = join(tmpdir(), `cerefox-cfg-test-${Date.now()}.json`);
  const backupPath = `${tmpConfig}.pre-cerefox.bak`;

  afterAll(() => {
    rmSync(tmpConfig, { force: true });
    rmSync(backupPath, { force: true });
  });

  liveTest("unknown --tool exits 1 with hint", () => {
    const { status, stderr } = run(["configure-agent", "--tool", "no-such-client"]);
    expect(status).toBe(1);
    expect(stderr).toContain("Unknown --tool");
  });

  liveTest("--dry-run with --config-path prints without writing (direct-write override)", () => {
    // --config-path forces direct-write even for delegated writers (claude-code),
    // which is the test-friendly path. Without --config-path, claude-code would
    // shell out to `claude mcp add` (covered separately below).
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
    // v0.5.1: server entry invokes `cerefox mcp` (the canonical form
    // after the `cerefox-mcp` bin was dropped).
    expect(parsed.serverEntry.command).toBe("npx");
    expect(parsed.serverEntry.args).toEqual(["-y", "--package=@cerefox/memory", "cerefox", "mcp"]);
    // v1.4.0 (#168): a LABELLED environment additionally pins its config
    // directory onto the entry, because MCP clients spawn the server with the
    // client's environment — without it, an entry named `cerefox-staging`
    // would resolve to production. A production entry carries no env at all,
    // so this asserts both shapes rather than pinning the one that happens to
    // match the developer's current environment.
    const cfgEnv = parsed.serverEntry.env as Record<string, string> | undefined;
    if (cfgEnv === undefined) {
      expect(Object.keys(parsed.serverEntry).sort()).toEqual(["args", "command"]);
    } else {
      expect(cfgEnv.CEREFOX_CONFIG_DIR).toBeTruthy();
      expect(cfgEnv.CEREFOX_ENV_LABEL).toBeTruthy();
    }
  });

  liveTest("--config-path direct-write creates the file with the cerefox entry", () => {
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
      mcpServers: Record<string, unknown>;
    };
    expect(cerefoxServerEntry(parsed.mcpServers).command).toBe("npx");
    expect(cerefoxServerEntry(parsed.mcpServers).args).toContain("--package=@cerefox/memory");
  });

  liveTest("second --config-path run preserves other servers and backs up the original", () => {
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
    expect(cerefoxServerEntry(parsed.mcpServers)).toBeDefined();
    expect(existsSync(backupPath)).toBe(true);
  });

  liveTest("v0.5.4: claude-code default (no --config-path) is delegated to `claude mcp add`", () => {
    // Without --config-path, claude-code is now a delegated writer. We use
    // --dry-run to assert the right command WOULD be invoked, without
    // actually requiring the `claude` CLI to be installed in the test env.
    const { stdout, status } = run([
      "configure-agent",
      "--tool",
      "claude-code",
      "--dry-run",
      "--json",
    ]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as {
      configPath: string;
      action: string;
      serverEntry: { command: string; args: string[] };
      delegatedCommand?: string;
    };
    expect(parsed.action).toBe("delegated");
    expect(parsed.delegatedCommand).toBeDefined();
    // Must invoke `claude mcp add cerefox --scope user -- npx ...`.
    expect(parsed.delegatedCommand).toContain("claude mcp add cerefox");
    expect(parsed.delegatedCommand).toContain("--scope user");
    expect(parsed.delegatedCommand).toContain("--package=@cerefox/memory");
    // configPath should be ~/.claude.json (the canonical user-scope path),
    // not the legacy ~/.claude/mcp.json from v0.5.0–v0.5.3.
    expect(parsed.configPath).toMatch(/\.claude\.json$/);
    expect(parsed.configPath).not.toMatch(/\.claude\/mcp\.json$/);
  });

  liveTest("v0.5.4: claude-desktop stays direct-write (no delegation)", () => {
    // Claude Desktop has no CLI helper, so its writer remains direct-write.
    const cdConfig = join(tmpdir(), `cerefox-cd-test-${Date.now()}.json`);
    const { stdout, status } = run([
      "configure-agent",
      "--tool",
      "claude-desktop",
      "--config-path",
      cdConfig,
      "--dry-run",
      "--json",
    ]);
    rmSync(cdConfig, { force: true });
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as { action: string; delegatedCommand?: string };
    // Direct-write paths produce "created" / "merged" / "replaced".
    expect(parsed.action).toBe("created");
    expect(parsed.delegatedCommand).toBeUndefined();
  });

  // Phase 2 (v0.6 / iter-24K): Cursor, Codex, Gemini writers.

  liveTest("Phase 2: cursor writes JSON with mcpServers.cerefox", () => {
    const cfg = join(tmpdir(), `cerefox-cursor-test-${Date.now()}.json`);
    const { status } = run([
      "configure-agent",
      "--tool",
      "cursor",
      "--config-path",
      cfg,
    ]);
    expect(status).toBe(0);
    expect(existsSync(cfg)).toBe(true);
    const parsed = JSON.parse(readFileSync(cfg, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(cerefoxServerEntry(parsed.mcpServers).command).toBe("npx");
    expect(cerefoxServerEntry(parsed.mcpServers).args).toContain("--package=@cerefox/memory");
    rmSync(cfg, { force: true });
    rmSync(`${cfg}.pre-cerefox.bak`, { force: true });
  });

  liveTest("Phase 2: gemini writes JSON with mcpServers.cerefox", () => {
    const cfg = join(tmpdir(), `cerefox-gemini-test-${Date.now()}.json`);
    const { status } = run([
      "configure-agent",
      "--tool",
      "gemini",
      "--config-path",
      cfg,
    ]);
    expect(status).toBe(0);
    expect(existsSync(cfg)).toBe(true);
    const parsed = JSON.parse(readFileSync(cfg, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(cerefoxServerEntry(parsed.mcpServers).command).toBe("npx");
    rmSync(cfg, { force: true });
    rmSync(`${cfg}.pre-cerefox.bak`, { force: true });
  });

  liveTest("Phase 2: codex writes TOML with [mcp_servers.cerefox] table", () => {
    // R1 default plan: TOML format. Round-trip via smol-toml parse to
    // assert the table shape rather than string-matching format quirks.
    const cfg = join(tmpdir(), `cerefox-codex-test-${Date.now()}.toml`);
    const { status } = run([
      "configure-agent",
      "--tool",
      "codex",
      "--config-path",
      cfg,
    ]);
    expect(status).toBe(0);
    expect(existsSync(cfg)).toBe(true);
    const raw = readFileSync(cfg, "utf8");
    expect(raw).toMatch(/\[mcp_servers\.cerefox(-[a-z0-9-]+)?\]/);
    expect(raw).toContain("command =");
    expect(raw).toContain("args =");
    // Re-import the parser dynamically so test isolation isn't broken.
    // Tests share the package's node_modules, so smol-toml is available.
    return import("smol-toml").then(({ parse }) => {
      const parsed = parse(raw) as {
        mcp_servers?: Record<string, unknown>;
      };
      expect(cerefoxServerEntry(parsed.mcp_servers ?? {}).command).toBe("npx");
      expect(cerefoxServerEntry(parsed.mcp_servers ?? {}).args).toContain(
        "--package=@cerefox/memory",
      );
      rmSync(cfg, { force: true });
      rmSync(`${cfg}.pre-cerefox.bak`, { force: true });
    });
  });

  liveTest("Phase 2: codex merge preserves unrelated TOML keys", () => {
    const cfg = join(tmpdir(), `cerefox-codex-merge-${Date.now()}.toml`);
    writeFileSync(
      cfg,
      [
        "model = \"o4-mini\"",
        "",
        "[mcp_servers.other]",
        'command = "fake"',
        "",
      ].join("\n"),
    );
    const { stdout, status } = run([
      "configure-agent",
      "--tool",
      "codex",
      "--config-path",
      cfg,
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain("merged");
    const raw = readFileSync(cfg, "utf8");
    return import("smol-toml").then(({ parse }) => {
      const parsed = parse(raw) as {
        model?: string;
        mcp_servers?: {
          other?: { command?: string };
          cerefox?: { command?: string };
        };
      };
      expect(parsed.model).toBe("o4-mini");
      expect(parsed.mcp_servers?.other?.command).toBe("fake");
      expect(cerefoxServerEntry(parsed.mcp_servers ?? {}).command).toBe("npx");
      rmSync(cfg, { force: true });
      rmSync(`${cfg}.pre-cerefox.bak`, { force: true });
    });
  });

  // R2 resolution: the round-trip smoke test for `claude mcp add` is
  // deferred to the Part 24L manual test plan. Verifying $HOME respect
  // before running the test risks polluting the maintainer's real
  // `~/.claude.json` if claude's home-discovery doesn't honour $HOME
  // (some CLIs use `getpwuid()` instead). The locked R2 default plan
  // explicitly allows the "local-only, manual test plan only" fallback;
  // we take it for safety.
});

describe("self-update --check (registry probe only)", () => {
  /**
   * These hit the LIVE npm registry, so they fail whenever it is slow or
   * unreachable — which is a property of the network, not of this code. That
   * flaked a CI run and a local run on the same day, and a job that fails for
   * reasons unrelated to the change is one people learn to re-run rather than
   * read.
   *
   * Probe once and skip the pair when the registry cannot be reached, matching
   * how every other externally-dependent suite here behaves. A registry that IS
   * reachable still asserts the full contract, so nothing is weakened on a
   * normal run.
   */
  const probe = run(["self-update", "--check"]);
  const registryReachable =
    probe.status === 0 && probe.stdout.includes("Installed:");

  if (!registryReachable) {
    test.skip(
      `npm registry not reachable (exit ${probe.status}); skipping self-update --check`,
      () => {},
    );
    return;
  }

  liveTest("--check exits 0 and prints current/target", () => {
    expect(probe.status).toBe(0);
    expect(probe.stdout).toContain("Installed:");
    expect(probe.stdout).toContain("Target:");
  });

  liveTest("upgrade alias works the same way", () => {
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

  liveTest("doctor --json returns an array of checks", () => {
    const { stdout, status } = run(["doctor", "--json"]);
    // 0 when everything passes, 1 when a check errors — e.g. a store that is
    // legitimately behind on schema. This test is about the JSON SHAPE, so it
    // must not require the environment it happens to run against to be current.
    expect([0, 1]).toContain(status);
    const parsed = JSON.parse(stdout) as Array<{ name: string; status: string }>;
    expect(Array.isArray(parsed)).toBe(true);
    // We expect at least binary, runtime, version, config, supabase, openai, schema + RPCs.
    const names = parsed.map((c) => c.name);
    expect(names).toContain("binary");
    expect(names).toContain("supabase");
    expect(names).toContain("schema + RPCs");
    // `doctor` runs every check: Supabase, OpenAI, schema RPC, embedder, content
    // format, metadata health, and the Edge Function version aggregator. Many
    // real round trips, routinely past bun's 5s default (#235).
  }, 60_000);

  liveTest("status --json returns a 3-element array", () => {
    const { stdout, status } = run(["status", "--json"]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as unknown[];
    expect(parsed.length).toBe(3);
    // Live: shells out to the CLI, which reaches the store (#235).
  }, 60_000);
});
