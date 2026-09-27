/**
 * Schemas for the /config/{key} endpoints (Part 24F).
 *
 * Python source: `src/cerefox/api/routes_api.py` lines 1435-1457.
 * Backed by `cerefox_get_config` / `cerefox_set_config` RPCs that
 * validate the key against an allowlist.
 */

import { z } from "zod";

export const ConfigValueResponse = z.object({
  key: z.string(),
  value: z.string().nullable(),
});
export type ConfigValueResponse = z.infer<typeof ConfigValueResponse>;

export const SetConfigRequest = z.object({
  value: z.string(),
});
export type SetConfigRequest = z.infer<typeof SetConfigRequest>;

// ── Config listing (#270) ────────────────────────────────────────────────────
// Modelled from a live response and asserted by `api-schema-truth.test.ts`.
// Every field derives from CONFIG_CATALOG, so this describes the catalogue as
// the API presents it.

export const ConfigKeyEntry = z.object({
  key: z.string(),
  /** The stored value, or null when the key has never been set. */
  value: z.string().nullable(),
  /** What the server will actually use: stored value, else env, else default. */
  effective: z.string().nullable(),
  description: z.string(),
  kind: z.string(),
  default: z.string().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  group: z.string(),
  high_impact: z.boolean(),
  impact_note: z.string().nullable(),
  env_var: z.string().nullable(),
  /** True when a retired env var for this key is still set and being ignored. */
  /**
   * The retired environment variable still set for this key, or null. Named as
   * a boolean and is not one: the route sends { name, value } so the UI can
   * quote the ignored setting back at the operator. Modelled from the live
   * response after two wrong guesses — see api-schema-truth.test.ts.
   */
  retired_env_set: z.object({ name: z.string(), value: z.string() }).nullable(),
});
export type ConfigKeyEntry = z.infer<typeof ConfigKeyEntry>;

export const ConfigListResponse = z.object({
  config_file: z.string(),
  keys: z.array(ConfigKeyEntry),
});
export type ConfigListResponse = z.infer<typeof ConfigListResponse>;
