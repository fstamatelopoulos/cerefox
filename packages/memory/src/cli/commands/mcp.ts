/**
 * `cerefox mcp` — start the local stdio MCP server.
 *
 * Spawned by MCP clients (Claude Code, Cursor, Claude Desktop, Codex
 * CLI, Gemini CLI) as a long-lived stdio child process. Implements the
 * 10 Cerefox MCP tools via the shared `_shared/mcp-tools/` handlers
 * (same handlers the remote `cerefox-mcp` Edge Function uses).
 *
 * v0.5.1 made this the sole MCP entry point. (v0.5.0 also shipped a
 * separate `cerefox-mcp` bin as a v0.4 backward-compat shim; redundant
 * with this subcommand, and dropped to keep the surface tight.)
 */

import type { Command } from "commander";

export function registerMcp(program: Command): void {
  program
    .command("mcp")
    .description("Start the local stdio MCP server.")
    .action(async () => {
      // Lazy-load so `--help` doesn't pay the import cost. The server
      // factory + MCP SDK pull ~1MB; only worth it when actually running.
      const { buildServer } = await import("../../server.ts");
      const handle = buildServer();
      await handle.run();
    });
}
