/** `cerefox status` — fast subset of doctor (< 500ms). */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Quick sanity check (fast subset of `cerefox doctor`).")
    .option("--json", "Emit machine-readable JSON.")
    .action(stubAction("status", "23E.4"));
}
