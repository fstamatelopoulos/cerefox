/**
 * Static-file resolution for the Cerefox web server.
 *
 * Mirrors the two-candidate resolver in `src/cerefox/api/app.py`
 * (`_resolve_spa_dist`, `_resolve_static_dir`) so the TS server finds the
 * same files the Python server would find in the same checkout state.
 *
 * SPA candidates, tried in order:
 *   (1) Production bundled — `<bin-dir>/../frontend/`. When the bundled
 *       `dist/bin/cerefox.js` runs, `import.meta.url` is the bundled
 *       binary and `../frontend/` = `dist/frontend/`. Only matches in the
 *       installed/built bin; in source mode this path
 *       (`packages/memory/src/frontend`) doesn't exist, so it's skipped.
 *   (2) Source / dev — `<repo>/frontend/dist/`. When `bun packages/memory/
 *       src/bin/cerefox.ts web` runs from source, the module's
 *       `import.meta.url` is `<repo>/packages/memory/src/web/static.ts` and
 *       `../../../../frontend/dist/` reaches the repo's fresh frontend
 *       build.
 *   (3) Stale bundle fallback — `<package>/dist/frontend/`
 *       (`packages/memory/dist/frontend`). A leftover from a prior
 *       `bun run bundle-frontend`. Tried LAST (iter-26 Part 26K / Fotis-5):
 *       in source mode this used to win over (2), so a stale bundled copy
 *       shadowed fresh `frontend/dist` edits and confused dev (same class
 *       of bug as the v0.7.1 favicon issue). The npm publish path is
 *       unaffected — there `here` = `dist/bin` and (1) matches first.
 *
 * Returns null when no candidate exists; the web UI is then unreachable
 * but the JSON API still serves.
 */

import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function moduleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function isUsableSpaDir(dir: string): boolean {
  return (
    existsSync(dir) &&
    statSync(dir).isDirectory() &&
    existsSync(join(dir, "index.html"))
  );
}

export function resolveSpaDist(): string | null {
  const here = moduleDir();
  const candidates = [
    join(here, "..", "frontend"), // (1) bundled bin → dist/frontend
    join(here, "..", "..", "..", "..", "frontend", "dist"), // (2) repo source build (fresh)
    join(here, "..", "..", "dist", "frontend"), // (3) stale package bundle (last resort)
  ];
  for (const c of candidates) {
    if (isUsableSpaDir(c)) return c;
  }
  return null;
}

export function resolveStaticDir(): string | null {
  const here = moduleDir();
  const candidates = [
    join(here, "..", "static"),
    join(here, "..", "..", "..", "..", "web", "static"),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isDirectory()) return c;
  }
  return null;
}

export const ROOT_REDIRECT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="2;url=/app/">
  <title>Cerefox</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex; justify-content: center; align-items: center;
      min-height: 100vh; margin: 0;
      background: #f8f9fa; color: #333;
    }
    .card {
      text-align: center; padding: 3rem; background: #fff;
      border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      max-width: 420px;
    }
    a { color: #228be6; text-decoration: none; font-weight: 600; }
    a:hover { text-decoration: underline; }
    .dimmed { color: #868e96; font-size: 0.85rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Cerefox</h2>
    <p>The web interface has moved to <a href="/app/">/app/</a></p>
    <p>Redirecting automatically...</p>
    <p class="dimmed">
      API endpoints are available at <code>/api/v1/</code><br>
      MCP access via Edge Functions (see docs)
    </p>
  </div>
</body>
</html>`;
