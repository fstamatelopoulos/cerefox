/**
 * `cerefox doctor` — full diagnostic. Runs every check and renders a
 * status table. Exit 0 if all green/warn/skipped; exit 1 if any error.
 *
 * For machine consumers, `--json` emits the full results array.
 */

import type { Command } from "commander";
import ora from "ora";

import {
  c,
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

async function action(options: { json?: boolean; strict?: boolean }): Promise<void> {
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
    // The environment belongs on the title line, not buried in the config
    // row: `doctor` is what you run to answer "what am I pointed at?", and the
    // answer should be the first thing read, not the fifth.
    const envLabel = (process.env.CEREFOX_ENV_LABEL ?? "").trim();
    println(
      envLabel
        ? `Cerefox doctor ${c.yellow(`[${envLabel.toUpperCase()}]`)}`
        : "Cerefox doctor",
    );
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
    // #137: a client release that ships schema/RPC or Edge Function changes
    // leaves those fixes INERT until the server is redeployed — so state the
    // next step plainly rather than leaving the user to synthesize it from
    // two independently-worded rows.
    if (needsSchema && needsEf) {
      remediation =
        "This release needs a server update (schema + RPCs + Edge Functions): cerefox server deploy";
    } else if (needsSchema) {
      remediation =
        "This release needs a schema + RPC update: cerefox server deploy --schema-only";
    } else if (needsEf) {
      remediation =
        "This release needs an Edge Function update: cerefox server deploy --functions-only";
    }
    if (remediation) {
      println(cErr.yellow("→ " + remediation));
      // Parallel environments (staging-env.md): remediation is copy-pasteable,
      // and a bare `cerefox` resolves to the DEFAULT config — running this
      // doctor's suggestion verbatim would act on a DIFFERENT environment
      // than the one just diagnosed. Say so where the command is printed.
      const configDir = (process.env.CEREFOX_CONFIG_DIR ?? "").trim();
      if (configDir) {
        println(
          cErr.dim(
            `  (this doctor ran against CEREFOX_CONFIG_DIR=${configDir} — ` +
              `prefix the command above the same way, or use your environment alias, ` +
              `or a bare \`cerefox\` will act on your DEFAULT environment instead)`,
          ),
        );
      }
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
  // #152: don't claim "all checks passed" when checks warned — the old line
  // contradicted the remediation printed directly above it.
  if (!options.json) {
    if (warnCount > 0) {
      println(
        cErr.yellow("⚠ ") +
          `${warnCount} warning${warnCount === 1 ? "" : "s"} — see above.`,
      );
    } else {
      println(cErr.green("✓") + " All checks passed.");
    }
  }
  // Warnings exit 0 by default: the client is always updated before the
  // server, so a normal upgrade window would otherwise fail scripts and CI.
  // `--strict` opts into treating them as failures.
  if (options.strict && warnCount > 0) process.exit(1);
}

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Run diagnostic checks against the installed Cerefox.")
    .option("--json", "Emit machine-readable JSON (no colours, structured output).")
    .option("--strict", "Exit non-zero when any check warns (default: only errors fail).")
    .action(action);
}
