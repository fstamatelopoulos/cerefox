/**
 * stdio integration smoke test: spawn `cerefox mcp` (the v0.5.1+
 * canonical MCP entry point) and verify it speaks MCP over stdio —
 * initialize, tools/list, then close.
 *
 * v0.5.0 had a dedicated `cerefox-mcp` bin; v0.5.1 dropped it in favour
 * of the `cerefox mcp` subcommand of the main `cerefox` bin. Same
 * `buildServer()` factory under the hood; this test now exercises the
 * full commander → subcommand → server boot path.
 *
 * Runs the actual built bundle (after `bun run build`) so we exercise
 * the exact artifact shipped to npm. Requires `.env` configured (uses
 * the maintainer's live Supabase for boot, but doesn't actually call any
 * tool — just lists them).
 */

import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ALL_TOOLS } from "../../../_shared/mcp-tools/index.ts";
import { RELATION_TOOL_NAMES } from "../../../_shared/mcp-tools/feature-flags.ts";
import { probeSupabase } from "./_live-probe.ts";

// Derived, not hardcoded: a literal list here sat at 10 names while the
// surface grew to 13 — invisible because this test probe-and-skips without
// live credentials. The claim is "the built bundle serves exactly the core
// registry", so assert against the registry.
const CORE_TOOL_NAMES = ALL_TOOLS.map((t) => t.name).filter((n) => !RELATION_TOOL_NAMES.has(n));

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");
const BIN = join(PKG_ROOT, "dist", "bin", "cerefox.js");
const MCP_ARGS = [BIN, "mcp"];

// Probe-and-skip, via the ONE shared implementation (`_live-probe.ts`). It
// resolves `.env` from REPO_ROOT exactly as the MCP server would on a real
// boot, so CI without secrets and a fresh dev box both skip cleanly instead of
// timing out. This file used to carry its own copy calling the verb
// `list-projects`, renamed in v0.9.0 — the copy read the renamed-verb husk's
// exit code as "Supabase unreachable" and skipped every live test here.
const LIVE_OK = probeSupabase();

describe("stdio MCP server smoke", () => {
  test("bin exists after build", () => {
    if (!existsSync(BIN)) {
      throw new Error(
        `Built bin not found at ${BIN}. Run \`bun run build\` first.`,
      );
    }
  });

  test("tools/list returns 10 tools over stdio (relations gated off by default)", async () => {
    if (!existsSync(BIN)) {
      throw new Error(`run \`bun run build\` first`);
    }
    if (!LIVE_OK) {
      console.log(
        "(skipped: Supabase config / connectivity probe failed — same auto-skip the live read/write/lifecycle tests use)",
      );
      return;
    }

    // The server resolves .env from CWD per _shared/config/. Run from the
    // repo root so the maintainer's .env is picked up. REPO_ROOT is the
    // module-level constant set above.
    const child = spawn("node", MCP_ARGS, {
      cwd: REPO_ROOT,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // MCP handshake: initialize, then the `initialized` notification, then
    // tools/list. All three are JSON-RPC over line-delimited stdio per the
    // protocol's stdio transport.
    const initialize = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "smoke-test", version: "0" },
      },
    };
    const initialized = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    };
    const listTools = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    };

    child.stdin.write(JSON.stringify(initialize) + "\n");
    child.stdin.write(JSON.stringify(initialized) + "\n");
    child.stdin.write(JSON.stringify(listTools) + "\n");

    // Wait for two newline-delimited JSON responses.
    const responses: unknown[] = [];
    const deadline = Date.now() + 10_000;
    while (responses.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.id && !responses.find((r) => (r as { id?: unknown }).id === parsed.id)) {
            responses.push(parsed);
          }
        } catch {
          // partial line; keep waiting
        }
      }
    }

    child.stdin.end();
    child.kill();
    await new Promise((r) => setTimeout(r, 50));

    if (responses.length < 2) {
      throw new Error(
        `Did not receive both responses within 10s.\n` +
          `Got ${responses.length}/2.\n` +
          `stdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }

    const init = responses.find((r) => (r as { id?: number }).id === 1) as {
      result?: { serverInfo?: { name?: string; version?: string } };
    };
    expect(init.result?.serverInfo?.name).toBe("cerefox");
    // Assert a semver shape rather than a literal — `meta.ts` is bumped
    // by cut_release.ts on every cut, and we don't want this test to
    // become release-day busywork. The literal-sync itself is verified
    // by the per-bin --version check in `cli-smoke.test.ts`.
    expect(init.result?.serverInfo?.version).toMatch(/^\d+\.\d+\.\d+/);

    const tools = responses.find((r) => (r as { id?: number }).id === 2) as {
      result?: { tools?: Array<{ name: string }> };
    };
    expect(Array.isArray(tools.result?.tools)).toBe(true);
    expect(tools.result?.tools?.length).toBe(CORE_TOOL_NAMES.length);
    const names = tools.result?.tools?.map((t) => t.name).sort();
    expect(names).toEqual([...CORE_TOOL_NAMES].sort());
  });
});
