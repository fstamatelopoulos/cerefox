/** `cerefox configure-agent --tool <client>` — write MCP client config. */

import type { Command } from "commander";

import {
  c,
  println,
  printJson,
  userError,
} from "../../../../../_shared/cli-core/index.ts";
import { WRITERS, writeMcpConfig } from "../util/mcp-config-writers.ts";

interface ConfigureAgentOptions {
  tool: string;
  configPath?: string;
  backup: boolean;
  dryRun?: boolean;
  json?: boolean;
}

function action(options: ConfigureAgentOptions): void {
  const writer = WRITERS[options.tool];
  if (!writer) {
    throw userError(
      `Unknown --tool "${options.tool}".`,
      `Supported clients: ${Object.keys(WRITERS).join(", ")}.`,
    );
  }

  const result = writeMcpConfig(writer, {
    customPath: options.configPath,
    noBackup: !options.backup,
    dryRun: options.dryRun,
  });

  if (options.json) {
    printJson(result);
    return;
  }

  if (options.dryRun) {
    println(c.yellow("(dry run — no files written)"));
  } else {
    println(c.green(`✓ ${writer.label} configured`));
  }
  println(c.dim(`  config: ${result.configPath}`));
  if (result.backupPath) {
    println(c.dim(`  backup: ${result.backupPath}`));
  }
  println(c.dim(`  action: ${result.action}`));
  if (result.delegatedCommand) {
    println(c.dim(`  invoked: ${result.delegatedCommand}`));
  }
  println("");
  println(c.bold("Server entry written:"));
  println(JSON.stringify(result.serverEntry, null, 2));
  if (!options.dryRun) {
    println("");
    println(c.dim(restartHint(writer.id)));
  }
}

function restartHint(id: string): string {
  switch (id) {
    case "claude-desktop":
      return "Restart Claude Desktop fully (Cmd+Q on macOS) to pick up the new server.";
    case "claude-code":
      return (
        "Start a new Claude Code session to pick up the new server " +
        "(running sessions cache MCP server lists at startup)."
      );
    case "cursor":
      return "Reload Cursor (or restart) to pick up the new MCP server.";
    case "codex":
      return "Restart the Codex CLI session to pick up the new server.";
    case "gemini":
      return "Restart the Gemini CLI session to pick up the new server.";
    default:
      return "Restart your MCP client to pick up the new server.";
  }
}

export function registerConfigureAgent(program: Command): void {
  program
    .command("configure-agent")
    .description("Write the MCP server config for a supported client.")
    .requiredOption(
      "-t, --tool <client>",
      "Target client: claude-code, claude-desktop, cursor, codex, gemini.",
    )
    .option("--config-path <path>", "Override the default config-file path.")
    .option("--no-backup", "Skip the .pre-cerefox.bak backup of any existing config.")
    .option("--dry-run", "Print the planned write without modifying any file.")
    .option("--json", "Emit JSON describing the result.")
    .action(action);
}
