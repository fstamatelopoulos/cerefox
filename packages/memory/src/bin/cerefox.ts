#!/usr/bin/env node
/**
 * `cerefox` — the main Cerefox CLI binary (v0.5.0+).
 *
 * Sibling of `cerefox-mcp` inside the `@cerefox/memory` npm package.
 * Single growing surface — both bins ship from one package.
 *
 * Top-level responsibilities:
 *   1. Build the commander program (delegated to `program.ts`).
 *   2. Parse argv; commander dispatches to the registered command's action.
 *   3. Catch `CliError` and any unexpected exception; print a tidy
 *      message to stderr with the right exit code.
 *
 * Lazy loading: subcommand bodies are dynamic-imported by their action
 * (see e.g. `commands/mcp.ts` for the pattern), so `cerefox --version`
 * and `cerefox --help` stay sub-100ms.
 */

import { CliError, errorln, info } from "../../../../_shared/cli-core/index.ts";
import { buildProgram } from "../cli/program.ts";

/** Friendly entry point when invoked with no args: state-aware suggestion. */
async function bareEntryPoint(): Promise<void> {
  const { existsSync } = await import("node:fs");
  const { resolveEnvFile } = await import(
    "../../../../_shared/config/index.ts"
  );
  const { c, println } = await import(
    "../../../../_shared/cli-core/index.ts"
  );
  const { PKG_VERSION } = await import("../meta.ts");

  println(c.bold(`Cerefox v${PKG_VERSION}`));
  println(c.dim("User-owned shared memory for AI agents."));
  println("");

  let configExists = false;
  try {
    configExists = existsSync(resolveEnvFile());
  } catch {
    // ignore
  }

  if (!configExists) {
    println(c.yellow("⚠ No config detected."));
    println("Next step:");
    println("  " + c.bold("cerefox init") + "    # interactive first-run setup (~2 min)");
    println("");
    println(c.dim("Once configured, try:"));
    println(c.dim("  cerefox doctor               # verify your install"));
    println(c.dim("  cerefox search \"…\"           # search the KB"));
    println(c.dim("  cerefox ingest <file>        # add a doc"));
  } else {
    println(c.green("✓ Config detected. You're good to go."));
    println("");
    println("Common commands:");
    println(c.dim("  cerefox doctor               # diagnose your install"));
    println(c.dim("  cerefox search \"…\"           # search the KB"));
    println(c.dim("  cerefox ingest <file>        # add a doc"));
    println(c.dim("  cerefox configure-agent      # wire up an MCP client"));
    println("");
    println(c.dim("Run `cerefox --help` for the full command list."));
  }
}

async function main(): Promise<void> {
  // Load `.env` once, before any command body runs.
  //
  // Nothing used to do this: `loadSettings()` was called lazily deep inside
  // whichever helper first needed Supabase credentials, so any code reading
  // `process.env.CEREFOX_*` directly saw an unpopulated environment and
  // silently fell back to its default. That produced two separate bugs —
  // `CEREFOX_BACKUP_DIR` in `.env` was ignored outright, and
  // `CEREFOX_ENV_LABEL` never reached `doctor` — and would keep producing them
  // for every new setting read that way.
  //
  // loadEnv() is idempotent and reads one small file, so the later
  // loadSettings() calls are unaffected and `--help` / `--version` stay fast.
  {
    const { loadEnv } = await import("../../../../_shared/config/index.ts");
    try {
      loadEnv();
    } catch {
      // A missing or unreadable .env is not fatal here: settings can come from
      // the real environment (Cerefox Local does exactly that), and the
      // commands that genuinely need credentials report it themselves.
    }
  }

  // Bare invocation (just `cerefox` with no args): show the state-aware
  // friendly entry instead of commander's default help dump.
  if (process.argv.length === 2) {
    await bareEntryPoint();
    return;
  }

  const program = buildProgram();
  // commander's default exit override throws a "(outputHelp)" CommanderError.
  // We override to differentiate: argv-parse errors → exit 1, version/help → 0.
  program.exitOverride((err) => {
    // Help and version are commander's "success" terminators.
    if (err.code === "commander.helpDisplayed" || err.code === "commander.version") {
      process.exit(0);
    }
    // Anything else (unknown command, missing arg, ambiguous flag) is a
    // user input error.
    process.exit(1);
  });

  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  if (err instanceof CliError) {
    errorln(err.message);
    if (err.hint) {
      info(err.hint);
    }
    process.exit(err.code);
  }
  // Unexpected — print a generic system-error message and exit 2.
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  errorln(`Unexpected error: ${msg}`);
  process.exit(2);
});
