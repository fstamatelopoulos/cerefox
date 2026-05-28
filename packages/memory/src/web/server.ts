/**
 * Hono web-server factory for `cerefox web`.
 *
 * Replaces the FastAPI app in `src/cerefox/api/app.py`. Same endpoints,
 * same response shapes (enforced by `_shared/schemas/` zod schemas in
 * Part 24C onward, and verified by the parity-snapshot tests in Part 24I).
 *
 * Middleware order (locked decision R5, plan.md § Iteration 24):
 *   1. /api/v1/*           — JSON API routes (registered first so they
 *                            shadow any later catch-alls).
 *   2. /static/*           — repo logo/favicon (serveStatic).
 *   3. /app/assets/*       — Vite hashed JS/CSS (serveStatic). MUST be
 *                            registered before the /app/* catch-all so
 *                            it wins for asset paths.
 *   4. /app/*              — SPA catch-all returning index.html.
 *   5. /                   — HTML redirect page pointing at /app/.
 *
 * Verification for (3) vs (4): GET /app/assets/index-abc123.js must
 * return Content-Type `application/javascript`, NOT `text/html`.
 *
 * Runtime: `serve` from `@hono/node-server` works on both Node and Bun
 * (Bun ships a compatible `node:http`). Source-mode boot via
 * `bun packages/memory/src/bin/cerefox.ts web` and built-mode boot via
 * `node packages/memory/dist/bin/cerefox.js web` both end up here.
 */

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";

import { buildWebContext, type WebContext } from "./context.ts";
import { registerDiscoveryRoutes } from "./routes/discovery.ts";
import { registerDocumentReadRoutes } from "./routes/documents-read.ts";
import { registerDocumentWriteRoutes } from "./routes/documents-write.ts";
import { registerMetaRoutes } from "./routes/meta.ts";
import { registerProjectsRoutes } from "./routes/projects.ts";
import {
  ROOT_REDIRECT_HTML,
  resolveSpaDist,
  resolveStaticDir,
} from "./static.ts";

export interface BuildWebServerOptions {
  host?: string;
  port?: number;
}

export interface WebServerHandle {
  host: string;
  port: number;
  close: () => Promise<void>;
}

export function buildApp(ctx: WebContext | null = buildWebContext()): Hono {
  const app = new Hono();

  // (1) JSON API — registered first.
  registerMetaRoutes(app, ctx);
  if (ctx) {
    registerDiscoveryRoutes(app, ctx);
    registerDocumentReadRoutes(app, ctx);
    registerDocumentWriteRoutes(app, ctx);
    registerProjectsRoutes(app, ctx);
  } else {
    // Stub DB-touching endpoints with 503 so the frontend gets a clear
    // signal during dev / CI runs without .env.
    app.all("/api/v1/search", (c) =>
      c.json({ detail: "Supabase not configured" }, 503),
    );
    app.all("/api/v1/dashboard", (c) =>
      c.json({ detail: "Supabase not configured" }, 503),
    );
  }

  // (2) Repo /static — logo/favicon.
  const staticDir = resolveStaticDir();
  if (staticDir) {
    app.use(
      "/static/*",
      serveStatic({
        root: staticDir,
        rewriteRequestPath: (path) => path.replace(/^\/static/, ""),
      }),
    );
  }

  // (3) + (4) SPA — only when a usable dist is available.
  const spaDist = resolveSpaDist();
  if (spaDist) {
    // (3) Vite assets — explicit prefix BEFORE the catch-all.
    app.use(
      "/app/assets/*",
      serveStatic({
        root: spaDist,
        rewriteRequestPath: (path) => path.replace(/^\/app/, ""),
      }),
    );

    // (4) SPA catch-all for client-side routing.
    const indexPath = join(spaDist, "index.html");
    if (existsSync(indexPath)) {
      const indexHtml = readFileSync(indexPath, "utf8");
      app.get("/app/*", (c) => c.html(indexHtml));
    }
  }

  // (5) Root redirect.
  app.get("/", (c) => c.html(ROOT_REDIRECT_HTML));

  return app;
}

export async function buildWebServer(
  options: BuildWebServerOptions = {},
): Promise<WebServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8000;
  const app = buildApp();

  const server = serve({ fetch: app.fetch, hostname: host, port });

  return {
    host,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
