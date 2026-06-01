/**
 * Web UI preferences — durable, machine-local settings stored in
 * `~/.cerefox/web-prefs.json` (the user-state dir). Currently just the
 * color-scheme choice.
 *
 *   GET /api/v1/preferences        → { theme }
 *   PUT /api/v1/preferences        → { theme }   (body: { theme })
 *
 * File-based and Supabase-independent, so it registers unconditionally
 * (works even when the DB isn't configured). Mantine's own localStorage
 * is the no-flash fast path on first paint; this file is the durable
 * source reconciled on mount, surviving a browser cache clear.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Hono } from "hono";

import { userStateDir } from "../../../../../_shared/config/index.ts";

type Theme = "auto" | "light" | "dark";

function isTheme(v: unknown): v is Theme {
  return v === "auto" || v === "light" || v === "dark";
}

function prefsFile(): string {
  return join(userStateDir(), "web-prefs.json");
}

function readPrefs(): { theme: Theme } {
  try {
    const raw = JSON.parse(readFileSync(prefsFile(), "utf8")) as Record<string, unknown>;
    if (isTheme(raw.theme)) return { theme: raw.theme };
  } catch {
    /* missing or invalid file → fall through to default */
  }
  return { theme: "auto" };
}

export function registerPreferencesRoutes(app: Hono): void {
  app.get("/api/v1/preferences", (c) => c.json(readPrefs()));

  app.put("/api/v1/preferences", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { theme?: unknown };
    if (!isTheme(body.theme)) {
      return c.json({ detail: "theme must be one of: auto, light, dark" }, 400);
    }
    const next = { ...readPrefs(), theme: body.theme };
    try {
      const dir = userStateDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(prefsFile(), `${JSON.stringify(next, null, 2)}\n`);
    } catch (err) {
      return c.json({ detail: err instanceof Error ? err.message : String(err) }, 500);
    }
    return c.json(next);
  });
}
