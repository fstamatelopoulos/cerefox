/**
 * Config endpoints (Part 24F — 2 endpoints):
 *
 *   GET /api/v1/config/{key}     — read a value from cerefox_config
 *   PUT /api/v1/config/{key}     — write a value (allowlist-validated by RPC)
 *
 * Python source: `src/cerefox/api/routes_api.py` lines 1435-1457. Both
 * endpoints delegate to the `cerefox_get_config` / `cerefox_set_config`
 * RPCs — allowlist validation lives in the RPC, not here.
 */

import { Hono } from "hono";

import type { WebContext } from "../context.ts";

function unwrapScalarRpc(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    return typeof first === "string" ? first : null;
  }
  return null;
}

export function registerConfigRoutes(app: Hono, ctx: WebContext): void {
  app.get("/api/v1/config/:key", async (c) => {
    const key = c.req.param("key");
    const { data, error } = await ctx.supabase.rpc("cerefox_get_config", {
      p_key: key,
    });
    if (error) return c.json({ detail: error.message }, 500);
    return c.json({ key, value: unwrapScalarRpc(data) });
  });

  app.put("/api/v1/config/:key", async (c) => {
    const key = c.req.param("key");
    let body: { value?: unknown };
    try {
      body = (await c.req.json()) as { value?: unknown };
    } catch {
      return c.json({ detail: "Invalid JSON body" }, 400);
    }
    const value = typeof body.value === "string" ? body.value : String(body.value ?? "");
    const { error } = await ctx.supabase.rpc("cerefox_set_config", {
      p_key: key,
      p_value: value,
    });
    if (error) return c.json({ detail: error.message }, 500);
    return c.json({ key, value });
  });
}
