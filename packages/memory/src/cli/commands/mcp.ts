/**
 * `cerefox mcp` — start the local stdio MCP server.
 *
 * Implemented in-process: calls `buildServer()` directly (same factory the
 * standalone `cerefox-mcp` bin uses). No subprocess hop.
 */

import type { Command } from "commander";

export function registerMcp(program: Command): void {
  program
    .command("mcp")
    .description("Start the local stdio MCP server (same as the cerefox-mcp bin).")
    .action(async () => {
      // Lazy-load so `--help` doesn't pay the import cost. The server
      // factory + MCP SDK pull ~1MB; only worth it when actually running.
      const { buildServer } = await import("../../server.ts");
      const handle = buildServer();
      await handle.run();
    });
}
