/**
 * `cerefox self-update` (alias `cerefox upgrade`) — upgrade in place.
 *
 * Detects which installer (bun / npm / yarn / pnpm) actually installed
 * `@cerefox/memory` and wraps the corresponding `<rt> install -g
 * @cerefox/memory@<version>` invocation. Calls `sync-self-docs`
 * automatically afterwards so bundled docs stay in lockstep with code.
 */

import type { Command } from "commander";

import { stubAction } from "./_stub.ts";

export function registerSelfUpdate(program: Command): void {
  const action = stubAction("self-update", "23E.6");
  program
    .command("self-update")
    .description("Upgrade Cerefox in place. Alias: `cerefox upgrade`.")
    .option("--check", "Print current vs latest; do nothing.")
    .option("--yes", "Non-interactive (skip confirmation).")
    .option("--version <version>", "Pin a specific version.")
    .action(action);

  program
    .command("upgrade", { hidden: false })
    .description("Alias for `cerefox self-update`.")
    .option("--check", "Print current vs latest; do nothing.")
    .option("--yes", "Non-interactive (skip confirmation).")
    .option("--version <version>", "Pin a specific version.")
    .action(action);
}
