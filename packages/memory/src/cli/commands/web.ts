/**
 * `cerefox web` — start the local web UI / API server.
 *
 * v0.6.0+: boots the in-process Hono server from `../web/server.ts`. The
 * v0.5 message that pointed users at `uv run cerefox web` is gone — the
 * TS web is the canonical path on npm-installed Cerefox from v0.6 onward.
 *
 * Source-mode boot still works (`bun packages/memory/src/bin/cerefox.ts
 * web`) — Bun TS-loads the source and the same `buildWebServer` factory
 * runs. See plan.md "Local testing during the build" for the three modes.
 *
 * Locked decisions (plan.md § Iteration 24):
 *   - 127.0.0.1 default; no auth on /api/v1/* (local-only personal tool).
 *   - `--watch` flag reserved (Bun's `--hot`); not wired in Part 24A.
 */

import type { Command } from "commander";

import { eprintln, info, println } from "../../../../../_shared/cli-core/index.ts";
import { buildWebServer } from "../../web/server.ts";

interface WebOptions {
  host: string;
  port: string;
  watch?: boolean;
}

export function registerWeb(program: Command): void {
  program
    .command("web")
    .description("Start the local web UI / API server.")
    .option("--host <host>", "Bind host.", "127.0.0.1")
    .option("--port <port>", "Bind port.", "8000")
    .option("--watch", "Enable hot-reload (dev mode; reserved for v0.6.x).")
    .action(async (rawOpts: WebOptions) => {
      const port = Number.parseInt(rawOpts.port, 10);
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        eprintln(`Invalid --port: ${rawOpts.port}`);
        process.exit(2);
      }

      if (rawOpts.watch) {
        info("--watch is reserved; not yet implemented in Part 24A.");
      }

      try {
        const handle = await buildWebServer({ host: rawOpts.host, port });
        info(`Cerefox web listening on http://${handle.host}:${handle.port}/`);
        println(`  Web UI:  http://${handle.host}:${handle.port}/app/`);
        println(`  API:     http://${handle.host}:${handle.port}/api/v1/`);

        const shutdown = async (signal: string) => {
          info(`Received ${signal}; shutting down.`);
          await handle.close().catch(() => {});
          process.exit(0);
        };
        process.on("SIGINT", () => void shutdown("SIGINT"));
        process.on("SIGTERM", () => void shutdown("SIGTERM"));
      } catch (err) {
        eprintln(`Failed to start web server: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
