/** `cerefox docs [topic]` — open bundled markdown locally. */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerDocs(program: Command): void {
  program
    .command("docs")
    .description("Open bundled Cerefox docs in your browser (or print to stdout).")
    .argument("[topic]", "Doc topic (e.g. quickstart, connect-agents). Omit for the index.")
    .option("--print", "Print to stdout instead of opening a browser.")
    .option("--list", "List available topics.")
    .action(stubAction("docs", "23D.6"));
}
