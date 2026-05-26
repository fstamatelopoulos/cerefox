#!/usr/bin/env bun
/**
 * db_status.ts — TypeScript port of scripts/db_status.py (v0.3.0).
 *
 * Verifies the deployed Cerefox schema (tables, functions, row counts,
 * schema-version marker) against what this install expects.
 *
 * Usage:
 *   bun scripts/db_status.ts
 *   bun scripts/db_status.ts --json     # structured output
 *
 * Requires CEREFOX_SUPABASE_URL and CEREFOX_SUPABASE_KEY in your `.env`.
 * Resolved via the standard precedence (see `_shared/config/paths.ts`).
 *
 * Exit codes:
 *   0  all checks passed
 *   1  some checks failed (missing objects, schema mismatch)
 *   2  could not connect / configuration error
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exit, stdout } from "node:process";

import ora from "ora";

import { loadSettings } from "../_shared/config/index.ts";
import { createClient } from "../_shared/db-client/index.ts";
import {
  formatReport,
  runDbStatusChecks,
  type ProgressEvent,
} from "../_shared/db-status/index.ts";

const PHASE_LABEL: Record<ProgressEvent["phase"], string> = {
  tables: "Checking tables",
  functions: "Checking RPCs",
  rowCounts: "Counting rows",
  schemaVersion: "Reading schema version",
};

const SCHEMA_VERSION_RE = /^--\s*@version:\s*(\S+)/m;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readBundledSchemaVersion(): string | null {
  // schema.sql lives inside the Python package layout. From a repo checkout
  // it's at src/cerefox/db/schema.sql. (Once schema.sql moves to TS — out of
  // scope for v0.3.0 — this stays the source of truth.)
  const schemaPath = join(REPO_ROOT, "src", "cerefox", "db", "schema.sql");
  try {
    const content = readFileSync(schemaPath, "utf8");
    const match = content.match(SCHEMA_VERSION_RE);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

interface Args {
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { json: false };
  for (const a of argv) {
    if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage:",
          "  bun scripts/db_status.ts          report schema health",
          "  bun scripts/db_status.ts --json   structured JSON output",
        ].join("\n"),
      );
      exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      exit(2);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const settings = loadSettings();
  if (!settings.supabaseUrl || !settings.supabaseKey) {
    console.error("❌  CEREFOX_SUPABASE_URL and CEREFOX_SUPABASE_KEY must be set.");
    console.error("    See docs/guides/setup-supabase.md.");
    exit(2);
  }

  const client = createClient(settings);
  const bundled = readBundledSchemaVersion();

  // Spinner only when writing to a TTY and not in --json mode. The JSON
  // output goes to stdout; spinner writes to stderr (ora default), so the
  // two never collide, but the JSON consumer probably also wants stderr
  // clean. The TTY check skips the spinner under `| cat` / CI redirects.
  const useSpinner = !args.json && stdout.isTTY;
  const spinner = useSpinner
    ? ora({ text: "Starting checks…", spinner: "dots" }).start()
    : null;

  let report;
  try {
    report = await runDbStatusChecks(client, {
      bundledSchemaVersion: bundled,
      onProgress: spinner
        ? (ev) => {
            const label = PHASE_LABEL[ev.phase];
            spinner.text = `${label} [${ev.index}/${ev.total}]  ${ev.current}`;
          }
        : undefined,
    });
  } catch (err) {
    spinner?.fail(`Could not run checks: ${(err as Error).message}`);
    exit(2);
  }

  spinner?.stop();

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }

  exit(report.allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  exit(2);
});
