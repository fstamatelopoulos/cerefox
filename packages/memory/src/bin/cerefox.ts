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

async function main(): Promise<void> {
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
