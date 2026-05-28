/**
 * Meta endpoints for the Cerefox web server.
 *
 * Part 24A scope: only `/version`. The rest of the meta routes
 * (`/docs`, `/docs/{path}`, `/schema-version`) land in Part 24C alongside
 * `_shared/schemas/`.
 *
 * The Python equivalent lives at `src/cerefox/api/routes_api.py`
 * around line 68 (`api_version`) — see also the `_resolve_git_commit_short`
 * helper at line 40 for the matching git-shortcut behaviour.
 */

import { execFileSync } from "node:child_process";
import { Hono } from "hono";

import { PKG_VERSION } from "../../meta.ts";

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

export function registerMetaRoutes(app: Hono): void {
  app.get("/api/v1/version", (c) => c.json(VERSION_INFO));
}
