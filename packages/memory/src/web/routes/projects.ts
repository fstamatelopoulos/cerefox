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

export function registerProjectsRoutes(app: Hono, ctx: WebContext): void {
  app.get("/api/v1/projects", async (c) => {
    const { data, error } = await ctx.supabase
      .from("cerefox_projects")
      .select("*")
      .order("name");
    if (error) return c.json({ detail: error.message }, 500);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return c.json(
      rows.map((p) => ({
        id: p.id,
        name: p.name,
        description: (p.description as string | null) ?? null,
        created_at: (p.created_at as string | null) ?? null,
        updated_at: (p.updated_at as string | null) ?? null,
      })),
    );
  });
}
