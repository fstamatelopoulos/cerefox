/**
 * `cerefox status` — fast subset of `cerefox doctor`. Three checks
 * (version, config, Supabase Data API). Skips the heavier probes
 * (OpenAI, schema RPC, Postgres DDL endpoint, MCP-client scan).
 */

import type { Command } from "commander";
import ora from "ora";

import {
  cErr,
  printJson,
  println,
} from "../../../../../_shared/cli-core/index.ts";
import { runFastChecks, type CheckStatus } from "../util/checks.ts";

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
  const useSpinner = !options.json && process.stderr.isTTY;
  const spinner = useSpinner
    ? ora({ text: "Starting checks…", spinner: "dots", stream: process.stderr }).start()
    : null;

  const results = await runFastChecks({
    onProgress: spinner
      ? (ev) => {
          spinner.text = `${ev.phase} [${ev.index}/${ev.total}]`;
        }
      : undefined,
  });

  spinner?.stop();

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
