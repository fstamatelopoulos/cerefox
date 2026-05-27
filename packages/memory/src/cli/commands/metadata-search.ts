/** `cerefox metadata-search` — metadata-only search (no text query). */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerMetadataSearch(program: Command): void {
  program
    .command("metadata-search")
    .description("Find documents by metadata criteria (no text query).")
    .requiredOption(
      "-f, --metadata-filter <json>",
      "JSON object; only docs whose metadata contains ALL pairs are returned.",
    )
    .option("-p, --project-name <name>", "Filter to a specific project.")
    .option("--updated-since <iso>", "Only docs updated on/after this ISO timestamp.")
    .option("--created-since <iso>", "Only docs created on/after this ISO timestamp.")
    .option("--include-content", "Include full document text in results.")
    .option("-l, --limit <n>", "Maximum docs to return.", "10")
    .option("-r, --requestor <name>", "Agent / user name (usage log).")
    .option("--json", "Emit machine-readable JSON.")
    .action(stubAction("metadata-search", "23B.7"));
}
