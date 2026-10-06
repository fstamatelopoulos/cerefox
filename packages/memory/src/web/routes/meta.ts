/**
 * Meta endpoints: /version, /docs, /docs/{path}, /schema-version.
 *
 * Python source: `src/cerefox/api/routes_api.py` lines 68-161.
 *
 * /version is reachable without DB credentials (mirrors Python's
 * dependency-free `api_version`). The other three need either bundled
 * docs (filesystem) or the Supabase RPC `cerefox_schema_version`.
 */

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";

import { bundledSchemaVersion } from "../../../../../_shared/server-assets/index.ts";
import { PKG_VERSION } from "../../meta.ts";
import { newerRelease, readCache, updateCheckDisabled, upgradeCommand } from "../../update-check.ts";
import type { WebContext } from "../context.ts";
import { listBundledDocs, readDoc, readOpenApiDocument } from "../docs.ts";
import {
  classifyCompat,
  COMPATIBILITY,
} from "../../../../../_shared/compatibility/index.ts";

/**
 * The commit of the RUNNING code: `CEREFOX_GIT_COMMIT` if set, else git asked
 * about the directory this module lives in. It used to ask about the process's
 * cwd, so a daemon started from inside some checkout reported THAT checkout's
 * HEAD — production started from the repo showed whatever the repo was on,
 * not the release it runs. An installed package is not a git work tree, so it
 * now reports null; a source checkout reports its own commit.
 */
export function resolveGitCommitShort(dir: string = dirname(fileURLToPath(import.meta.url))): string | null {
  const env = process.env.CEREFOX_GIT_COMMIT;
  if (env) return env.slice(0, 7);
  try {
    const out = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: dir,
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

const VERSION_INFO = {
  version: PKG_VERSION,
  git_commit_short: resolveGitCommitShort(),
  build_date: process.env.CEREFOX_BUILD_DATE ?? null,
};

export function registerMetaRoutes(app: Hono, ctx: WebContext | null): void {
  // `env_label` is read per-request, not folded into the module-level
  // VERSION_INFO: the label comes from `.env`, which is loaded during server
  // startup, and this module is imported before that happens.
  //
  // Purely cosmetic, and deliberately so — it exists to stop someone acting on
  // a staging tab believing it is production. Empty/whitespace is treated as
  // unset so a stray `CEREFOX_ENV_LABEL=` never paints a blank badge.
  //
  // `latest` / `update_command` (#323) come from the update-check cache the
  // server refreshes daily; the request itself never touches the network.
  app.get("/api/v1/version", (c) => {
    const label = (process.env.CEREFOX_ENV_LABEL ?? "").trim();
    const latest = updateCheckDisabled() ? null : (readCache()?.latest ?? null);
    return c.json({
      ...VERSION_INFO,
      env_label: label.length > 0 ? label : null,
      latest,
      update_command: newerRelease(latest) ? upgradeCommand() : null,
    });
  });

  app.get("/api/v1/docs", (c) => c.json(listBundledDocs()));

  app.get("/api/v1/docs/:path{.+}", (c) => {
    const docPath = c.req.param("path");
    const content = readDoc(docPath);
    if (content === null) {
      return c.json({ detail: `Doc not found: ${docPath}` }, 404);
    }
    return c.body(content, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
    });
  });

  // This API's own description (#303). Discoverable without knowing the path:
  // every /api/v1 response carries `Link: </api/v1/openapi.json>;
  // rel="service-desc"` (RFC 8631), set in server.ts.
  app.get("/api/v1/openapi.json", (c) => {
    const doc = readOpenApiDocument();
    if (doc === null) {
      return c.json({ detail: "The OpenAPI document is not bundled with this build." }, 404);
    }
    return c.body(doc, 200, { "Content-Type": "application/json; charset=utf-8" });
  });

  app.get("/api/v1/schema-version", async (c) => {
    // The same reader `doctor` and the MCP server use. This route used to
    // guess the path relative to its own source file, which is wrong once the
    // code is bundled into dist/bin/cerefox.js: every published install
    // answered `bundled: null`, so the UI's redeploy banner could never fire.
    const bundled = bundledSchemaVersion();

    let deployed: string | null = null;
    if (ctx) {
      try {
        const { data, error } = await ctx.supabase.rpc("cerefox_schema_version");
        if (!error && data) {
          if (typeof data === "string") deployed = data;
          else if (Array.isArray(data) && data.length > 0) {
            const first = data[0];
            if (typeof first === "string") deployed = first;
            else if (first && typeof first === "object") {
              for (const key of [
                "cerefox_schema_version",
                "version",
                "result",
              ] as const) {
                const v = (first as Record<string, unknown>)[key];
                if (typeof v === "string") {
                  deployed = v;
                  break;
                }
              }
            }
          }
        }
      } catch {
        // Legacy deployments may not have the RPC — treat as "unknown".
      }
    }

    // iter-26 Part 26C: two-tier compatibility level so the banner can
    // distinguish a *blocking* outdated schema (below the client minimum,
    // red) from a *nudge* (older than bundled but still ≥ minimum, yellow).
    const level = classifyCompat(deployed, COMPATIBILITY.minSchema, bundled);
    // True only when the deployed schema is OLDER than this client's: the one
    // direction that needs `cerefox server deploy`, and the only one the web
    // banner's text ("ships a newer schema than what is deployed") describes.
    // It was `bundled !== deployed`, which would also fire for an older client
    // pointed at a newer server. That never showed, because `bundled` was
    // always null until the shared reader (#301).
    const mismatch = level === "above-min-but-old";
    return c.json({
      bundled,
      deployed,
      mismatch,
      level,
      min: COMPATIBILITY.minSchema,
    });
  });
}
