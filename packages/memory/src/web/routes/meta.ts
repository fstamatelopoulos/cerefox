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
import { Hono } from "hono";

import { PKG_VERSION } from "../../meta.ts";
import type { WebContext } from "../context.ts";
import { listBundledDocs, readDoc } from "../docs.ts";
import {
  classifyCompat,
  COMPATIBILITY,
} from "../../../../../_shared/compatibility/index.ts";

function resolveGitCommitShort(): string | null {
  const env = process.env.CEREFOX_GIT_COMMIT;
  if (env) return env.slice(0, 7);
  try {
    const out = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
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

const SCHEMA_VERSION_RE = /^--\s*@version:\s*(\S+)/m;

export function registerMetaRoutes(app: Hono, ctx: WebContext | null): void {
  app.get("/api/v1/version", (c) => c.json(VERSION_INFO));

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

  app.get("/api/v1/schema-version", async (c) => {
    // bundled: read the @version marker from the in-package schema.sql
    let bundled: string | null = null;
    try {
      const { readFileSync, existsSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const { dirname, join } = await import("node:path");
      const here = dirname(fileURLToPath(import.meta.url));
      // Resolver mirrors docs.ts: look under <pkg>/db/schema.sql, then the repo's
      // src/cerefox/db/schema.sql as a source-mode fallback.
      const candidates = [
        join(here, "..", "..", "..", "db", "schema.sql"),
        join(here, "..", "..", "..", "..", "..", "src", "cerefox", "db", "schema.sql"),
      ];
      for (const path of candidates) {
        if (existsSync(path)) {
          const sql = readFileSync(path, "utf8");
          const match = sql.match(SCHEMA_VERSION_RE);
          bundled = match ? match[1] : null;
          break;
        }
      }
    } catch {
      bundled = null;
    }

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

    const mismatch = Boolean(bundled && deployed && bundled !== deployed);
    // iter-26 Part 26C: two-tier compatibility level so the banner can
    // distinguish a *blocking* outdated schema (below the client minimum,
    // red) from a *nudge* (older than bundled but still ≥ minimum, yellow).
    const level = classifyCompat(deployed, COMPATIBILITY.minSchema, bundled);
    return c.json({
      bundled,
      deployed,
      mismatch,
      level,
      min: COMPATIBILITY.minSchema,
    });
  });
}
