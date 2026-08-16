/** `cerefox config-set <key> <value>` — write a runtime config value. */

import type { Command } from "commander";

import { c, println, resolveAuthor, resolveAuthorType, systemError, warn } from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";

interface ConfigSetOptions {
  author?: string;
  authorType?: string;
}

async function action(key: string, value: string, options: ConfigSetOptions): Promise<void> {
  const client = getClient();
  const author = resolveAuthor(options.author);
  const authorType = resolveAuthorType(options.authorType);
  if (author === "unknown") {
    warn(
      "No --author / CEREFOX_AUTHOR_NAME set — audit log will record this change as 'unknown'.",
    );
  }
  try {
    await client.rpc("cerefox_set_config", {
      p_key: key,
      p_value: value,
      p_author: author,
      p_author_type: authorType,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 0.14.0 grew the signature; against an older server the 4-arg call has
    // no matching function. Say "redeploy", not "bad key".
    if (/could not find the function|PGRST202/i.test(msg)) {
      throw systemError(
        `Could not set ${key}: the deployed server predates schema 0.14.0.`,
        "Run `cerefox server deploy` to update the schema and RPCs, then retry.",
      );
    }
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
    .option("-a, --author <name>", "Caller identity (audit log).")
    .option("--author-type <type>", "user | agent (default: user).")
    .action(action);
}
