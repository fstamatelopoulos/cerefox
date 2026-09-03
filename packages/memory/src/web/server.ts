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

import {
  apiAuth,
  containerGateWarning,
  isContainerised,
  isLoopbackAddress,
} from "./auth.ts";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { logger } from "hono/logger";

import { buildWebContext, type WebContext } from "./context.ts";
import { registerAuditUsageRoutes } from "./routes/audit-usage.ts";
import { registerConfigRoutes } from "./routes/config.ts";
import { registerDiscoveryRoutes } from "./routes/discovery.ts";
import { registerDocumentReadRoutes } from "./routes/documents-read.ts";
import { registerDocumentWriteRoutes } from "./routes/documents-write.ts";
import { registerIngestRoutes } from "./routes/ingest.ts";
import { registerMetaRoutes } from "./routes/meta.ts";
import { registerPostgrestProxy } from "./routes/postgrest-proxy.ts";
import { registerPreferencesRoutes } from "./routes/preferences.ts";
import { registerProjectsRoutes } from "./routes/projects.ts";
import {
  ROOT_REDIRECT_HTML,
  resolveSpaDist,
  resolveStaticDir,
} from "./static.ts";
import { PKG_VERSION } from "../meta.ts";
import { EF_VERSION } from "../../../../_shared/ef-meta/index.ts";
import { localTimestamp } from "../../../../_shared/cli-core/index.ts";
import { loadSettings } from "../../../../_shared/config/index.ts";
import {
  aggregatorUrlFor,
  checkServerCompatibility,
} from "../../../../_shared/compatibility/index.ts";

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

  // (0) Request logger — writes one line per request, matching the UX
  // FastAPI/uvicorn provided on the Python web server. Each line is prefixed
  // with a local-time timestamp so the daemon log (~/.cerefox/web.log) is
  // readable after the fact. Skipped in test runs (NODE_ENV=test) so smoke
  // tests stay quiet.
  if (process.env.NODE_ENV !== "test") {
    app.use(logger((message, ...rest) => console.log(`${localTimestamp()}  ${message}`, ...rest)));
  }

  // Auth gate (#229) — BEFORE every route it protects, including the 503
  // stubs below, so an unconfigured server does not leak its state either.
  // Covers both HTTP surfaces on this port: `/api/v1/*` and the PostgREST
  // passthrough at `/rest/v1/*` (live on Cerefox Local). Gating only the first
  // would move the hole rather than close it.
  //
  // No exception for `/api/v1/version`: verified that no local caller is
  // affected (the CLI talks to the Supabase Data API directly and never to
  // this server), so the only caller a gate touches is a remote one — which is
  // the caller this exists to stop.
  app.use("/api/v1/*", apiAuth());
  app.use("/rest/v1/*", apiAuth());

  // (1) JSON API — registered first.
  registerMetaRoutes(app, ctx);
  // Machine-local UI prefs (file-based; no DB) — works without Supabase.
  registerPreferencesRoutes(app);
  if (ctx) {
    registerDiscoveryRoutes(app, ctx);
    registerDocumentReadRoutes(app, ctx);
    registerDocumentWriteRoutes(app, ctx);
    registerProjectsRoutes(app, ctx);
    registerConfigRoutes(app, ctx);
    registerAuditUsageRoutes(app, ctx);
    // v0.7 (Part 25F): ingest endpoints now require a real ctx to call
    // the in-process IngestionPipeline. They used to be 503 stubs (v0.6
    // Part 24H) registered unconditionally; the swap moves them inside
    // the ctx-gated block. ctx===null branches still 503 for the same
    // graceful-fallback shape.
    registerIngestRoutes(app, ctx);
  } else {
    // Stub DB-touching endpoints with 503 so the frontend gets a clear
    // signal during dev / CI runs without .env.
    app.all("/api/v1/search", (c) =>
      c.json({ detail: "Supabase not configured" }, 503),
    );
    app.all("/api/v1/dashboard", (c) =>
      c.json({ detail: "Supabase not configured" }, 503),
    );
    const ingest503 = () =>
      Response.json({ success: false, error: "Supabase not configured" }, { status: 503 });
    app.post("/api/v1/ingest", ingest503);
    app.post("/api/v1/ingest/file", ingest503);
    app.post("/api/v1/documents/:document_id/upload", ingest503);
  }

  // (1b) Local self-hosted gateway: proxy /rest/v1/* → PostgREST. Self-gated by
  // CEREFOX_POSTGREST_UPSTREAM (set only in the local image) — inert in cloud.
  registerPostgrestProxy(app);

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

  // (3) + (4) + (5) SPA — only when a usable dist is available.
  const spaDist = resolveSpaDist();
  if (spaDist) {
    // (3) Vite hashed JS/CSS — explicit prefix BEFORE the public-asset
    //     middleware so they always go through the assets directory.
    app.use(
      "/app/assets/*",
      serveStatic({
        root: spaDist,
        rewriteRequestPath: (path) => path.replace(/^\/app/, ""),
      }),
    );

    // (4) SPA public/ assets at the SPA root (favicon, icons, anything Vite
    //     copies from frontend/public/). Hono's serveStatic calls next() on
    //     a 404, so React-router paths like /app/projects fall through to
    //     the catch-all below and correctly return index.html.
    app.use(
      "/app/*",
      serveStatic({
        root: spaDist,
        rewriteRequestPath: (path) => path.replace(/^\/app/, "") || "/",
      }),
    );

    // (5) SPA catch-all for client-side routing.
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

/**
 * Refuse to bind when the deployed server is below the client's minimum
 * (iter-26 Part 26C). Only blocks on a *confirmed* below-min server — a
 * missing access token or unreachable aggregator boots normally (tolerant-boot
 * principle; the per-route 503s handle a missing backend). Throws a
 * CompatibilityError the `cerefox web` command renders + exits on.
 */
export class CompatibilityError extends Error {}

async function assertServerCompatible(): Promise<void> {
  const settings = loadSettings();
  if (!settings.supabaseUrl || !settings.accessToken) return; // tolerant boot
  let compat;
  try {
    compat = await checkServerCompatibility({
      aggregatorUrl: aggregatorUrlFor(settings.supabaseUrl),
      bearer: settings.accessToken,
      // EF version this package bundles, not the npm package version — see the
      // note in checks.ts. (Web boot only refuses on `below-min`, which uses
      // `min`, so this is for correctness/consistency rather than behavior.)
      bundledEf: EF_VERSION,
    });
  } catch {
    return; // probe failure → tolerant boot
  }
  if (!compat.blocking) return;
  const parts: string[] = [];
  if (compat.schema.level === "below-min") {
    parts.push(
      `  • schema v${compat.schema.deployed} is below the required v${compat.schema.min}`,
    );
  }
  if (compat.edgeFunctions.level === "below-min") {
    parts.push(
      `  • Edge Functions v${compat.edgeFunctions.deployed} are below the required v${compat.edgeFunctions.min}`,
    );
  }
  throw new CompatibilityError(
    `Refusing to start: the deployed Cerefox server is incompatible with this client (v${PKG_VERSION}).\n` +
      parts.join("\n") +
      `\n\nRedeploy your server:  cerefox server deploy\n` +
      `(or downgrade the client to match the deployed server).`,
  );
}

export async function buildWebServer(
  options: BuildWebServerOptions = {},
): Promise<WebServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8000;

  await assertServerCompatible();

  // The one case the loopback design cannot cover on its own: a non-loopback
  // bind with no key configured is a fully open API on a reachable interface.
  // The gate allows an unconfigured server through (so upgrades never break a
  // working install), which makes silence here the dangerous default — say it
  // out loud at the moment the decision is made.
  // The container misconfiguration that shipped in v1.12.0 and broke every
  // Cerefox Local install. Checked before the bind warning because it is the
  // more specific of the two.
  const containerWarning = containerGateWarning();
  if (containerWarning) console.warn(containerWarning);

  // Deliberately NOT warned inside a container (#237). A container must bind
  // 0.0.0.0 internally — its own loopback is not the host's, so a narrower
  // bind would make the published port unreachable. The boundary that actually
  // matters is the PUBLISH address (`-p 127.0.0.1:8010:8000`), which this
  // process cannot see. Warning here fired on every normal Cerefox Local boot,
  // describing a correct and safe setup in alarming terms and recommending a
  // command that does not apply there. A false alarm on every boot trains
  // people to ignore real ones. `containerGateWarning()` above still covers
  // the container configuration that IS broken.
  if (
    !isContainerised() &&
    !isLoopbackAddress(host) &&
    !(process.env.CEREFOX_API_KEY ?? "").trim()
  ) {
    console.warn(
      `\n⚠  Binding ${host} with NO API key configured.\n` +
        `   Every read, write, delete and purge on this server is reachable by\n` +
        `   anything that can connect to port ${port}, with no credential.\n` +
        `   Mint one:  cerefox api-key generate\n`,
    );
  }

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
