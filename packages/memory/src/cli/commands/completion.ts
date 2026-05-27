/** `cerefox completion <shell>` — emit a tab-completion script. */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerCompletion(program: Command): void {
  program
    .command("completion")
    .description("Emit a tab-completion script for your shell.")
    .argument("<shell>", "Target shell: bash, zsh, or fish.")
    .action(stubAction("completion", "23G.1"));
}
