/** `cerefox list-metadata-keys` — discover metadata keys + counts. */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerListMetadataKeys(program: Command): void {
  program
    .command("list-metadata-keys")
    .description("List all metadata keys with document counts and example values.")
    .option("-r, --requestor <name>", "Agent / user name (usage log).")
    .option("--json", "Emit machine-readable JSON.")
    .action(stubAction("list-metadata-keys", "23B.6"));
}
