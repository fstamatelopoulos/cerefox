/** `cerefox backup` — write JSON snapshot of the knowledge base. */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerBackup(program: Command): void {
  program
    .command("backup")
    .description("Write a JSON snapshot of the knowledge base.")
    .option("-o, --output-dir <dir>", "Snapshot output directory.", "~/.cerefox/backups")
    .option("--include-versions", "Include archived versions in the snapshot.")
    .option("--git", "Commit the snapshot to the output dir as a git checkpoint.")
    .action(stubAction("backup", "23D.3"));
}
