/**
 * `cerefox search <query>` — hybrid search via cerefox-search Edge Function.
 *
 * v0.5 design: read commands go through Edge Functions, not direct RPCs.
 * Same path GPT Actions use. Identical wire shape between
 * MCP `cerefox_search` and HTTP `/cerefox-search`.
 */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerSearch(program: Command): void {
  program
    .command("search")
    .description("Search the knowledge base (hybrid FTS + semantic).")
    .argument("<query>", "Natural-language search query.")
    .option("-c, --match-count <n>", "Maximum number of documents to return.", "5")
    .option("-p, --project-name <name>", "Filter results to a specific project.")
    .option(
      "-f, --metadata-filter <json>",
      "JSON containment filter; only docs whose metadata contains ALL pairs are returned.",
    )
    .option("--mode <mode>", "Search mode (default: docs).", "docs")
    .option("--alpha <float>", "Semantic weight 0..1 (default: 0.7).", "0.7")
    .option("--min-score <float>", "Minimum cosine similarity threshold.", "0.5")
    .option("--max-bytes <n>", "Response size budget in bytes.")
    .option("-r, --requestor <name>", "Agent / user name (recorded in usage log).")
    .option("--json", "Emit machine-readable JSON instead of the default text.")
    .action(stubAction("search", "23B.1"));
}
