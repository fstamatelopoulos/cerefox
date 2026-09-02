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
 * which perform the write AND its audit entry in one transaction. Author
 * defaults to "web-ui" with author_type "user" — the convention every other
 * web audit site follows (documents-write.ts, ingest.ts), so filtering the
 * trail by author='web-ui' still catches dashboard-originated store-level
 * writes. Since #226 a caller that identifies itself is recorded as itself;
 * see `../identity.ts`.
 */

import { Hono } from "hono";

import { isDuplicateKeyError, storeWriteRemediation } from "../../../../../_shared/mcp-tools/_utils.ts";
import type { WebContext } from "../context.ts";
import { resolveCallerIdentity } from "../identity.ts";

interface ProjectRpcRow {
  project_id: string;
  project_name: string;
  project_description: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** The RPCs return prefixed column names (avoiding plpgsql ambiguity); map
 * to the API's row shape so the response contract is identical to a GET. */
function rpcRowToResponse(row: ProjectRpcRow): Record<string, unknown> {
  return {
    id: row.project_id,
    name: row.project_name,
    description: row.project_description ?? null,
    created_at: row.created_at ?? "",
    updated_at: row.updated_at ?? "",
  };
}

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
    const who = resolveCallerIdentity(c, body as Record<string, unknown>);
    if (!who.ok) return c.json({ detail: who.detail }, 400);
    const { data, error } = await ctx.supabase.rpc("cerefox_create_project", {
      p_name: name,
      p_description: description,
      p_author: who.identity.author,
      p_author_type: who.identity.authorType,
    });
    if (error) {
      const msg = error.message ?? "";
      if (isDuplicateKeyError(msg)) return c.json({ detail: msg }, 409);
      const remediation = storeWriteRemediation(msg, "cerefox_create_project");
      if (remediation) return c.json({ detail: remediation }, 503);
      return c.json({ detail: msg }, 500);
    }
    // The RPC returns the full row (round 4) — no re-read, no fallback.
    const row = (data as ProjectRpcRow[] | null)?.[0];
    if (!row) return c.json({ detail: "create_project returned no data" }, 500);
    return c.json(rpcRowToResponse(row));
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
    // != null: a JSON `null` must mean "not provided", not the string "null"
    // (round 4 — PUT {name: null} renamed the project to literally "null").
    if (body.name != null) {
      const name = String(body.name).trim();
      if (!name) return c.json({ detail: "Project name cannot be empty" }, 400);
      update.name = name;
    }
    if (body.description != null) update.description = String(body.description).trim();
    if (Object.keys(update).length === 0) {
      return c.json({ detail: "Nothing to update — pass name and/or description" }, 400);
    }
    // The RPC updates only the provided fields, diffs against the stored
    // row for the audit description, and audits in-transaction (#219).
    const who = resolveCallerIdentity(c, body as Record<string, unknown>);
    if (!who.ok) return c.json({ detail: who.detail }, 400);
    const { data, error } = await ctx.supabase.rpc("cerefox_update_project", {
      p_project_id: projectId,
      p_name: update.name ?? null,
      p_description: update.description ?? null,
      p_author: who.identity.author,
      p_author_type: who.identity.authorType,
    });
    if (error) {
      const msg = error.message ?? "";
      if (/not found/i.test(msg)) return c.json({ detail: msg }, 404);
      const remediation = storeWriteRemediation(msg, "cerefox_update_project");
      if (remediation) return c.json({ detail: remediation }, 503);
      return c.json({ detail: msg }, 500);
    }
    const row = (data as ProjectRpcRow[] | null)?.[0];
    if (!row) return c.json({ detail: "update_project returned no data" }, 500);
    return c.json(rpcRowToResponse(row));
  });

  // ── DELETE /projects/{id} ─────────────────────────────────────────────────
  app.delete("/api/v1/projects/:project_id", async (c) => {
    const projectId = c.req.param("project_id");
    // The RPC deletes and audits atomically, and audits ONLY when a row was
    // actually removed — the audit log must never assert an event that did
    // not occur (double-click, stale tab → 404 here, no entry).
    // No body on this method — identity comes from headers only.
    const who = resolveCallerIdentity(c);
    if (!who.ok) return c.json({ detail: who.detail }, 400);
    const { data, error } = await ctx.supabase.rpc("cerefox_delete_project", {
      p_project_id: projectId,
      p_author: who.identity.author,
      p_author_type: who.identity.authorType,
    });
    if (error) return c.json({ detail: error.message }, 500);
    const row = (data as Array<{ deleted: boolean }> | null)?.[0];
    if (!row?.deleted) return c.json({ detail: "Project not found" }, 404);
    return c.json({ success: true });
  });
}
