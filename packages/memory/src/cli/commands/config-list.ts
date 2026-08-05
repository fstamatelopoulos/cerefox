/**
 * `cerefox config list` — list the runtime config KEYS (not values).
 *
 * These are stored in the `cerefox_config` table in your Supabase DB (shared
 * across all access paths), NOT in `~/.cerefox/.env`. The allowed key set is
 * fixed server-side by `cerefox_set_config` (it rejects unknown keys); this
 * command surfaces that set so you know what `config get`/`config set` accept.
 * Use `cerefox config get <key>` to read a value. Added in v0.9.1.
 */

import type { Command } from "commander";

import { c, printJson, println } from "../../../../../_shared/cli-core/index.ts";

// Mirror of the `v_allowed` allow-list in `cerefox_set_config` (rpcs.sql).
const CONFIG_KEYS: ReadonlyArray<{ key: string; description: string }> = [
  {
    key: "usage_tracking_enabled",
    description: "'true'/'false' — log reads + writes to cerefox_usage_log. Default off.",
  },
  {
    key: "require_requestor_identity",
    description: "'true'/'false' — require requestor/author on MCP tool calls. Default off.",
  },
  {
    key: "requestor_identity_format",
    description: "Regex the requestor/author must match (only enforced when the above is on).",
  },
  // Retrieval tunables (#133). Set here and every access path obeys — CLI,
  // local + remote MCP, Edge Functions, web — because all of them resolve
  // through the search RPCs. A per-call argument or a client-side
  // CEREFOX_* env var still overrides.
  {
    key: "min_search_score",
    description:
      "0–1 — minimum cosine similarity for vector-side results. Default 0.5 (use 0.6 with the local embedder).",
  },
  {
    key: "min_term_coverage",
    description:
      "0–1 — fraction of a query's meaningful terms a keyword OR-fallback match must cover to count as confident. Default 0.5.",
  },
  {
    key: "search_alpha",
    description:
      "0–1 — hybrid fusion weight: 1 = pure semantic, 0 = pure keyword. Default 0.7.",
  },
];

function action(options: { json?: boolean }): void {
  if (options.json) {
    printJson({ keys: CONFIG_KEYS.map((k) => k.key) });
    return;
  }
  println(c.bold("Runtime config keys (stored in cerefox_config; read with `cerefox config get <key>`):"));
  for (const { key, description } of CONFIG_KEYS) {
    println(`  ${c.bold(key)}`);
    println(c.dim(`    ${description}`));
  }
}

export function registerConfigList(parent: Command): void {
  parent
    .command("list")
    .description("List the runtime config keys (the cerefox_config allow-list; not values).")
    .option("--json", "Emit the key list as JSON.")
    .action(action);
}
