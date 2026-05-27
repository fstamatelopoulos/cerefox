/** `cerefox get-audit-log` — query the immutable audit log. */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerGetAuditLog(program: Command): void {
  program
    .command("get-audit-log")
    .description("Query the audit log with optional filters.")
    .option("-d, --document-id <uuid>", "Filter by document.")
    .option("-a, --author <name>", "Filter by author.")
    .option(
      "-o, --operation <type>",
      "Filter by operation: create, update-content, update-metadata, delete, restore.",
    )
    .option("--since <iso>", "Lower-bound ISO timestamp.")
    .option("--until <iso>", "Upper-bound ISO timestamp.")
    .option("-l, --limit <n>", "Maximum entries (max 200).", "50")
    .option("-r, --requestor <name>", "Agent / user name (usage log).")
    .option("--json", "Emit machine-readable JSON.")
    .action(stubAction("get-audit-log", "23B.8"));
}
