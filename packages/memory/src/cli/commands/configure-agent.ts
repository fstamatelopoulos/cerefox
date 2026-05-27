/** `cerefox configure-agent --tool <client>` — write MCP client config. */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerConfigureAgent(program: Command): void {
  program
    .command("configure-agent")
    .description("Write the MCP server config for a supported client.")
    .requiredOption(
      "-t, --tool <client>",
      "Target client: 'claude-code', 'claude-desktop' (v0.5 Phase 1 surface).",
    )
    .option("--config-path <path>", "Override the default config-file path.")
    .option("--no-backup", "Skip the .pre-cerefox.bak backup of any existing config.")
    .option("--dry-run", "Print the planned write without modifying any file.")
    .action(stubAction("configure-agent", "23E.5"));
}
