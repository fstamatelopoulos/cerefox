/**
 * `cerefox ingest [path]` — ingest a file or stdin-paste into the KB.
 *
 * v0.5: routes through the `cerefox-ingest` Edge Function (same path
 * GPT Actions use). No client-side chunking; the EF handles the full
 * chunk → embed → version-snapshot → audit flow.
 */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerIngest(program: Command): void {
  program
    .command("ingest")
    .description("Ingest a file (or stdin paste) into the knowledge base.")
    .argument("[path]", "Path to the file to ingest. Omit when using --paste.")
    .option("--paste", "Read content from stdin instead of a file.")
    .option("-t, --title <title>", "Document title (required with --paste).")
    .option("-p, --project-name <name>", "Single project membership (non-destructive on update).")
    .option(
      "-P, --project-names <names>",
      "Comma-separated full project membership set (destructive replace on update).",
    )
    .option("-m, --metadata <json>", "JSON metadata object.")
    .option("--source <label>", "Origin label (default: cli).", "cli")
    .option("-u, --update-if-exists", "Update an existing doc with the same title.")
    .option("-i, --document-id <uuid>", "Update a specific document by UUID (overrides --update-if-exists).")
    .option("-a, --author <name>", "Caller identity (audit log).")
    .option(
      "--author-type <type>",
      "'user' or 'agent' (default: user).",
      "user",
    )
    .action(stubAction("ingest", "23C.1"));
}
