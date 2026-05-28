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
  bundled: z.string().nullable(),
  deployed: z.string().nullable(),
  mismatch: z.boolean(),
});
export type SchemaVersionResponse = z.infer<typeof SchemaVersionResponse>;
