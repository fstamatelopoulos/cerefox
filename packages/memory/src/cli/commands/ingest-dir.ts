/** `cerefox ingest-dir <dir>` — batch ingest. */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerIngestDir(program: Command): void {
  program
    .command("ingest-dir")
    .description("Recursively ingest a directory of markdown / text files.")
    .argument("<dir>", "Root directory to walk.")
    .option("-p, --project-name <name>", "Project membership for all ingested docs.")
    .option("-m, --metadata <json>", "JSON metadata applied to every doc.")
    .option("--source <label>", "Origin label (default: cli).", "cli")
    .option("-u, --update-if-exists", "Update an existing doc with the same title.")
    .option("-a, --author <name>", "Caller identity (audit log).")
    .option("--author-type <type>", "'user' or 'agent' (default: user).", "user")
    .option(
      "-e, --extensions <list>",
      "Comma-separated file extensions to ingest.",
      ".md,.txt",
    )
    .action(stubAction("ingest-dir", "23C.3"));
}
