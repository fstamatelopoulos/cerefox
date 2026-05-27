/**
 * `cerefox status` — fast subset of `cerefox doctor`. Three checks; no
 * external API calls (no OpenAI, no schema-version RPC). Targets
 * < 500ms cold-start.
 */

import type { Command } from "commander";

import {
  cErr,
  printJson,
  println,
} from "../../../../../_shared/cli-core/index.ts";
import { checkConfig, checkSupabase, checkVersion, type CheckResult, type CheckStatus } from "../util/checks.ts";

function symbol(status: CheckStatus): string {
  switch (status) {
    case "ok":
      return cErr.green("✓");
    case "warn":
      return cErr.yellow("⚠");
    case "error":
      return cErr.red("✗");
    case "skipped":
      return cErr.dim("ℹ");
  }
}

async function action(options: { json?: boolean }): Promise<void> {
  const results: CheckResult[] = [
    checkVersion(),
    checkConfig(),
    await checkSupabase(),
  ];
  if (options.json) {
    printJson(results);
    return;
  }
  for (const r of results) {
    println(`${symbol(r.status)} ${r.name.padEnd(8)}  ${r.detail}`);
  }
  if (results.some((r) => r.status === "error")) {
    process.exit(1);
  }
}

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Quick sanity check (fast subset of `cerefox doctor`).")
    .option("--json", "Emit machine-readable JSON.")
    .action(action);
}
