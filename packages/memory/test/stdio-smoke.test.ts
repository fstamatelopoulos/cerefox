/**
 * stdio integration smoke test: spawn the built `cerefox-mcp` bin and
 * verify it speaks MCP over stdio — initialize, tools/list, then close.
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

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG_ROOT, "dist", "bin", "cerefox-mcp.js");

describe("stdio MCP server smoke", () => {
  test("bin exists after build", () => {
    if (!existsSync(BIN)) {
      throw new Error(
        `Built bin not found at ${BIN}. Run \`bun run build\` first.`,
      );
    }
  });

  test("tools/list returns 10 tools over stdio", async () => {
    if (!existsSync(BIN)) {
      throw new Error(`run \`bun run build\` first`);
    }

    // The server resolves .env from CWD per _shared/config/. Run from the
    // repo root so the maintainer's .env is picked up.
    const REPO_ROOT = join(PKG_ROOT, "..", "..");
    const child = spawn("node", [BIN], {
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
    expect(tools.result?.tools?.length).toBe(10);
    const names = tools.result?.tools?.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "cerefox_search",
        "cerefox_ingest",
        "cerefox_get_document",
        "cerefox_list_versions",
        "cerefox_metadata_search",
        "cerefox_list_metadata_keys",
        "cerefox_list_projects",
        "cerefox_set_document_projects",
        "cerefox_get_audit_log",
        "cerefox_get_help",
      ].sort(),
    );
  });
});
