/** `cerefox doctor` — diagnostic, 8 checks. */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Run 8 diagnostic checks against the installed Cerefox.")
    .option("--json", "Emit machine-readable JSON (no colors, structured output).")
    .action(stubAction("doctor", "23E.3"));
}
