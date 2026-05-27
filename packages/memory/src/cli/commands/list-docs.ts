/** `cerefox list-docs` — list documents (optionally project-scoped). */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerListDocs(program: Command): void {
  program
    .command("list-docs")
    .description("List documents in the knowledge base.")
    .option("-p, --project <name>", "Filter to a specific project.")
    .option("-l, --limit <n>", "Maximum docs to return.", "100")
    .option("--json", "Emit machine-readable JSON.")
    .action(stubAction("list-docs", "23B.3"));
}
