/**
 * `cerefox deploy-server` — the catch-all for standing up *and updating*
 * the Cerefox server side on your Supabase project: the Postgres schema +
 * RPCs (in-process) and the 9 Edge Functions (via `npx supabase functions
 * deploy`).
 *
 * Eliminates the repo-clone step: the server assets (SQL + EF sources) ship
 * bundled in `dist/server-assets/`, so a fresh `npm install -g
 * @cerefox/memory` can stand up the whole server.
 *
 * Fresh vs. existing (v0.8.1): the DB half detects whether a Cerefox schema
 * already exists.
 *   - Fresh DB → apply schema.sql + rpcs.sql + stamp migrations (full deploy).
 *   - Existing DB → apply pending migrations + refresh RPCs (an *update*).
 * So a release that changes RPCs and/or adds a migration is deployed by
 * re-running this command — no separate migrate step needed. (The low-level
 * `scripts/db_deploy.ts` / `db_migrate.ts` remain for contributors.)
 *
 * Comprehensive pre-flight: every external prerequisite is probed up-front
 * and reported as a single all-or-nothing remediation list. Idempotent.
 *
 * Flags: --dry-run (plan only, no prompt), --schema-only, --functions-only,
 * --project-ref (override the ref derived from CEREFOX_SUPABASE_URL for EF
 * deploys). There is deliberately NO --reset (drop-everything) here — a full wipe is a
 * contributor/recovery operation; use `bun scripts/db_deploy.ts --reset`
 * (repo clone, typed-`yes` guard) if you truly need it.
 */

import type { Command } from "commander";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdirSync } from "node:fs";

import {
  c,
  confirm,
  eprintln,
  info,
  println,
} from "../../../../../_shared/cli-core/index.ts";
import { loadSettings } from "../../../../../_shared/config/index.ts";
import { resolveServerAssets } from "../../../../../_shared/server-assets/index.ts";
import {
  applyRpcs,
  detectExistingSchema,
  migrationStatus,
  runDbDeploy,
  runDbMigrate,
} from "../../../../../_shared/db-deploy/index.ts";

interface DeployServerOptions {
  dryRun?: boolean;
  schemaOnly?: boolean;
  functionsOnly?: boolean;
  projectRef?: string;
}

/** One pre-flight check + its remediation when failed. */
interface Preflight {
  label: string;
  ok: boolean;
  remediation?: string;
}

