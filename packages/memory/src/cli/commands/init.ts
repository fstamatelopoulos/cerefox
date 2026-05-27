/** `cerefox init` — interactive bootstrap. */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Interactive first-run setup (config, schema deploy, self-doc ingest).")
    .option("-c, --config <file>", "Non-interactive mode: read answers from a JSON file.")
    .option("--force", "Overwrite existing configuration without prompting.")
    .option("--skip-schema", "Skip the schema deploy step.")
    .option("--skip-self-docs", "Skip the bundled self-doc ingest.")
    .option("--skip-agent-config", "Skip the optional MCP agent wiring.")
    .action(stubAction("init", "23E.1"));
}
