#!/usr/bin/env bun
/**
 * Deploy Cerefox schema to a fresh Supabase / Postgres instance.
 *
 * Usage:
 *   bun scripts/db_deploy.ts
 *   bun scripts/db_deploy.ts --dry-run
 *   bun scripts/db_deploy.ts --reset      # ⚠️  drops all cerefox tables first
 *
 * Requires CEREFOX_DATABASE_URL in your .env file. See
 * docs/guides/setup-supabase.md for where to find this value.
 *
 * TS port of `scripts/db_deploy.py` (iter-25 Part 25H). The Python
 * original is now a husk pointing at this script.
 *
 * Postgres client: `postgres` (Porsager) — small, well-typed, no
 * native deps, works on Node + Bun. Picked over `pg` (heavier, native
 * deps) and `bun:sql` (Bun-only, locks the script runtime).
 */

import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";

import { loadEnv } from "../_shared/config/index.js";
import { resolveServerAssets } from "../_shared/server-assets/index.js";
import { runDbDeploy } from "../_shared/db-deploy/index.js";
import {
  EXIT_OK,
  EXIT_USER_ERROR,
  EXIT_SYSTEM_ERROR,
  c,
  println,
  errorln,
} from "../_shared/cli-core/index.js";

loadEnv();

interface Args {
  dryRun: boolean;
  reset: boolean;
  assetsDir?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false, reset: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--reset") out.reset = true;
    else if (a === "--assets-dir") {
      const v = argv[++i];
      if (!v) {
        errorln("--assets-dir requires a path argument");
        process.exit(EXIT_USER_ERROR);
      }
      out.assetsDir = v;
    } else if (a === "--help" || a === "-h") {
      println("Usage: bun scripts/db_deploy.ts [--dry-run] [--reset] [--assets-dir <path>]");
      println("");
      println("  --dry-run        Print the planned steps without executing.");
      println("  --reset          DROP all Cerefox tables first (DESTRUCTIVE).");
      println("  --assets-dir     Override the server-assets root (bundled layout:");
      println("                   <dir>/db/schema.sql etc). Defaults to auto-resolution");
      println("                   (repo src/cerefox/db/ or the bundled dist/server-assets/).");
      process.exit(EXIT_OK);
    } else {
      errorln(`Unknown arg: ${a}`);
      process.exit(EXIT_USER_ERROR);
    }
  }
  return out;
}

async function confirmReset(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    "\n⚠️  --reset will DROP all Cerefox tables. All data will be lost. " +
      "Type 'yes' to continue: ",
  );
  rl.close();
  return answer.trim().toLowerCase() === "yes";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dbUrl = process.env.CEREFOX_DATABASE_URL ?? "";
  if (!dbUrl) {
    errorln("❌  CEREFOX_DATABASE_URL is not set.");
    errorln("");
    errorln("Set it in your .env file. See docs/guides/setup-supabase.md.");
    process.exit(EXIT_USER_ERROR);
  }

  const assets = resolveServerAssets({ assetsDir: args.assetsDir });
  if (!existsSync(assets.schemaFile) || !existsSync(assets.rpcsFile)) {
    errorln(`❌  Schema files missing (looked for ${assets.schemaFile}).`);
    errorln("   Run from a repo checkout that includes src/cerefox/db/,");
    errorln("   or pass --assets-dir pointing at a bundled server-assets root.");
    process.exit(EXIT_SYSTEM_ERROR);
  }

  println(c.bold("╔══════════════════════════════════════╗"));
  println(c.bold("║  Cerefox DB Deploy                   ║"));
  println(c.bold("╚══════════════════════════════════════╝"));

  if (args.dryRun) {
    println(c.yellow("\n⚠️  DRY-RUN mode — no changes will be made.\n"));
  }

  if (args.reset && !args.dryRun) {
    const ok = await confirmReset();
    if (!ok) {
      println("Aborted.");
      process.exit(EXIT_OK);
    }
  }

  if (!args.dryRun) println("\nConnecting to database...");

  const result = await runDbDeploy({
    dbUrl,
    assets,
    dryRun: args.dryRun,
    reset: args.reset,
    log: (line) => println(c.bold(`\n${line}`)),
  });

  if (!result.ok) {
    errorln(`\n❌  ${result.failedStep} failed: ${result.error}`);
    errorln(`\nDeployment stopped at: ${result.failedStep}`);
    process.exit(EXIT_SYSTEM_ERROR);
  }

  println("\n" + "─".repeat(42));
  if (args.dryRun) {
    println(c.green(`✓  Dry-run complete. ${result.stepsRun} steps would have run.`));
  } else {
    println(c.green(`✓  Deployment complete. ${result.stepsRun} steps applied.`));
    println("\nNext step: verify the schema with:");
    println("    bun scripts/db_status.ts");
  }
}

main().catch((err) => {
  errorln(err instanceof Error ? err.message : String(err));
  process.exit(EXIT_SYSTEM_ERROR);
});
