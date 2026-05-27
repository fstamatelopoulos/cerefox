/**
 * `cerefox web` — start the local web UI / API server.
 *
 * v0.5 ships an explicit "not yet" message: the TS web server lands in
 * v0.6 (next minor — days, not weeks). For now the Python web server
 * from a clone is the path. Per iter-23 refinement #2, we don't shell
 * out to `uv run` — that would re-introduce the Python prerequisite
 * the npm install was supposed to eliminate.
 */

import type { Command } from "commander";

import { info, println } from "../../../../../_shared/cli-core/index.ts";

export function registerWeb(program: Command): void {
  program
    .command("web")
    .description("Start the local web UI / API server (Python-only until v0.6).")
    .option("--host <host>", "Bind host.", "127.0.0.1")
    .option("--port <port>", "Bind port.", "8000")
    .option("--reload", "Enable hot-reload (dev mode).")
    .action(() => {
      info("`cerefox web` is Python-only in v0.5. The TS web server lands in v0.6.");
      println("");
      println("For now, run from a Cerefox checkout:");
      println("  uv run cerefox web");
      println("");
      println("Or wait for v0.6 — see docs/guides/migration-v0.5.md.");
    });
}
