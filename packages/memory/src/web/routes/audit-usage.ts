/**
 * Audit + usage log endpoints (Part 24G — 4 endpoints):
 *
 *   GET /api/v1/audit-log
 *   GET /api/v1/usage-log
 *   GET /api/v1/usage-log/export.csv
 *   GET /api/v1/usage-log/summary
 *
 * Python source: `src/cerefox/api/routes_api.py` lines 1234-1432.
 *
 * R4 (CSV streaming) resolution: Python's `/usage-log/export.csv`
 * doesn't actually stream — it buffers the full CSV in an io.StringIO
 * and returns a single Response (line 1414). At personal-KB scale (the
 * default `limit` is 10000) that's a few MB max. We match Python's
 * behaviour exactly: build the CSV in memory, return it with the same
 * Content-Type / Content-Disposition headers. Streaming would be a
 * future optimisation if logs ever grew past hundreds of MB.
 */

import { Hono } from "hono";

import type { WebContext } from "../context.ts";

interface RpcUsageRow {
  id: string;
  logged_at?: string;
  operation?: string;
  access_path?: string;
  requestor?: string | null;
  document_id?: string | null;
  doc_title?: string | null;
  project_id?: string | null;
  query_text?: string | null;
  result_count?: number | null;
  extra?: Record<string, unknown> | null;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function fetchUsageLog(
  ctx: WebContext,
  c: import("hono").Context,
  defaultLimit: number,
): Promise<RpcUsageRow[]> {
  const params: Record<string, unknown> = {
    p_limit:
      Number.parseInt(c.req.query("limit") ?? String(defaultLimit), 10) ||
      defaultLimit,
  };
  const start = c.req.query("start");
  const end = c.req.query("end");
  const operation = c.req.query("operation");
  const accessPath = c.req.query("access_path");
  const requestor = c.req.query("requestor");
  const projectId = c.req.query("project_id");
  if (start) params.p_start = start;
  if (end) params.p_end = end;
  if (operation) params.p_operation = operation;
  if (accessPath) params.p_access_path = accessPath;
  if (requestor) params.p_requestor = requestor;
  if (projectId) params.p_project_id = projectId;
  const { data, error } = await ctx.supabase.rpc("cerefox_list_usage_log", params);
  if (error) throw error;
  return (data ?? []) as RpcUsageRow[];
}

export function registerAuditUsageRoutes(app: Hono, ctx: WebContext): void {
  // ── GET /audit-log ─────────────────────────────────────────────────────────
  app.get("/api/v1/audit-log", async (c) => {
    const limit = Math.min(
      Math.max(Number.parseInt(c.req.query("limit") ?? "50", 10) || 50, 1),
      200,
    );
    const params: Record<string, unknown> = {
      p_document_id: c.req.query("document_id") || null,
      p_author: c.req.query("author") || null,
      p_operation: c.req.query("operation") || null,
      p_since: c.req.query("since") || null,
      p_until: c.req.query("until") || null,
      p_limit: limit,
    };
    const { data, error } = await ctx.supabase.rpc(
      "cerefox_list_audit_entries",
      params,
    );
    if (error) return c.json({ detail: error.message }, 500);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return c.json(
      rows.map((e) => ({
        id: e.id,
        document_id: (e.document_id as string | null) ?? null,
        doc_title: (e.doc_title as string | null) ?? null,
        version_id: (e.version_id as string | null) ?? null,
        operation: e.operation,
        author: (e.author as string) ?? "unknown",
        author_type: (e.author_type as string) ?? "user",
        size_before: (e.size_before as number | null) ?? null,
        size_after: (e.size_after as number | null) ?? null,
        description: (e.description as string) ?? "",
        created_at: (e.created_at as string) ?? "",
      })),
    );
  });

  // ── GET /usage-log ─────────────────────────────────────────────────────────
  app.get("/api/v1/usage-log", async (c) => {
    try {
      const rows = await fetchUsageLog(ctx, c, 100);
      return c.json(
        rows.map((row) => ({
          id: row.id,
          logged_at: row.logged_at ?? "",
          operation: row.operation,
          access_path: row.access_path,
          requestor: row.requestor ?? null,
          document_id: row.document_id ?? null,
          doc_title: row.doc_title ?? null,
          project_id: row.project_id ?? null,
          query_text: row.query_text ?? null,
          result_count: row.result_count ?? null,
          extra: row.extra ?? {},
        })),
      );
    } catch (err) {
      return c.json(
        { detail: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });

  // ── GET /usage-log/export.csv ──────────────────────────────────────────────
  app.get("/api/v1/usage-log/export.csv", async (c) => {
    try {
      const rows = await fetchUsageLog(ctx, c, 10000);
      const header =
        "id,logged_at,operation,access_path,requestor,document_id,doc_title,project_id,query_text,result_count,extra";
      const lines: string[] = [header];
      for (const row of rows) {
        lines.push(
          [
            csvEscape(row.id),
            csvEscape(row.logged_at),
            csvEscape(row.operation),
            csvEscape(row.access_path),
            csvEscape(row.requestor),
            csvEscape(row.document_id),
            csvEscape(row.doc_title),
            csvEscape(row.project_id),
            csvEscape(row.query_text),
            csvEscape(row.result_count),
            csvEscape(JSON.stringify(row.extra ?? {})),
          ].join(","),
        );
      }
      const body = lines.join("\r\n") + "\r\n";
      return c.body(body, 200, {
        "Content-Type": "text/csv",
        "Content-Disposition":
          'attachment; filename=cerefox-usage-log.csv',
      });
    } catch (err) {
      return c.json(
        { detail: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });

  // ── GET /usage-log/summary ─────────────────────────────────────────────────
  app.get("/api/v1/usage-log/summary", async (c) => {
    const params: Record<string, unknown> = {};
    const start = c.req.query("start");
    const end = c.req.query("end");
    const accessPath = c.req.query("access_path");
    const projectId = c.req.query("project_id");
    if (start) params.p_start = start;
    if (end) params.p_end = end;
    if (accessPath) params.p_access_path = accessPath;
    if (projectId) params.p_project_id = projectId;
    const { data, error } = await ctx.supabase.rpc(
      "cerefox_usage_summary",
      params,
    );
    if (error) return c.json({ detail: error.message }, 500);
    // RPC returns either a single object or a list-with-one-object (per
    // Supabase client quirks). Unwrap both shapes to match Python.
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object") {
      return c.json(data[0]);
    }
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return c.json(data);
    }
    return c.json({});
  });
}
