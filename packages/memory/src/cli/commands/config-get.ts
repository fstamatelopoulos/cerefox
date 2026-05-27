/** `cerefox config-get <key>` — read a runtime config value. */

import type { Command } from "commander";

import { printJson, println } from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";

async function action(key: string, options: { json?: boolean }): Promise<void> {
  const client = getClient();
  const result = await client.rpc<string | string[]>("cerefox_get_config", { p_key: key });

  // The RPC returns either a scalar string or a single-element array
  // depending on the Supabase client version. Normalize.
  let value: string | null;
  if (result === null || result === undefined) {
    value = null;
  } else if (typeof result === "string") {
    value = result;
  } else if (Array.isArray(result) && result.length > 0 && typeof result[0] === "string") {
    value = result[0];
  } else {
    value = null;
  }

  if (options.json) {
    printJson({ key, value });
    return;
  }
  if (value === null) {
    println(`${key}: (not set)`);
  } else {
    println(`${key}: ${value}`);
  }
}

export function registerConfigGet(program: Command): void {
  program
    .command("config-get")
    .description("Read a runtime config value from the cerefox_config table.")
    .argument("<key>", "Config key (e.g. usage_tracking_enabled).")
    .option("--json", "Emit JSON.")
    .action(action);
}
