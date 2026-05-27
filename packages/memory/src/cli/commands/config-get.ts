/** `cerefox config-get <key>` — read a runtime config value. */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerConfigGet(program: Command): void {
  program
    .command("config-get")
    .description("Read a runtime config value from the cerefox_config table.")
    .argument("<key>", "Config key (e.g. usage_tracking_enabled).")
    .option("--json", "Emit JSON.")
    .action(stubAction("config-get", "23D.8"));
}
