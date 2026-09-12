/**
 * Every `/api/v1` route is documented, and every documented route exists.
 *
 * `docs/guides/api.md` is the reference for callers who use the HTTP API
 * instead of MCP or the CLI — an embedder of Cerefox Local, say, wiring the
 * endpoints to its own tools. That audience cannot discover an endpoint by
 * reading the route source, so the table being complete is the whole value of
 * the document.
 *
 * It was not complete. Five registered routes were missing when this test was
 * written: the two `/preferences` routes, the two `/docs` routes, and the
 * version archive/unarchive endpoint. Nobody did anything wrong — the table is
 * hand-maintained, and a hand-maintained list that has to match another list
 * drifts. That single shape has produced the tool-count drift, the missing RLS
 * table and the Edge Function bundle allow-list in this project already.
 *
 * So the list is DERIVED from the route registrations, and checked BOTH ways:
 *
 *   - registered but undocumented → a caller cannot find out the endpoint
 *     exists;
 *   - documented but unregistered → worse, because the document sends them at
 *     something that will 404, which is how a removed or renamed endpoint
 *     leaves a promise behind.
 *
 * Scope, stated so nobody expects more than it gives: this checks that the
 * PATHS agree. It cannot tell whether the description, the parameters or the
 * response shape are still true. Those stay a discipline (CLAUDE.md carries
 * the rule), and #270 tracks the machine-readable spec that would close it.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const ROUTES_DIR = join(REPO_ROOT, "packages", "memory", "src", "web", "routes");
const SERVER_TS = join(REPO_ROOT, "packages", "memory", "src", "web", "server.ts");
const API_DOC = join(REPO_ROOT, "docs", "guides", "api.md");

const PREFIX = "/api/v1";

/**
 * One comparable form for both sides.
 *
 * The code writes Hono params (`:document_id`, and `:path{.+}` for a
 * wildcard); the document writes `{id}` placeholders and sometimes an
 * illustrative query string. Neither spelling is the point, so both collapse
 * to `*` and query strings are dropped: this test is about which endpoints
 * exist, not about what the parameters are called.
 */
function normalise(method: string, path: string): string {
  let p = path.split("?")[0]!.trim();
  if (p.startsWith(PREFIX)) p = p.slice(PREFIX.length) || "/";
  p = p.replace(/:\w+\{[^}]*\}/g, "*"); // :path{.+}
  p = p.replace(/:\w+/g, "*"); // :document_id
  p = p.replace(/\{[^}]*\}/g, "*"); // {id}
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return `${method.toUpperCase()} ${p}`;
}

function registeredRoutes(): Map<string, string> {
  const files = readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(ROUTES_DIR, f));
  if (existsSync(SERVER_TS)) files.push(SERVER_TS);

  const found = new Map<string, string>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    // Only `/api/v1` paths: the same call shape is used for header deletion
    // (`.delete("host")`) and for the SPA routes, which are not the API.
    const re = /\.(get|post|put|delete)\(\s*"(\/api\/v1[^"]*)"/g;
    for (const m of source.matchAll(re)) {
      found.set(normalise(m[1]!, m[2]!), file.replace(REPO_ROOT + "/", ""));
    }
  }
  return found;
}

function documentedRoutes(): Set<string> {
  const doc = readFileSync(API_DOC, "utf8");
  const out = new Set<string>();
  for (const line of doc.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue; // the endpoint table only
    for (const m of line.matchAll(/`(GET|POST|PUT|DELETE)\s+([^`]+)`/g)) {
      out.add(normalise(m[1]!, m[2]!));
    }
  }
  return out;
}

describe("docs/guides/api.md lists exactly the routes the server registers", () => {
  const registered = registeredRoutes();
  const documented = documentedRoutes();

  test("the extractor still finds the routes it is meant to police", () => {
    // Both halves must find a plausible population, or the comparisons below
    // pass vacuously. Two static checks in this project once did exactly that.
    expect(registered.size).toBeGreaterThanOrEqual(30);
    expect(documented.size).toBeGreaterThanOrEqual(30);
    // A couple of anchors, so a regex that silently stops matching is caught.
    expect([...registered.keys()]).toContain("GET /search");
    expect([...registered.keys()]).toContain("POST /ingest");
  });

  test("every registered route is documented", () => {
    const missing = [...registered.entries()]
      .filter(([route]) => !documented.has(route))
      .map(([route, file]) => `${route}   (registered in ${file})`);
    expect(missing).toEqual([]);
  });

  test("every documented route exists", () => {
    const stale = [...documented].filter((route) => !registered.has(route));
    expect(stale).toEqual([]);
  });

  test("the check fires on both kinds of drift", () => {
    // A guard that cannot fail is not a guard, and the population assertions
    // above only prove the extractors ran. These prove the COMPARISON bites,
    // using the two shapes it exists to catch.
    const routes = new Set(["GET /search", "POST /ingest"]);
    const docs = new Set(["GET /search", "DELETE /documents/*"]);

    const undocumented = [...routes].filter((r) => !docs.has(r));
    expect(undocumented).toEqual(["POST /ingest"]);

    const unregistered = [...docs].filter((r) => !routes.has(r));
    expect(unregistered).toEqual(["DELETE /documents/*"]);
  });

  test("normalisation makes the two spellings comparable", () => {
    // The doc and the code genuinely disagree on spelling; that must not read
    // as drift. Equally, normalisation must not flatten distinct paths.
    expect(normalise("get", "/api/v1/documents/:document_id")).toBe(
      normalise("GET", "/documents/{id}"),
    );
    expect(normalise("get", "/api/v1/docs/:path{.+}")).toBe(normalise("GET", "/docs/{path}"));
    expect(normalise("GET", "/search?q=…")).toBe(normalise("get", "/api/v1/search"));
    expect(normalise("GET", "/documents/{id}")).not.toBe(
      normalise("GET", "/documents/{id}/chunks"),
    );
  });
});
