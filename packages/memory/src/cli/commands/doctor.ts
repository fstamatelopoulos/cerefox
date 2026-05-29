/**
 * `cerefox doctor` — full diagnostic. Runs every check and renders a
 * status table. Exit 0 if all green/warn/skipped; exit 1 if any error.
 *
 * For machine consumers, `--json` emits the full results array.
 */

import type { Command } from "commander";
import ora from "ora";

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
  // Spinner only when writing to a TTY and not in --json mode. Matches the
  // pattern from `scripts/db_status.ts`: spinner writes to stderr (ora
  // default), JSON output goes to stdout — so the two never collide, and
  // CI / non-interactive runs ( `| cat`, GH Actions) skip the spinner via
  // the TTY check.
  const useSpinner = !options.json && process.stderr.isTTY;
  const spinner = useSpinner
    ? ora({ text: "Starting checks…", spinner: "dots", stream: process.stderr }).start()
    : null;

  const results = await runAllChecks({
    onProgress: spinner
      ? (ev) => {
          spinner.text = `${ev.phase} [${ev.index}/${ev.total}]`;
        }
      : undefined,
  });

  spinner?.stop();

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

  // Consolidated server-update remediation. The schema+RPC and Edge Function
  // checks classify drift but deliberately leave the command to here so we
  // emit a single suggestion: both stale → run the whole `deploy-server`;
  // only one stale → the matching --schema-only / --functions-only flag.
  if (!options.json) {
    const stale = (name: string) => {
      const r = results.find((x) => x.name === name);
      return r != null && (r.status === "error" || r.status === "warn");
    };
    const needsSchema = stale("schema + RPCs");
    const needsEf = stale("edge functions");
    let remediation: string | null = null;
    if (needsSchema && needsEf) {
      remediation = "Update the server (schema + RPCs + Edge Functions): cerefox deploy-server";
    } else if (needsSchema) {
      remediation = "Update the schema + RPCs: cerefox deploy-server --schema-only";
    } else if (needsEf) {
      remediation = "Update the Edge Functions: cerefox deploy-server --functions-only";
    }
    if (remediation) {
      println(cErr.yellow("→ " + remediation));
      println("");
    }
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
