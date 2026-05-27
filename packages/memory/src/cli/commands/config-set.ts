/** `cerefox config-set <key> <value>` — write a runtime config value. */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerConfigSet(program: Command): void {
  program
    .command("config-set")
    .description("Write a runtime config value into the cerefox_config table.")
    .argument("<key>", "Config key.")
    .argument("<value>", "Value to write.")
    .action(stubAction("config-set", "23D.8"));
}
