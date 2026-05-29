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

import { c, eprintln, info, localTimestamp, println } from "../../../../../_shared/cli-core/index.ts";
import { buildWebServer, CompatibilityError } from "../../web/server.ts";
import {
  daemonPaths,
  startDaemon,
  statusDaemon,
  stopDaemon,
} from "../../web/daemon.ts";

interface WebOptions {
  host: string;
  port: string;
  watch?: boolean;
}

function parsePort(raw: string): number {
  const port = Number.parseInt(raw, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    eprintln(`Invalid --port: ${raw}`);
    process.exit(2);
  }
  return port;
}

/** Foreground server (bare `cerefox web` + the daemon child process). */
async function runForeground(host: string, port: number, watch?: boolean): Promise<void> {
  if (watch) {
    info("--watch is reserved; not yet implemented.");
  }
  try {
    const handle = await buildWebServer({ host, port });
    // Timestamped to match the request-logger lines in the daemon log
    // (~/.cerefox/web.log); local time per maintainer preference.
    println(`${localTimestamp()}  Cerefox web listening on http://${handle.host}:${handle.port}/`);
    println(`  Web UI:  http://${handle.host}:${handle.port}/app/`);
    println(`  API:     http://${handle.host}:${handle.port}/api/v1/`);

    const shutdown = async (signal: string) => {
      println(`${localTimestamp()}  Received ${signal}; shutting down.`);
      await handle.close().catch(() => {});
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
  } catch (err) {
    if (err instanceof CompatibilityError) {
      eprintln(err.message);
    } else {
      eprintln(`Failed to start web server: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
  }
}

export function registerWeb(program: Command): void {
  const web = program
    .command("web")
    .description("Start the local web UI / API server (foreground; see `web start` for daemon).")
    .option("--host <host>", "Bind host.", "127.0.0.1")
    .option("--port <port>", "Bind port.", "8000")
    .option("--watch", "Enable hot-reload (dev mode; reserved).")
    .action(async (rawOpts: WebOptions) => {
      await runForeground(rawOpts.host, parsePort(rawOpts.port), rawOpts.watch);
    });

  // ── daemon-mode subcommands (iter-26 Part 26F) ────────────────────────────

  web
    .command("start")
    .description("Start the web server in the background (detached daemon).")
    .option("--host <host>", "Bind host.", "127.0.0.1")
    .option("--port <port>", "Bind port.", "8000")
    .action(async (rawOpts: { host: string; port: string }) => {
      const port = parsePort(rawOpts.port);
      try {
        const outcome = await startDaemon({
          host: rawOpts.host,
          port,
          scriptPath: process.argv[1],
          runtime: process.execPath,
        });
        switch (outcome.kind) {
          case "already-running":
            info(
              `Cerefox web is already running on :${outcome.info.port} (pid ${outcome.info.pid}).`,
            );
            process.exit(0);
            break;
          case "port-conflict":
            eprintln(
              `A Cerefox web daemon is already running on :${outcome.info.port} (pid ${outcome.info.pid}).\n` +
                `Stop it first (\`cerefox web stop\`) or start on its port.`,
            );
            process.exit(1);
            break;
          case "started":
            if (outcome.responding) {
              info(`Cerefox web started (pid ${outcome.pid}) on http://${rawOpts.host}:${port}/`);
              println(`  Web UI:  http://${rawOpts.host}:${port}/app/`);
              println(c.dim(`  Logs:    ${daemonPaths.logFile}`));
              println(c.dim(`  Stop:    cerefox web stop`));
            } else {
              eprintln(
                `Started (pid ${outcome.pid}) but it is not responding on :${port} yet.\n` +
                  `Check the log for errors: ${daemonPaths.logFile}`,
              );
              process.exit(1);
            }
            break;
        }
      } catch (err) {
        eprintln(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  web
    .command("stop")
    .description("Stop the background web server daemon.")
    .action(async () => {
      try {
        const outcome = await stopDaemon();
        if (outcome.kind === "not-running") {
          info("No Cerefox web daemon is running.");
        } else {
          info(
            `Stopped Cerefox web (pid ${outcome.pid})${outcome.forced ? " — forced (SIGKILL)" : ""}.`,
          );
        }
      } catch (err) {
        eprintln(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  web
    .command("status")
    .description("Show the background web server daemon status.")
    .action(async () => {
      try {
        const status = await statusDaemon();
        switch (status.kind) {
          case "stopped":
            println("Cerefox web: stopped (no daemon running).");
            break;
          case "stale":
            println(
              c.yellow(
                `Cerefox web: stale pidfile — process ${status.info.pid} is not running.`,
              ),
            );
            println(c.dim(`  Clean up: cerefox web stop  (removes ${daemonPaths.pidFile})`));
            break;
          case "running":
            if (status.responding) {
              println(
                c.green(
                  `Cerefox web: running on :${status.info.port} (pid ${status.info.pid}, since ${status.info.startedAt}).`,
                ),
              );
            } else {
              println(
                c.yellow(
                  `Cerefox web: process ${status.info.pid} alive but not responding on :${status.info.port}.`,
                ),
              );
              println(c.dim(`  Check the log: ${daemonPaths.logFile}`));
            }
            break;
        }
      } catch (err) {
        eprintln(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
