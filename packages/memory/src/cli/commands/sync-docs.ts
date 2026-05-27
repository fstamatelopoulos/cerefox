/**
 * `cerefox sync-docs` — port of `scripts/sync_docs.py` / `sync_docs.ts`.
 *
 * v0.3.0 ported this to TypeScript as `scripts/sync_docs.ts`; v0.5 makes
 * it a first-class CLI subcommand. The subcommand thinly calls into the
 * existing script's exported logic (no duplication).
 */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerSyncDocs(program: Command): void {
  program
    .command("sync-docs")
    .description("Sync Cerefox's own docs into the configured KB.")
    .option("--dry-run", "Print what would be synced without writing.")
    .option("-p, --project <name>", "Target project for the sync.")
    .action(stubAction("sync-docs", "23D.5"));
}
