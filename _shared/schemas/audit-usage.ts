/**
 * Schemas for /audit-log + /usage-log/* endpoints (Part 24G).
 *
 * Python source: `src/cerefox/api/routes_api.py`
 *   - AuditEntryResponse        (line 1220)
 *   - UsageLogEntryResponse     (line 1318)
 *
 * /usage-log/summary returns a free-form JSON object built by the
 * `cerefox_usage_summary` RPC; we model it as `Record<string, unknown>`
 * (the analytics page in the React SPA reads the specific keys it
 * needs).
 */

import { z } from "zod";

export const AuditEntryResponse = z.object({
  id: z.string(),
  document_id: z.string().nullable().optional(),
  doc_title: z.string().nullable().optional(),
  version_id: z.string().nullable().optional(),
  operation: z.string(),
  author: z.string().default("unknown"),
  author_type: z.string().default("user"),
  size_before: z.number().int().nullable().optional(),
  size_after: z.number().int().nullable().optional(),
  description: z.string().default(""),
  created_at: z.string().default(""),
});
export type AuditEntryResponse = z.infer<typeof AuditEntryResponse>;

export const UsageLogEntryResponse = z.object({
  id: z.string(),
  logged_at: z.string().default(""),
  operation: z.string(),
  access_path: z.string(),
  requestor: z.string().nullable().optional(),
  document_id: z.string().nullable().optional(),
  doc_title: z.string().nullable().optional(),
  project_id: z.string().nullable().optional(),
  query_text: z.string().nullable().optional(),
  result_count: z.number().int().nullable().optional(),
  extra: z.record(z.string(), z.unknown()).default({}),
});
export type UsageLogEntryResponse = z.infer<typeof UsageLogEntryResponse>;

export const UsageSummaryResponse = z.record(z.string(), z.unknown());
export type UsageSummaryResponse = z.infer<typeof UsageSummaryResponse>;
