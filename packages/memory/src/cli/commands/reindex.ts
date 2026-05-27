/**
 * `cerefox reindex` — re-embed existing chunks.
 *
 * v0.5: deferred to v0.7 (depends on the TS ingestion pipeline +
 * a `cerefox-reindex` Edge Function that doesn't yet exist). For now
 * prints an informational message and exits 0.
 */

import type { Command } from "commander";

import { info, println } from "../../../../../_shared/cli-core/index.ts";

export function registerReindex(program: Command): void {
  program
    .command("reindex")
    .description("Re-embed existing document chunks (Python-only until v0.7).")
    .option("--all", "Reindex every chunk, not just stale ones.")
    .option("--batch <n>", "Chunks per batch.", "32")
    .option("--dry-run", "Show what would be reindexed.")
    .action(() => {
      info("`cerefox reindex` is part of the v0.7 ingestion pipeline migration.");
      println("");
      println("For now, run from a Cerefox checkout:");
      println("  uv run cerefox reindex");
      println("");
      println("Or wait for v0.7 — see docs/guides/migration-v0.5.md.");
    });
}
