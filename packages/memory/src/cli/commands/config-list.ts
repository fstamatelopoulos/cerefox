/**
 * `cerefox config list` — list the runtime config KEYS (not values).
 *
 * These are stored in the `cerefox_config` table in your Supabase DB (shared
 * across all access paths), NOT in `~/.cerefox/.env`. The allowed key set is
 * fixed server-side by `cerefox_set_config` (it rejects unknown keys); this
 * command surfaces that set so you know what `config get`/`config set` accept.
 * Use `cerefox config get <key>` to read a value. Added in v0.9.1.
 *
 * The list is derived from `CONFIG_CATALOG` (v1.13.0, #239) — the same
 * description the web settings page renders — so the CLI cannot fall behind
 * the catalog again. A unit test pins the catalog to `v_allowed` in rpcs.sql.
 */

import type { Command } from "commander";

import { c, printJson, println } from "../../../../../_shared/cli-core/index.ts";
import { CONFIG_CATALOG } from "../../../../../_shared/config-catalog/index.ts";

function action(options: { json?: boolean }): void {
  if (options.json) {
    // `keys` keeps its pre-1.13 shape (a plain string array) so scripts that
    // consumed it keep working; the richer per-key detail is additive.
    printJson({
      keys: CONFIG_CATALOG.map((k) => k.key),
      catalog: CONFIG_CATALOG.map((k) => ({
        key: k.key,
        kind: k.kind,
        default: k.defaultValue,
        group: k.group,
        description: k.description,
      })),
    });
    return;
  }
  println(c.bold("Runtime config keys (stored in cerefox_config; read with `cerefox config get <key>`):"));
  let group: string | null = null;
  for (const spec of CONFIG_CATALOG) {
    if (spec.group !== group) {
      group = spec.group;
      println(c.dim(`\n  ${group}`));
    }
    const kind = spec.kind === "boolean" ? "'true'/'false'" : spec.kind;
    println(`  ${c.bold(spec.key)}  ${c.dim(`(${kind}; default ${spec.defaultValue === "" ? "unset" : spec.defaultValue})`)}`);
    println(c.dim(`    ${spec.description}`));
    if (spec.impactNote) println(c.dim(`    Note: ${spec.impactNote}`));
  }
}

export function registerConfigList(parent: Command): void {
  parent
    .command("list")
    .description("List the runtime config keys (the cerefox_config allow-list; not values).")
    .option("--json", "Emit the key list as JSON.")
    .action(action);
}
