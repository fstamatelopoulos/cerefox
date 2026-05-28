/**
 * TypeScript port of `src/cerefox/paths.py`.
 *
 * Precedence — highest wins:
 *
 *   1. `CEREFOX_CONFIG_DIR` env var (explicit override; supports `~`).
 *   2. `~/.cerefox/` — the user-state root, **if `.env` exists there**.
 *   3. Repo-local `.env` in the current working directory (legacy dev-mode
 *      fallback).
 *   4. `~/.cerefox/` — fallback when nothing else matches (path may not
 *      yet exist; caller materialises it via `mkdirSync`).
 *
 * **v0.5.3 precedence change**: levels 2 and 3 are now inverted vs. v0.5.2.
 * Before v0.5.3, repo-local `.env` always won over `~/.cerefox/.env`. That
 * matched the v0.x defensive default but blocked the migration from
 * Python's `<repo>/.env` model to the installer's `~/.cerefox/.env` model.
 * Now, once a user runs `cerefox init` and writes `~/.cerefox/.env`, the
 * home file wins; existing repo `.env` files stay readable only via the
 * legacy fallback (level 3), which Python (`uv run cerefox …`) keeps
 * using through v0.7.x. See the v0.5.3 entry in the Cerefox Decision Log.
 *
 * **Existing users see no behavior change** until they run `cerefox init`:
 * if `~/.cerefox/.env` doesn't exist, level 3 still matches their repo
 * `.env` and the CLI reads it as before.
 *
 * Python `src/cerefox/paths.py` keeps the v0.5.2 precedence (CWD wins
 * over `~/.cerefox/`) through v0.7.x for backward compatibility with
 * `uv run cerefox …` workflows. When Python is fully retired in v0.9+,
 * `paths.py` goes with it.
 */

import { existsSync, readFileSync } from "node:fs";
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
  /** Override home directory; mainly for tests. */
  home?: string;
}

function userStateDirAbs(opts: ResolverOptions): string {
  return resolvePath(join(opts.home ?? homedir(), USER_STATE_DIR_NAME));
}

export function resolveConfigDir(opts: ResolverOptions = {}): string {
  const override = (env.CEREFOX_CONFIG_DIR ?? "").trim();
  if (override) {
    return resolvePath(expandTilde(override));
  }

  // v0.5.3: prefer ~/.cerefox/.env if the user has run `cerefox init`.
  const userState = userStateDirAbs(opts);
  if (existsSync(join(userState, ".env"))) {
    return userState;
  }

  // Legacy dev-mode fallback: repo-local .env wins when home isn't set up.
  // This preserves the experience for existing users who haven't migrated
  // yet — their <repo>/.env keeps working without any action on their part.
  //
  // Tightened (iter-24 / v0.6): only treat the CWD `.env` as a Cerefox env
  // if it actually contains at least one `CEREFOX_*` key. Without this,
  // running `cerefox` from an unrelated Node project (its own `.env` full
  // of `DATABASE_URL=...`, etc.) would silently inherit garbage values
  // and surface as cryptic Supabase-auth failures. Flagged as a v0.5.3
  // leftover in the pre-iter-24 review; resolved here.
  const here = opts.cwd ?? processCwd();
  const cwdEnv = join(here, ".env");
  if (existsSync(cwdEnv) && cwdEnvHasCerefoxKey(cwdEnv)) {
    return resolvePath(here);
  }

  return userState;
}

function cwdEnvHasCerefoxKey(envPath: string): boolean {
  try {
    const contents = readFileSync(envPath, "utf8");
    return /^\s*CEREFOX_[A-Z0-9_]+\s*=/m.test(contents);
  } catch {
    return false;
  }
}

export function resolveEnvFile(opts: ResolverOptions = {}): string {
  return join(resolveConfigDir(opts), ".env");
}

export function userStateDir(opts: ResolverOptions = {}): string {
  return userStateDirAbs(opts);
}

/**
 * `true` if the legacy dev-mode fallback is currently in effect: i.e. the
 * CLI will read `<cwd>/.env` because `CEREFOX_CONFIG_DIR` is unset AND
 * `~/.cerefox/.env` does not exist AND `<cwd>/.env` does exist.
 *
 * Distinct from `hasLegacyCwdEnv()` which reports whether the CWD `.env`
 * exists regardless of whether it's actually in effect.
 */
export function isDevMode(opts: ResolverOptions = {}): boolean {
  if ((env.CEREFOX_CONFIG_DIR ?? "").trim()) return false;
  if (existsSync(join(userStateDirAbs(opts), ".env"))) return false;
  const here = opts.cwd ?? processCwd();
  return existsSync(join(here, ".env"));
}

/**
 * `true` if a CWD `.env` exists (regardless of whether it's actually in
 * effect). Useful for doctor's "legacy env shadowed" reporting.
 */
export function hasLegacyCwdEnv(opts: ResolverOptions = {}): boolean {
  const here = opts.cwd ?? processCwd();
  return existsSync(join(here, ".env"));
}
