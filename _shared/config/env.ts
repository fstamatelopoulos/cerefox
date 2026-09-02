/**
 * Load environment variables from the resolved `.env` file.
 *
 * Uses Bun's native dotenv support when available, falling back to a tiny
 * parser for Node compatibility. Existing `process.env` values are NOT
 * overwritten — explicit env wins over .env, matching pydantic-settings'
 * behavior on the Python side.
 */

import { readFileSync } from "node:fs";
import { env } from "node:process";

import { resolveEnvFile, type ResolverOptions } from "./paths.js";

const KV_LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

function parseDotenv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(KV_LINE);
    if (!match) continue;
    let value = match[2];
    // Strip surrounding single or double quotes.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

/**
 * Which env file this process has already loaded, or null for none.
 *
 * Keyed on the resolved PATH rather than a boolean (#230). A boolean made
 * `loadEnv()` a no-op forever after the first call, including after
 * `CEREFOX_CONFIG_DIR` changed — so a process that loaded one environment and
 * then pointed at another silently kept the first one's values, or kept
 * nothing at all if the first path did not exist.
 *
 * That is not a hypothetical either: `live-write-guard-coverage.test.ts` sets
 * `CEREFOX_CONFIG_DIR` to a deliberately non-existent directory to prove the
 * production-write guard refuses an unlabelled target. Under a boolean flag
 * that one assertion poisoned the cache for the rest of the run, and every
 * live suite loaded afterwards saw no credentials and skipped — passing, while
 * running nothing. Same failure shape as the renamed-probe bug in v1.11.0.
 *
 * Still idempotent for the normal case (repeated calls resolving the same
 * path do no work); it just stops lying when the question changes.
 */
let _loadedPath: string | null = null;

export function loadEnv(opts: ResolverOptions = {}): { path: string; vars: number } {
  const envPath = resolveEnvFile(opts);
  // Idempotent per resolved path: loading the SAME file twice is a no-op.
  if (_loadedPath === envPath) {
    return { path: "(already loaded)", vars: 0 };
  }
  _loadedPath = envPath;

  let content: string;
  try {
    content = readFileSync(envPath, "utf8");
  } catch {
    return { path: envPath, vars: 0 };
  }

  // Normally the ambient environment wins: an exported var is an explicit
  // override of the file. But when the caller has *named an environment* with
  // CEREFOX_CONFIG_DIR, that directory's .env is the authority — otherwise a
  // stray ambient value silently redirects the command at a different backend.
  //
  // This is not hypothetical. Bun auto-loads `.env` from the working directory,
  // so every `bun scripts/*.ts` run inside a repo clone that has its own `.env`
  // arrived here with production credentials already in `env`, and the config
  // dir was ignored. `CEREFOX_CONFIG_DIR=…/staging bun scripts/db_migrate.ts
  // --status` reported production; the same path through `db_deploy.ts --reset`
  // would have wiped production while naming staging on the command line.
  //
  // CEREFOX_CONFIG_DIR itself is never overridden — it selects the file, so
  // letting the file rewrite it would be circular.
  const configDirNamed = (env.CEREFOX_CONFIG_DIR ?? "").trim() !== "";

  let count = 0;
  for (const [k, v] of Object.entries(parseDotenv(content))) {
    if (k === "CEREFOX_CONFIG_DIR") continue;
    if (env[k] === undefined || configDirNamed) {
      env[k] = v;
      count++;
    }
  }
  return { path: envPath, vars: count };
}

export interface Settings {
  supabaseUrl: string;
  supabaseKey: string;
  /**
   * Legacy anon JWT (`eyJ…`). **Deprecated as of iter-28E** — the Edge Functions
   * no longer accept it (they validate the Cerefox access token in-function; see
   * `accessToken`). Retained only so an old `.env` still parses; no code path
   * uses it for auth anymore. May be empty.
   */
  supabaseAnonKey: string;
  /**
   * Cerefox access token (`cfx_pat_…`, iter-28E) — the credential this machine
   * presents to the token-gated Edge Functions (primitive EFs + cerefox-mcp's
   * static path). Used by the version-aggregator compatibility probe (`doctor`)
   * and the live EF/remote-MCP tests. Set by `cerefox token generate`. May be
   * empty (then the EF version check is skipped).
   */
  accessToken: string;
  databaseUrl: string;
  openaiApiKey: string;
  fireworksApiKey: string;
}

/** Read the subset of settings the v0.3.0 TS scripts care about. */
export function loadSettings(opts: ResolverOptions = {}): Settings {
  loadEnv(opts);
  return {
    supabaseUrl: env.CEREFOX_SUPABASE_URL ?? "",
    supabaseKey: env.CEREFOX_SUPABASE_KEY ?? "",
    supabaseAnonKey: env.CEREFOX_SUPABASE_ANON_KEY ?? "",
    accessToken: env.CEREFOX_ACCESS_TOKEN ?? "",
    databaseUrl: env.CEREFOX_DATABASE_URL ?? "",
    openaiApiKey: env.CEREFOX_OPENAI_API_KEY ?? env.OPENAI_API_KEY ?? "",
    fireworksApiKey: env.CEREFOX_FIREWORKS_API_KEY ?? "",
  };
}
