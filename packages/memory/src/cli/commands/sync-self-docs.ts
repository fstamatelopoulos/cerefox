/** `cerefox sync-self-docs` — ingest bundled agent guides into the KB. */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerSyncSelfDocs(program: Command): void {
  program
    .command("sync-self-docs")
    .description("Ingest bundled Cerefox docs under the _cerefox-self-docs project.")
    .option("--dry-run", "List what would be ingested without writing.")
    .option("--project <name>", "Override the target project name.", "_cerefox-self-docs")
    .action(stubAction("sync-self-docs", "23F.2"));
}
