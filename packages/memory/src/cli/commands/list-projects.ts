/** `cerefox list-projects` — list all projects with names + IDs. */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerListProjects(program: Command): void {
  program
    .command("list-projects")
    .description("List all projects in the knowledge base.")
    .option("-r, --requestor <name>", "Agent / user name (usage log).")
    .option("--json", "Emit machine-readable JSON.")
    .action(stubAction("list-projects", "23B.5"));
}