function commandSucceeds(cmd: string, args: string[]): boolean {
  try {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 15_000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Derive the Supabase project ref from CEREFOX_SUPABASE_URL
 * (`https://<ref>.supabase.co` → `<ref>`). Refs are 20 lowercase
 * alphanumerics. Returns null for custom domains / unparseable URLs — the
 * caller then relies on the explicit `--project-ref` flag.
 *
 * We pass `--project-ref` to `supabase functions deploy` so the deploy works
 * from the bundled-assets directory without a per-directory `supabase link`
 * (link state lives in `supabase/.temp/` of whatever dir you linked, which is
 * NOT the bundled-assets dir the CLI runs in).
 */
function parseProjectRef(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    const host = new URL(supabaseUrl).hostname; // e.g. ljdz….supabase.co
    const label = host.split(".")[0];
    return /^[a-z0-9]{20}$/.test(label) ? label : null;
  } catch {
    return null;
  }
}

/** List the cerefox-* Edge Function directories under the resolved assets. */
function listEdgeFunctions(functionsDir: string): string[] {
  if (!existsSync(functionsDir)) return [];
  return readdirSync(functionsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("cerefox-"))
    .map((e) => e.name)
    .sort();
}

async function action(options: DeployServerOptions): Promise<void> {
  const settings = loadSettings();
  // resolveServerAssets() picks the bundled dist/server-assets/ (when run
  // from the installed bin) or the repo src layout (source mode) by itself.
  const assets = resolveServerAssets();

  const doSchema = !options.functionsOnly;
  const doFunctions = !options.schemaOnly;

  // Project ref for `supabase functions deploy --project-ref` (see
  // parseProjectRef). Explicit flag wins; otherwise derive from the URL.
  const projectRef = options.projectRef ?? parseProjectRef(settings.supabaseUrl);

  // ── Pre-flight ────────────────────────────────────────────────────────────
  const checks: Preflight[] = [];

  if (doSchema) {
    checks.push({
      label: "CEREFOX_DATABASE_URL is set (Session Pooler, port 5432)",
      ok: Boolean(settings.databaseUrl),
      remediation:
        "Set CEREFOX_DATABASE_URL in your .env. Use the Session Pooler URI " +
        "(port 5432, username postgres.<project-ref>, ?sslmode=require). " +
        "See docs/guides/setup-supabase.md → Connection pooling.",
    });
    checks.push({
      label: "Bundled schema assets present",
      ok: existsSync(assets.schemaFile) && existsSync(assets.rpcsFile),
      remediation:
        "Schema files not found. Reinstall the package, or run from a repo " +
        "clone (src/cerefox/db/).",
    });
  }

  let efNames: string[] = [];
  if (doFunctions) {
    efNames = listEdgeFunctions(assets.functionsDir);
    checks.push({
      label: "Bundled Edge Function sources present",
      ok: efNames.length > 0,
      remediation:
        "Edge Function sources not found under the bundled assets. Reinstall " +
        "the package, or run from a repo clone (supabase/functions/).",
    });
    checks.push({
      label: "Supabase CLI reachable (`npx supabase --version`)",
      ok: commandSucceeds("npx", ["--yes", "supabase", "--version"]),
      remediation:
        "Install Node 20+ (npx ships with it) from nodejs.org, then re-run. " +
        "`cerefox deploy-server` shells out to the Supabase CLI via npx.",
    });
    // Project ref: we pass it explicitly to `functions deploy`, so we DON'T
    // need a per-directory `supabase link` (that state lives in the dir you
    // linked, not the bundled-assets dir the CLI runs in). We do need a
    // resolvable ref + a logged-in CLI; login is global, so we just remind
    // about it here and let the deploy surface a clear error if it's missing.
    checks.push({
      label: "Supabase project ref resolved (from CEREFOX_SUPABASE_URL)",
      ok: Boolean(projectRef),
      remediation:
        "Could not derive the project ref from CEREFOX_SUPABASE_URL.\n" +
        "    Set CEREFOX_SUPABASE_URL to your project URL " +
        "(https://<project-ref>.supabase.co), or pass --project-ref <ref>.\n" +
        "    Also make sure you're logged in once: npx supabase login",
    });
  }

  const failed = checks.filter((ch) => !ch.ok);
  println(c.bold("Cerefox deploy-server — pre-flight"));
  for (const ch of checks) {
    println(`  ${ch.ok ? c.green("✓") : c.red("✗")} ${ch.label}`);
  }
  if (failed.length > 0) {
    eprintln("");
    eprintln(c.red(`Cannot deploy yet — ${failed.length} prerequisite(s) missing:`));
    for (const ch of failed) {
      eprintln(`\n  ${c.red("✗")} ${ch.label}`);
      eprintln(c.dim(`    → ${ch.remediation}`));
    }
    eprintln("\nFix the above and re-run `cerefox deploy-server` (it's idempotent).");
    process.exit(1);
  }
  println(c.green("\n✓ All prerequisites satisfied."));

  // ── Detect fresh vs existing (read-only probe) ───────────────────────────
  let schemaMode: "fresh" | "existing" | "unknown" = "unknown";
  let pending: string[] = [];
  if (doSchema) {
    try {
      const exists = await detectExistingSchema(settings.databaseUrl);
      schemaMode = exists ? "existing" : "fresh";
      if (exists) {
        pending = (await migrationStatus({ dbUrl: settings.databaseUrl, assets })).pending;
      }
    } catch (err) {
      if (!options.dryRun) {
        eprintln(c.red(`\n✗ Could not connect to the database: ${err instanceof Error ? err.message : String(err)}`));
        eprintln(c.dim("   Verify CEREFOX_DATABASE_URL (Session Pooler, port 5432)."));
        process.exit(1);
      }
      // dry-run tolerates a probe failure — just show a generic plan.
    }
  }

  // ── Plan + confirm ──────────────────────────────────────────────────────
  const planLines: string[] = [];
  if (doSchema) {
    if (schemaMode === "fresh") {
      planLines.push(`  • Deploy fresh schema + RPCs to ${settings.supabaseUrl || "your Supabase database"}`);
    } else if (schemaMode === "existing") {
      planLines.push(
        `  • Update existing schema: apply ${pending.length} pending migration(s) + refresh RPCs`,
      );
      for (const f of pending) planLines.push(c.dim(`      – ${f}`));
    } else {
      planLines.push(`  • Schema + RPCs (fresh or update — couldn't probe the DB)`);
    }
  }
  if (doFunctions) {
    planLines.push(
      `  • Deploy ${efNames.length} Edge Function(s) to project ${projectRef}: ${efNames.join(", ")}`,
    );
  }

  println(c.bold("\nPlan:"));
  for (const line of planLines) println(line);

  if (options.dryRun) {
    println(c.yellow("\n⚠  --dry-run: nothing was deployed."));
    process.exit(0);
  }

  const proceed = await confirm("\nProceed with deployment to Supabase?", true /* default No */);
  if (!proceed) {
    println(c.dim("Aborted."));
    process.exit(0);
  }

  // ── Schema ────────────────────────────────────────────────────────────────
  if (doSchema) {
    if (schemaMode === "fresh") {
      println(c.bold("\n▶  Deploying fresh schema + RPCs…"));
      const result = await runDbDeploy({
        dbUrl: settings.databaseUrl,
        assets,
        log: (line) => println(c.dim(`   ${line}`)),
      });
      if (!result.ok) {
        eprintln(c.red(`\n✗ Schema deploy failed at "${result.failedStep}": ${result.error}`));
        process.exit(1);
      }
      println(c.green(`   ✓ Fresh schema deployed (${result.stepsRun} steps).`));
    } else {
      // Existing DB: apply pending migrations, then refresh RPCs.
      println(c.bold("\n▶  Updating existing schema (migrations + RPC refresh)…"));
      const mig = await runDbMigrate({
        dbUrl: settings.databaseUrl,
        assets,
        log: (line) => println(c.dim(`   ${line}`)),
      });
      if (!mig.ok) {
        eprintln(c.red(`\n✗ Migration "${mig.failedFile}" failed: ${mig.error}`));
        eprintln(c.dim("   Earlier migrations in this run were committed. Fix + re-run."));
        process.exit(1);
      }
      const rpcs = await applyRpcs({
        dbUrl: settings.databaseUrl,
        assets,
        log: (line) => println(c.dim(`   ${line}`)),
      });
      if (!rpcs.ok) {
        eprintln(c.red(`\n✗ RPC refresh failed: ${rpcs.error}`));
        process.exit(1);
      }
      println(
        c.green(
          `   ✓ Applied ${mig.applied.length} migration(s); RPCs refreshed.`,
        ),
      );
    }
  }

  // ── Edge Functions ──────────────────────────────────────────────────────
  if (doFunctions) {
    println(c.bold(`\n▶  Deploying ${efNames.length} Edge Function(s)…`));
    let efOk = 0;
    const efFailed: string[] = [];
    for (const ef of efNames) {
      info(`   deploying ${ef}…`);
      // Run with cwd = the assets root's supabase parent so the CLI finds
      // supabase/functions/<ef>. functionsDir is <root>/supabase/functions.
      // Pass --project-ref explicitly: the bundled-assets dir is not linked
      // (link state lives in whatever dir the user ran `supabase link`), so a
      // bare deploy here couldn't resolve the target project.
      const workdir = assets.functionsDir.replace(/\/functions$/, "").replace(/\/supabase$/, "");
      const args = ["--yes", "supabase", "functions", "deploy", ef];
      if (projectRef) args.push("--project-ref", projectRef);
      const r = spawnSync("npx", args, {
        encoding: "utf8",
        stdio: "inherit",
        cwd: workdir,
        timeout: 120_000,
      });
      if (r.status === 0) efOk++;
      else efFailed.push(ef);
    }
    if (efFailed.length > 0) {
      eprintln(c.red(`\n✗ ${efFailed.length} Edge Function(s) failed: ${efFailed.join(", ")}`));
      eprintln(c.dim("   Re-run `cerefox deploy-server --functions-only` after fixing the cause."));
      process.exit(1);
    }
    println(c.green(`   ✓ Deployed ${efOk} Edge Function(s).`));
  }

  println(c.green("\n✓ Server deploy complete."));
  println(c.dim("Verify with: cerefox doctor"));
}

export function registerDeployServer(program: Command): void {
  program
    .command("deploy-server")
    .description("Deploy/update the Cerefox server side (schema + RPCs + Edge Functions) on Supabase.")
    .option("--dry-run", "Print the plan + pre-flight without deploying.")
    .option("--schema-only", "Deploy/update only the schema + RPCs (skip Edge Functions).")
    .option("--functions-only", "Deploy only the Edge Functions (skip the schema/RPCs).")
    .option(
      "--project-ref <ref>",
      "Supabase project ref for Edge Function deploys (default: derived from CEREFOX_SUPABASE_URL).",
    )
    .action(action);
}
