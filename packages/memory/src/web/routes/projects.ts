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
 * 0.14.0 (#147/#219): the three write routes call the project write RPCs
 * (cerefox_create_project / cerefox_update_project / cerefox_delete_project),
 * which perform the write AND its audit entry in one transaction. Author is
 * "user" — web writes always carry the human author.
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
    const { data, error } = await ctx.supabase.rpc("cerefox_create_project", {
      p_name: name,
      p_description: description,
      p_author: "user",
      p_author_type: "user",
    });
    if (error) {
      const status = /duplicate key|unique/i.test(error.message ?? "") ? 409 : 500;
      return c.json({ detail: error.message }, status as 409 | 500);
    }
    const row = (data as Array<{ project_id: string; project_name: string }> | null)?.[0];
    if (!row) return c.json({ detail: "create_project returned no data" }, 500);
    // Re-read for the full row shape the UI expects (timestamps).
    const { data: full } = await ctx.supabase
      .from("cerefox_projects")
      .select("*")
      .eq("id", row.project_id)
      .maybeSingle();
    return c.json(projectRowToResponse((full ?? { id: row.project_id, name: row.project_name }) as Record<string, unknown>));
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
    // Update ONLY the fields the body carries (mirrors the CLI): a
    // description-only PUT used to blank the name via String(undefined ?? ""),
    // and the audit entry would have immortalized the accident.
    const update: { name?: string; description?: string } = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return c.json({ detail: "Project name cannot be empty" }, 400);
      update.name = name;
    }
    if (body.description !== undefined) update.description = String(body.description).trim();
    if (Object.keys(update).length === 0) {
      return c.json({ detail: "Nothing to update — pass name and/or description" }, 400);
    }
    // The RPC updates only the provided fields, diffs against the stored
    // row for the audit description, and audits in-transaction (#219).
    const { data, error } = await ctx.supabase.rpc("cerefox_update_project", {
      p_project_id: projectId,
      p_name: update.name ?? null,
      p_description: update.description ?? null,
      p_author: "user",
      p_author_type: "user",
    });
    if (error) {
      const msg = error.message ?? "";
      if (/not found/i.test(msg)) return c.json({ detail: msg }, 404);
      return c.json({ detail: msg }, 500);
    }
    const row = (data as Array<{ project_id: string }> | null)?.[0];
    if (!row) return c.json({ detail: "update_project returned no data" }, 500);
    const { data: full } = await ctx.supabase
      .from("cerefox_projects")
      .select("*")
      .eq("id", row.project_id)
      .maybeSingle();
    return c.json(projectRowToResponse((full ?? row) as Record<string, unknown>));
  });

  // ── DELETE /projects/{id} ─────────────────────────────────────────────────
  app.delete("/api/v1/projects/:project_id", async (c) => {
    const projectId = c.req.param("project_id");
    // The RPC deletes and audits atomically, and audits ONLY when a row was
    // actually removed — the audit log must never assert an event that did
    // not occur (double-click, stale tab → 404 here, no entry).
    const { data, error } = await ctx.supabase.rpc("cerefox_delete_project", {
      p_project_id: projectId,
      p_author: "user",
      p_author_type: "user",
    });
    if (error) return c.json({ detail: error.message }, 500);
    const row = (data as Array<{ deleted: boolean }> | null)?.[0];
    if (!row?.deleted) return c.json({ detail: "Project not found" }, 404);
    return c.json({ success: true });
  });
}
