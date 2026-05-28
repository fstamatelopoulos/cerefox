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
 */

import { Hono } from "hono";

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
    const { data, error } = await ctx.supabase
      .from("cerefox_projects")
      .update({ name, description })
      .eq("id", projectId)
      .select("*")
      .maybeSingle();
    if (error || !data) {
      return c.json({ detail: error?.message ?? "update_project returned no data" }, 500);
    }
    return c.json(projectRowToResponse(data as Record<string, unknown>));
  });

  // ── DELETE /projects/{id} ─────────────────────────────────────────────────
  app.delete("/api/v1/projects/:project_id", async (c) => {
    const projectId = c.req.param("project_id");
    const { error } = await ctx.supabase
      .from("cerefox_projects")
      .delete()
      .eq("id", projectId);
    if (error) return c.json({ detail: error.message }, 500);
    return c.json({ success: true });
  });
}
