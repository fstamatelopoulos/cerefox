/**
 * `cerefox doctor` — full diagnostic. Runs every check and renders a
 * status table. Exit 0 if all green/warn/skipped; exit 1 if any error.
 *
 * For machine consumers, `--json` emits the full results array.
 */

import type { Command } from "commander";

import {
  cErr,
  errorln,
  printJson,
  println,
} from "../../../../../_shared/cli-core/index.ts";
import { runAllChecks, type CheckResult, type CheckStatus } from "../util/checks.ts";

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
  const results = await runAllChecks();

  if (options.json) {
    printJson(results);
  } else {
    println("Cerefox doctor");
    println("");
    // Pad name column for readability.
    const nameWidth = Math.max(...results.map((r) => r.name.length));
    for (const r of results) {
      const name = r.name.padEnd(nameWidth);
      println(`  ${symbol(r.status)} ${name}  ${r.detail}`);
      if (r.hint) {
        println(`    ${cErr.dim("→ " + r.hint)}`);
      }
    }
    println("");
  }

  const errCount = results.filter((r) => r.status === "error").length;
  const warnCount = results.filter((r) => r.status === "warn").length;
  if (errCount > 0) {
    if (!options.json) {
      errorln(`${errCount} error${errCount === 1 ? "" : "s"} (${warnCount} warning${warnCount === 1 ? "" : "s"}).`);
    }
    process.exit(1);
  }
  if (!options.json) {
    println(
      cErr.green("✓") +
        ` All checks passed${warnCount > 0 ? ` (${warnCount} warning${warnCount === 1 ? "" : "s"})` : ""}.`,
    );
  }
}

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Run diagnostic checks against the installed Cerefox.")
    .option("--json", "Emit machine-readable JSON (no colours, structured output).")
    .action(action);
}
