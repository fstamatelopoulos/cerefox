#!/usr/bin/env node
/**
 * `cerefox-mcp` — entry-point for the `@cerefox/memory` local stdio
 * MCP server. Spawned by MCP clients (Claude Code, Cursor, Claude
 * Desktop, etc.) as a long-lived stdio child process.
 *
 * Supports `--version` / `--help` short-circuits so smoke tests and
 * shell-completion tooling can probe without DB credentials.
 */

import { buildServer } from "../server.ts";

const VERSION = "0.4.3";

const HELP = `Cerefox MCP server (@cerefox/memory v${VERSION})

USAGE
  cerefox-mcp                Start the stdio MCP server.
  cerefox-mcp --version      Print version and exit.
  cerefox-mcp --help         Print this help.

ENVIRONMENT
  CEREFOX_SUPABASE_URL       Supabase project URL (required).
  CEREFOX_SUPABASE_KEY       Service-role key for the Data API (required).
  CEREFOX_OPENAI_API_KEY     Embedding API key (or OPENAI_API_KEY).
  CEREFOX_CONFIG_DIR         Override the .env resolution directory.

CONFIGURATION
  .env is resolved in order:
    1. $CEREFOX_CONFIG_DIR (if set)
    2. ./.env in the current working directory
    3. ~/.cerefox/.env

  See https://github.com/fstamatelopoulos/cerefox for full docs.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
  }
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  const handle = buildServer();
  await handle.run();
}

main().catch((err) => {
  process.stderr.write(`[cerefox-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
