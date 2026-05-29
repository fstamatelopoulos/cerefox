/**
 * Daemon-mode lifecycle for `cerefox web` (iter-26 Part 26F).
 *
 * Subcommands:
 *   cerefox web start   — spawn the foreground server detached, write a pidfile
 *   cerefox web stop    — SIGTERM the daemon, poll, SIGKILL fallback
 *   cerefox web status  — pidfile + process-liveness + HTTP-reachability
 *
 * Bare `cerefox web` (no subcommand) stays foreground for active dev.
 *
 * Pidfile: ~/.cerefox/web.pid  (JSON: { pid, port, host, startedAt })
 * Logfile: ~/.cerefox/web.log  (append-only; no Cerefox-side rotation)
 *
 * Reference shape: cfcf's packages/cli/src/{commands/server.ts,
 * server-spawn.ts} + packages/core/src/pid-file.ts. Unix-first; Windows
 * daemon-mode is a follow-up (see `assertUnix`).
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = join(homedir(), ".cerefox");
const PID_FILE = join(STATE_DIR, "web.pid");
const LOG_FILE = join(STATE_DIR, "web.log");

export interface PidInfo {
  pid: number;
  port: number;
  host: string;
  startedAt: string;
}

export const daemonPaths = { stateDir: STATE_DIR, pidFile: PID_FILE, logFile: LOG_FILE };

function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

export function readPidFile(): PidInfo | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(PID_FILE, "utf8")) as Partial<PidInfo>;
    if (typeof parsed.pid !== "number") return null;
    return {
      pid: parsed.pid,
      port: typeof parsed.port === "number" ? parsed.port : 8000,
      host: typeof parsed.host === "string" ? parsed.host : "127.0.0.1",
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "unknown",
    };
  } catch {
    return null;
  }
}

function writePidFile(info: PidInfo): void {
  ensureStateDir();
  writeFileSync(PID_FILE, JSON.stringify(info, null, 2) + "\n", "utf8");
}

function removePidFile(): void {
  rmSync(PID_FILE, { force: true });
}

/** Signal-0 liveness probe: true when a process with `pid` exists. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process; EPERM = exists but not ours (treat as alive).
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** HTTP-probe the server's /version endpoint; true when it answers 200. */
async function isResponding(host: string, port: number, timeoutMs = 1_500): Promise<boolean> {
  const probeHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(`http://${probeHost}:${port}/api/v1/version`, {
        signal: ctrl.signal,
      });
      return resp.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assertUnix(): void {
  if (process.platform === "win32") {
    throw new Error(
      "Daemon mode (`cerefox web start/stop/status`) is not supported on Windows yet. " +
        "Run `cerefox web` in the foreground, or set up a Windows service manually.",
    );
  }
}

export interface StartOptions {
  host: string;
  port: number;
  /** The cerefox bin/script to spawn (process.argv[1]). */
  scriptPath: string;
  /** The runtime to spawn it with (process.execPath: node or bun). */
  runtime: string;
}

export type StartOutcome =
  | { kind: "already-running"; info: PidInfo }
  | { kind: "port-conflict"; info: PidInfo }
  | { kind: "started"; pid: number; responding: boolean };

/**
 * Start the server detached. Idempotent: if a live daemon already exists on
 * the same port → `already-running`; on a different port → `port-conflict`
 * (caller decides exit code). A stale pidfile is cleaned and start proceeds.
 */
export async function startDaemon(opts: StartOptions): Promise<StartOutcome> {
  assertUnix();
  ensureStateDir();

  const existing = readPidFile();
  if (existing && isProcessAlive(existing.pid)) {
    return existing.port === opts.port
      ? { kind: "already-running", info: existing }
      : { kind: "port-conflict", info: existing };
  }
  if (existing) removePidFile(); // stale

  // Append-mode log fd shared as the child's stdout + stderr.
  const logFd = openSync(LOG_FILE, "a");
  const child = spawn(
    opts.runtime,
    [opts.scriptPath, "web", "--host", opts.host, "--port", String(opts.port)],
    { detached: true, stdio: ["ignore", logFd, logFd] },
  );
  child.unref();

  if (typeof child.pid !== "number") {
    throw new Error("Failed to spawn the web server process (no pid).");
  }

  writePidFile({
    pid: child.pid,
    port: opts.port,
    host: opts.host,
    startedAt: new Date().toISOString(),
  });

  // Brief readiness poll so we can tell the user whether it bound.
  let responding = false;
  for (let i = 0; i < 20; i++) {
    if (!isProcessAlive(child.pid)) break; // died early (e.g. port in use)
    if (await isResponding(opts.host, opts.port)) {
      responding = true;
      break;
    }
    await sleep(250);
  }

  return { kind: "started", pid: child.pid, responding };
}

export type StopOutcome =
  | { kind: "not-running" }
  | { kind: "stopped"; pid: number; forced: boolean };

/** Stop the daemon: SIGTERM, poll up to 3s, SIGKILL fallback. */
export async function stopDaemon(): Promise<StopOutcome> {
  assertUnix();
  const info = readPidFile();
  if (!info || !isProcessAlive(info.pid)) {
    removePidFile();
    return { kind: "not-running" };
  }

  try {
    process.kill(info.pid, "SIGTERM");
  } catch {
    // already gone
  }

  let forced = false;
  let alive = true;
  for (let i = 0; i < 12; i++) {
    await sleep(250);
    if (!isProcessAlive(info.pid)) {
      alive = false;
      break;
    }
  }
  if (alive) {
    try {
      process.kill(info.pid, "SIGKILL");
      forced = true;
    } catch {
      // gone between checks
    }
  }

  removePidFile();
  return { kind: "stopped", pid: info.pid, forced };
}

export type DaemonStatus =
  | { kind: "stopped" }
  | { kind: "stale"; info: PidInfo }
  | { kind: "running"; info: PidInfo; responding: boolean };

/** Report daemon status: stopped / stale-pidfile / running(+reachable). */
export async function statusDaemon(): Promise<DaemonStatus> {
  const info = readPidFile();
  if (!info) return { kind: "stopped" };
  if (!isProcessAlive(info.pid)) return { kind: "stale", info };
  const responding = await isResponding(info.host, info.port);
  return { kind: "running", info, responding };
}
