/** `cerefox config-set <key> <value>` — write a runtime config value. */

import type { Command } from "commander";

import { c, println, systemError } from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";

async function action(key: string, value: string): Promise<void> {
  const client = getClient();
  try {
    await client.rpc("cerefox_set_config", { p_key: key, p_value: value });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw systemError(
      `Could not set ${key}: ${msg}`,
      "The RPC validates against an allowlist of known keys; check the key spelling.",
    );
  }
  println(c.green("✓ ") + `${key} = ${value}`);
}

export function registerConfigSet(program: Command): void {
  program
    .command("config-set")
    .description("Write a runtime config value into the cerefox_config table.")
    .argument("<key>", "Config key.")
    .argument("<value>", "Value to write.")
    .action(action);
}
