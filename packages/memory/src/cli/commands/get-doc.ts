/** `cerefox get-doc <document-id>` — retrieve full document by ID. */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerGetDoc(program: Command): void {
  program
    .command("get-doc")
    .description("Retrieve the full content of a document by ID.")
    .argument("<document-id>", "UUID of the document.")
    .option("--version-id <uuid>", "Specific archived version (default: current).")
    .option("-r, --requestor <name>", "Agent / user name (usage log).")
    .option("--json", "Emit machine-readable JSON.")
    .action(stubAction("get-doc", "23B.2"));
}
