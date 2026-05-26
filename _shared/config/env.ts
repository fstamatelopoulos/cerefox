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

let _loaded = false;

export function loadEnv(opts: ResolverOptions = {}): { path: string; vars: number } {
  // Idempotent: loading twice in one process is a no-op.
  if (_loaded) {
    return { path: "(already loaded)", vars: 0 };
  }
  _loaded = true;

  const envPath = resolveEnvFile(opts);
  let content: string;
  try {
    content = readFileSync(envPath, "utf8");
  } catch {
    return { path: envPath, vars: 0 };
  }

  let count = 0;
  for (const [k, v] of Object.entries(parseDotenv(content))) {
    if (env[k] === undefined) {
      env[k] = v;
      count++;
    }
  }
  return { path: envPath, vars: count };
}

export interface Settings {
  supabaseUrl: string;
  supabaseKey: string;
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
    databaseUrl: env.CEREFOX_DATABASE_URL ?? "",
    openaiApiKey: env.CEREFOX_OPENAI_API_KEY ?? env.OPENAI_API_KEY ?? "",
    fireworksApiKey: env.CEREFOX_FIREWORKS_API_KEY ?? "",
  };
}
