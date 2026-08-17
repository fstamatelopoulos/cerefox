/** `cerefox config-set <key> <value>` — write a runtime config value. */

import type { Command } from "commander";

import { c, println, resolveAuthor, resolveAuthorType, systemError, warn } from "../../../../../_shared/cli-core/index.ts";
import { storeWriteRemediation } from "../../../../../_shared/mcp-tools/_utils.ts";
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
  // Deliberately the RAW client, not the probing wrapper: the wrapper folds
  // 42883 (function missing) into `null` so callers can probe — but this RPC
  // RETURNS VOID, so success is null too, and the two outcomes would be
  // indistinguishable. Review round 1 caught the CLI printing "✓" while the
  // set had rolled back against a stale PostgREST schema cache.
  const { error } = await client.raw.rpc("cerefox_set_config", {
    p_key: key,
    p_value: value,
    p_author: author,
    p_author_type: authorType,
  });
  if (error) {
    const msg = error.message ?? String(error);
    // One classifier shared with the web route (round 4): deployment-state
    // failures get remediation, everything else gets the key-spelling hint.
    const remediation = storeWriteRemediation(msg, "cerefox_set_config");
    if (remediation) throw systemError(`Could not set ${key}.`, remediation);
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
