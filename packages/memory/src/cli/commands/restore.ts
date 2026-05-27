/** `cerefox restore <snapshot-dir>` — re-ingest from a backup. */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerRestore(program: Command): void {
  program
    .command("restore")
    .description("Restore a JSON-snapshot backup into the knowledge base.")
    .argument("<snapshot-dir>", "Backup directory produced by `cerefox backup`.")
    .option("--dry-run", "Print what would be restored without writing.")
    .option("-p, --project-name <name>", "Optional project to scope the restore into.")
    .action(stubAction("restore", "23D.4"));
}
