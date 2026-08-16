/**
 * Project endpoints — GET-side only in Part 24C.
 *
 * /api/v1/projects (list) and /api/v1/projects/{id}/documents (paginated
 * documents-for-project) belong to this file. POST/PUT/DELETE land in
 * Part 24F under the same `registerProjectsRoutes`. The
 * /projects/{id}/documents handler is registered in `discovery.ts` to
 * keep the dashboard-shaped doc projection logic in one place.
 *
 * Python source: `src/cerefox/api/routes_api.py` lines 417-438 (list).
 *
 * 0.14.0 (#147): the three write routes record project-create / project-edit /
 * project-delete audit entries via the shared helper (author "user" — web
 * writes always carry the human author). Best-effort: the write's success is
 * never rolled back over a failed audit entry.
 */

import { Hono } from "hono";

import { auditProjectOp } from "../../../../../_shared/mcp-tools/_projects.ts";
import type { MCPSupabaseClient } from "../../../../../_shared/mcp-tools/types.ts";
import type { WebContext } from "../context.ts";

function projectRowToResponse(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    description: (row.description as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? "",
    updated_at: (row.updated_at as string | null) ?? "",
  };
}

export function registerProjectsRoutes(app: Hono, ctx: WebContext): void {
  const audit = ctx.supabase as unknown as MCPSupabaseClient;

  // ── GET /projects ─────────────────────────────────────────────────────────
  app.get("/api/v1/projects", async (c) => {
    const { data, error } = await ctx.supabase
      .from("cerefox_projects")
      .select("*")
      .order("name");
    if (error) return c.json({ detail: error.message }, 500);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return c.json(rows.map(projectRowToResponse));
  });

  // ── POST /projects ────────────────────────────────────────────────────────
  app.post("/api/v1/projects", async (c) => {
    let body: { name?: unknown; description?: unknown };
    try {
      body = (await c.req.json()) as { name?: unknown; description?: unknown };
    } catch {
      return c.json({ detail: "Invalid JSON body" }, 400);
    }
    const name = String(body.name ?? "").trim();
    if (!name) return c.json({ detail: "Project name is required" }, 400);
    const description = String(body.description ?? "").trim();
    const { data, error } = await ctx.supabase
      .from("cerefox_projects")
      .insert({ name, description })
      .select("*")
      .maybeSingle();
    if (error || !data) {
      return c.json({ detail: error?.message ?? "create_project returned no data" }, 500);
    }
    await auditProjectOp(audit, {
      operation: "project-create",
      description: `Project '${name}' created`,
      author: "user",
      authorType: "user",
    });
    return c.json(projectRowToResponse(data as Record<string, unknown>));
  });

  // ── PUT /projects/{id} ────────────────────────────────────────────────────
  app.put("/api/v1/projects/:project_id", async (c) => {
    const projectId = c.req.param("project_id");
    let body: { name?: unknown; description?: unknown };
    try {
      body = (await c.req.json()) as { name?: unknown; description?: unknown };
    } catch {
      return c.json({ detail: "Invalid JSON body" }, 400);
    }
    const name = String(body.name ?? "").trim();
    const description = String(body.description ?? "").trim();
    // The old name makes the audit description say what actually changed.
    const { data: before } = await ctx.supabase
      .from("cerefox_projects")
      .select("name")
      .eq("id", projectId)
      .maybeSingle();
    const { data, error } = await ctx.supabase
      .from("cerefox_projects")
      .update({ name, description })
      .eq("id", projectId)
      .select("*")
      .maybeSingle();
    if (error || !data) {
      return c.json({ detail: error?.message ?? "update_project returned no data" }, 500);
    }
    const oldName = (before as { name?: string } | null)?.name;
    await auditProjectOp(audit, {
      operation: "project-edit",
      description:
        oldName && oldName !== name
          ? `Project '${oldName}' renamed to '${name}'`
          : `Project '${name}' edited`,
      author: "user",
      authorType: "user",
    });
    return c.json(projectRowToResponse(data as Record<string, unknown>));
  });

  // ── DELETE /projects/{id} ─────────────────────────────────────────────────
  app.delete("/api/v1/projects/:project_id", async (c) => {
    const projectId = c.req.param("project_id");
    // DELETE ... RETURNING in one statement: the returned row is both the
    // proof a deletion happened and the name for the trail. Auditing off a
    // separate pre-SELECT would fabricate an immutable "deleted" record when
    // nothing matched (double-click, stale tab) — the audit log must never
    // assert an event that did not occur.
    const { data: deleted, error } = await ctx.supabase
      .from("cerefox_projects")
      .delete()
      .eq("id", projectId)
      .select("name");
    if (error) return c.json({ detail: error.message }, 500);
    const row = (deleted as Array<{ name?: string }> | null)?.[0];
    if (!row) return c.json({ detail: "Project not found" }, 404);
    await auditProjectOp(audit, {
      operation: "project-delete",
      description: `Project '${row.name ?? projectId}' deleted`,
      author: "user",
      authorType: "user",
    });
    return c.json({ success: true });
  });
}
