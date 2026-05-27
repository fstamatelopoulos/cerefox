/** `cerefox delete-doc <document-id>` — soft-delete a document. */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerDeleteDoc(program: Command): void {
  program
    .command("delete-doc")
    .description("Soft-delete a document (recoverable via the web UI trash).")
    .argument("<document-id>", "UUID of the document to delete.")
    .option("--reason <text>", "Optional reason recorded in the audit log.")
    .option("-a, --author <name>", "Caller identity (audit log).")
    .option("--author-type <type>", "'user' or 'agent' (default: user).", "user")
    .option("--yes", "Skip the confirmation prompt.")
    .action(stubAction("delete-doc", "23C.4"));
}
