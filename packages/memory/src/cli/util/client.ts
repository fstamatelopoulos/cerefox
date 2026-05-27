/**
 * Shared Supabase-client factory for CLI commands.
 *
 * Every command that touches the database creates a client via
 * `getClient()` which:
 *   1. Loads settings via `_shared/config/loadSettings()` — same `.env`
 *      resolution as the MCP server and Python CLI.
 *   2. Validates that the required keys are present; raises a `CliError`
 *      (exit 2) with a hint if not.
 *   3. Wraps `@supabase/supabase-js` in the existing `_shared/db-client/`
 *      surface so RPC calls share zod-typed handling with v0.3.0 scripts.
 *
 * The supabase client itself is cheap to construct — no connection pool
 * to share — so we don't memoise. The CLI is a short-lived process.
 */

import {
  createClient as createDbClient,
  type CerefoxDbClient,
} from "../../../../../_shared/db-client/index.ts";
import { loadSettings } from "../../../../../_shared/config/index.ts";
import { systemError } from "../../../../../_shared/cli-core/index.ts";

/**
 * Build a Cerefox DB client for the current CLI invocation. Surfaces a
 * clean error pointing the user at `cerefox doctor` if config is bad.
 */
export function getClient(): CerefoxDbClient {
  const settings = loadSettings();
  if (!settings.supabaseUrl || !settings.supabaseKey) {
    throw systemError(
      "CEREFOX_SUPABASE_URL and CEREFOX_SUPABASE_KEY must be set in your .env file.",
      "Run `cerefox init` to create a config, or see docs/guides/setup-supabase.md.",
    );
  }
  try {
    return createDbClient(settings);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw systemError(
      `Failed to initialise Supabase client: ${msg}`,
      "Run `cerefox doctor` to verify your credentials.",
    );
  }
}

/** Expose the loaded settings without building a client (used by `cerefox doctor`). */
export function getSettings(): ReturnType<typeof loadSettings> {
  return loadSettings();
}
