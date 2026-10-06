/**
 * Schemas for meta endpoints: /version, /docs, /docs/{path}, /schema-version.
 *
 * Python source: `src/cerefox/api/routes_api.py`
 *   - api_version  (line 68): { version, git_commit_short, build_date }
 *   - api_list_docs  (line 76): list of { path, title, category }
 *   - api_get_doc  (line 87): raw text/markdown — no JSON schema needed
 *   - api_schema_version  (line 119): { bundled, deployed, mismatch }
 */

import { z } from "zod";

export const VersionResponse = z.object({
  version: z.string(),
  git_commit_short: z.string().nullable(),
  build_date: z.string().nullable(),
  /** `CEREFOX_ENV_LABEL` (e.g. "STAGING"), or null on an unlabeled target. */
  env_label: z.string().nullable(),
  /** The npm registry's `latest` release as last checked (daily, by the
   *  server); null when not yet known or when the check is turned off
   *  (`CEREFOX_NO_UPDATE_CHECK`). */
  latest: z.string().nullable(),
  /** What to run to upgrade, when `latest` is newer than `version`; else
   *  null. `cerefox-local upgrade` inside the Cerefox Local container. */
  update_command: z.string().nullable(),
});
export type VersionResponse = z.infer<typeof VersionResponse>;

export const BundledDocEntry = z.object({
  path: z.string(),
  title: z.string(),
  category: z.string(),
});
export type BundledDocEntry = z.infer<typeof BundledDocEntry>;

export const BundledDocList = z.array(BundledDocEntry);
export type BundledDocList = z.infer<typeof BundledDocList>;

export const SchemaVersionResponse = z.object({
  /** The schema version this client ships; null only if its assets cannot be found. */
  bundled: z.string().nullable(),
  /** `cerefox_schema_version()` on the store; null without a database. */
  deployed: z.string().nullable(),
  /** True when the deployed schema is OLDER than `bundled`: run `cerefox server deploy`. */
  mismatch: z.boolean(),
  /** `ok`, `above-min-but-old` (works; a newer server exists), `below-min`
   *  (blocking: `cerefox server deploy`), or `unknown`. */
  level: z.string(),
  /** The oldest deployed schema this client works correctly against. */
  min: z.string(),
});
export type SchemaVersionResponse = z.infer<typeof SchemaVersionResponse>;

// ── Preferences (#270) ───────────────────────────────────────────────────────
// Machine-local web UI settings, stored in a file in the user-state dir rather
// than the database — which is why this route works even with no DB configured.

export const PreferencesResponse = z.object({
  theme: z.string(),
});
export type PreferencesResponse = z.infer<typeof PreferencesResponse>;

export const PreferencesRequest = z.object({
  theme: z.enum(["auto", "light", "dark"]),
});
export type PreferencesRequest = z.infer<typeof PreferencesRequest>;
