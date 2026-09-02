/**
 * Fire-and-forget usage logging for the web UI (`access_path = "webapp"`).
 *
 * The CLI and MCP tools log to `cerefox_usage_log`, but the web `/api/v1` routes
 * did not — so the Analytics page showed nothing for web-only usage even with
 * `usage_tracking_enabled = true`. This adds the missing web-side logging.
 *
 * Best-effort, exactly like the CLI/MCP `logUsage`: never throws, never blocks the
 * response (the `cerefox_log_usage` RPC itself returns early when tracking is off).
 */

import type { WebContext } from "./context.ts";
import { DEFAULT_WEB_AUTHOR, type WebAccessPath } from "./identity.ts";

export interface WebUsageParams {
  operation: string;
  document_id?: string | null;
  project_id?: string | null;
  query_text?: string | null;
  result_count?: number | null;
  requestor?: string | null;
  /**
   * Where the call came from (iter-40, #226). Derived from whether the caller
   * identified itself — never taken from the request. Defaults to `"webapp"`,
   * which is what every caller was recorded as before #226.
   */
  access_path?: WebAccessPath | null;
}

export function logWebUsage(ctx: WebContext, params: WebUsageParams): void {
  Promise.resolve(
    ctx.supabase.rpc("cerefox_log_usage", {
      p_operation: params.operation,
      p_access_path: params.access_path ?? "webapp",
      p_requestor: params.requestor ?? DEFAULT_WEB_AUTHOR,
      p_document_id: params.document_id ?? null,
      p_project_id: params.project_id ?? null,
      p_query_text: params.query_text ?? null,
      p_result_count: params.result_count ?? null,
      p_extra: {},
    }),
  ).catch(() => {});
}
