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
