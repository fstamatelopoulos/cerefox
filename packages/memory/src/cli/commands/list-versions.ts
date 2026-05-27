/** `cerefox list-versions <document-id>` — version history. */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerListVersions(program: Command): void {
  program
    .command("list-versions")
    .description("List archived versions of a document.")
    .argument("<document-id>", "UUID of the document.")
    .option("-r, --requestor <name>", "Agent / user name (usage log).")
    .option("--json", "Emit machine-readable JSON.")
    .action(stubAction("list-versions", "23B.4"));
}
