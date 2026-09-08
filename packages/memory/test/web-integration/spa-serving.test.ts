/**
 * How the web server hands the SPA to a browser (#252).
 *
 * Both regressions here were found on a live install after an in-place
 * `cerefox self-update`, and both were invisible in the access log:
 *
 *  1. `index.html` was read ONCE at startup for the SPA catch-all, while
 *     `/app/` itself came from `serveStatic`, i.e. from disk. An upgrade
 *     under a running daemon therefore served the NEW shell at the root and
 *     the PRE-upgrade shell on every deep route, pointing the browser at a
 *     hashed bundle the upgrade had deleted.
 *  2. A missing `/app/assets/*` fell through to that catch-all and was
 *     answered `200 text/html`. The browser asked for a script, got HTML,
 *     ran nothing, and showed a blank page — logged as a 200.
 *
 * The suite touches no store: it spawns the server, reads the SPA it is
 * serving, and rewrites its own build artifact, restoring it afterwards.
 */

import { afterAll, beforeAll, describe, expect } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LIVE_TEST_BUDGET_MS, liveTest } from "../_live-test.ts";

import { spawnWebServer, type SpawnedServer } from "./_helpers.js";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");

/** The same candidates, in the same order, as `resolveSpaDist()`. */
function resolveIndexHtml(): string | null {
  for (const dir of [join(PKG_ROOT, "dist", "frontend"), join(REPO_ROOT, "frontend", "dist")]) {
    const candidate = join(dir, "index.html");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

describe("SPA serving after an in-place upgrade (#252)", () => {
  let server: SpawnedServer | null = null;
  const indexPath = resolveIndexHtml();
  let original: string | null = null;

  /** Restore the artifact even if the runner is interrupted mid-test. */
  const restore = () => {
    if (indexPath && original !== null) {
      try {
        writeFileSync(indexPath, original);
      } catch {
        /* best effort */
      }
    }
  };

  beforeAll(async () => {
    if (!indexPath) return;
    original = readFileSync(indexPath, "utf8");
    for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, restore);
    process.once("exit", restore);
    server = await spawnWebServer();
  }, LIVE_TEST_BUDGET_MS);

  afterAll(async () => {
    // Restore the build artifact before anything else, so a failure mid-test
    // cannot leave a marker in a bundle someone later ships.
    restore();
    if (server) await server.stop();
  }, LIVE_TEST_BUDGET_MS);

  liveTest("the root and a deep route serve the SAME shell", async () => {
    if (!server || !indexPath) return;
    const bundleOf = async (path: string) => {
      const resp = await fetch(`${server!.base}${path}`);
      expect(resp.status).toBe(200);
      const html = await resp.text();
      return /assets\/index-[A-Za-z0-9_-]+\.js/.exec(html)?.[0] ?? html.slice(0, 80);
    };
    // The failure mode was these two disagreeing: root from disk, deep route
    // from a copy read at startup.
    expect(await bundleOf("/app/trash")).toBe(await bundleOf("/app/"));
    expect(await bundleOf("/app/document/00000000-0000-0000-0000-000000000000")).toBe(
      await bundleOf("/app/"),
    );
  });

  liveTest("a rewritten index.html is picked up without restarting", async () => {
    if (!server || !indexPath || original === null) return;
    const marker = `<!-- upgraded ${Date.now()} -->`;
    // This writes into the SHIPPED build artifact, so it is restored in a
    // `finally` here (not only in afterAll, which a failed assertion would
    // reach but a killed runner would not) and by the signal handlers
    // registered above. A marker left inside dist/frontend/index.html would
    // otherwise ride along into a published package.
    try {
      writeFileSync(indexPath, original.replace("</head>", `${marker}</head>`));

      // This is the upgrade, simulated: the file changed under a running server.
      const deep = await (await fetch(`${server.base}/app/settings`)).text();
      expect(deep).toContain(marker);
      const root = await (await fetch(`${server.base}/app/`)).text();
      expect(root).toContain(marker);
    } finally {
      writeFileSync(indexPath, original);
    }
    const afterRestore = await (await fetch(`${server.base}/app/settings`)).text();
    expect(afterRestore).not.toContain(marker);
  });

  liveTest("a missing hashed asset is a 404, not the SPA shell with a 200", async () => {
    if (!server) return;
    // The exact shape of the blank page: the browser requests a bundle that no
    // longer exists and must be told so, not handed HTML.
    const resp = await fetch(`${server.base}/app/assets/index-DoesNotExist.js`);
    expect(resp.status).toBe(404);
    expect(resp.headers.get("content-type") ?? "").not.toContain("text/html");
    const body = await resp.text();
    expect(body).not.toContain("<html");
    expect(body).not.toContain("<div id=\"root\"");
  });

  liveTest("a real asset is still served, with a JavaScript content type", async () => {
    if (!server || !indexPath) return;
    // The 404 above must not have broken the assets route itself.
    const html = await (await fetch(`${server.base}/app/`)).text();
    const bundle = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(html)?.[0];
    if (!bundle) return;
    const resp = await fetch(`${server.base}/app/${bundle}`);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type") ?? "").toContain("javascript");
  });

  liveTest("a client-side route still gets the shell, so deep links work", async () => {
    if (!server) return;
    const resp = await fetch(`${server.base}/app/projects/abc/documents`);
    expect(resp.status).toBe(200);
    expect(await resp.text()).toContain('<div id="root">');
  });
});
