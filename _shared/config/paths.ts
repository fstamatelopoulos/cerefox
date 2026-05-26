/**
 * TypeScript port of `src/cerefox/paths.py`.
 *
 * Same precedence — highest wins:
 *
 *   1. `CEREFOX_CONFIG_DIR` env var (explicit override; supports `~`).
 *   2. Repo-local `.env` in the current working directory (dev mode).
 *   3. `~/.cerefox/` — the user-state root for installed setups.
 *
 * Mirrored 1:1 so `bun scripts/<name>.ts` finds the same `.env` the
 * Python CLI would. See the Python module for the v1.0 revisit note.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { cwd as processCwd, env } from "node:process";

export const USER_STATE_DIR_NAME = ".cerefox";

function expandTilde(p: string): string {
  if (p === "~" || p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

export interface ResolverOptions {
  /** Override CWD; mainly for tests. */
  cwd?: string;
}

export function resolveConfigDir(opts: ResolverOptions = {}): string {
  const override = (env.CEREFOX_CONFIG_DIR ?? "").trim();
  if (override) {
    return resolvePath(expandTilde(override));
  }

  const here = opts.cwd ?? processCwd();
  if (existsSync(join(here, ".env"))) {
    return resolvePath(here);
  }

  return resolvePath(join(homedir(), USER_STATE_DIR_NAME));
}

export function resolveEnvFile(opts: ResolverOptions = {}): string {
  return join(resolveConfigDir(opts), ".env");
}

export function userStateDir(): string {
  return resolvePath(join(homedir(), USER_STATE_DIR_NAME));
}

export function isDevMode(opts: ResolverOptions = {}): boolean {
  if ((env.CEREFOX_CONFIG_DIR ?? "").trim()) return false;
  const here = opts.cwd ?? processCwd();
  return existsSync(join(here, ".env"));
}
