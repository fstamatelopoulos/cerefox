/**
 * `docs/api/openapi.json` is generated, current, and complete about its gaps.
 *
 * The spec is built from three sources that are each already kept honest
 * elsewhere: the route registrations, the endpoint table in
 * `docs/guides/api.md`, and the zod schemas in `_shared/schemas/`. This file
 * checks the fourth thing — that the checked-in artifact still matches what
 * those three produce — plus two properties the generator cannot enforce about
 * itself.
 *
 * Why a committed generated file at all, rather than generating on demand: the
 * consumers are outside this repo (an embedder generating a client or a tool
 * set), and asking them to run a bun script first is worse than committing 60KB
 * of JSON. The cost is that it can go stale, which is exactly what this closes.
 *
 * Whether the spec is TRUE — whether the server really returns those shapes —
 * is a different question and cannot be answered offline. That lives in
 * `packages/memory/test/web-integration/api-schema-truth.test.ts`, against a
 * running server. Nothing here would catch a schema that drifted from reality,
 * and it is worth being clear about that.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";

import {
  OUT_FILE,
  ROUTE_SCHEMAS,
  buildSpec,
  descriptionsFromGuide,
  registeredRoutes,
  specJson,
} from "../openapi/index.ts";

const PREFIX = "/api/v1";

/** The same normalisation the generator and the route-doc guard both use. */
function normalise(method: string, path: string): string {
  let p = path.split("?")[0]!.trim();
  if (p.startsWith(PREFIX)) p = p.slice(PREFIX.length) || "/";
  p = p.replace(/\{[^}]*\}/g, "*");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return `${method.toUpperCase()} ${p}`;
}

describe("the OpenAPI document for /api/v1", () => {
  test("the checked-in file is what the generator produces", () => {
    expect(existsSync(OUT_FILE)).toBe(true);
    const onDisk = readFileSync(OUT_FILE, "utf8");
    // A mismatch means a route, a summary in api.md, or a zod schema moved
    // without regenerating. `bun scripts/gen_openapi.ts` fixes it.
    expect(onDisk).toBe(specJson(buildSpec()));
  });

  test("every registered route appears in the spec", () => {
    const spec = buildSpec() as { paths: Record<string, Record<string, unknown>> };
    const missing = registeredRoutes()
      .filter((r) => !spec.paths[`${PREFIX}${r.path}`]?.[r.method.toLowerCase()])
      .map((r) => `${r.method} ${PREFIX}${r.path} (${r.file})`);
    expect(missing).toEqual([]);
  });

  test("no mapping points at a route that no longer exists", () => {
    // A stale entry in ROUTE_SCHEMAS is the failure mode a generated file hides:
    // the spec still builds, the mapping is simply never consulted, and the
    // renamed route silently loses its documented shape.
    const live = new Set(registeredRoutes().map((r) => normalise(r.method, r.path)));
    const stale = Object.keys(ROUTE_SCHEMAS).filter((k) => !live.has(k));
    expect(stale).toEqual([]);
  });

  test("every route carries a summary from the guide", () => {
    // Summaries come from the api.md table, which the route-doc guard keeps in
    // sync both ways. If one is missing, the table and the routes have diverged
    // in a way that guard should already have caught — so this is a canary for
    // the normalisation agreeing between the two.
    const descriptions = descriptionsFromGuide();
    const undescribed = registeredRoutes()
      .filter((r) => !descriptions.has(normalise(r.method, r.path)))
      .map((r) => `${r.method} ${PREFIX}${r.path}`);
    expect(undescribed).toEqual([]);
  });

  test("the coverage block is arithmetic, not decoration", () => {
    const spec = buildSpec() as {
      paths: Record<string, Record<string, unknown>>;
      "x-cerefox-coverage": {
        routes: number;
        withResponseSchema: number;
        nonJson: string[];
        uncovered: string[];
      };
    };
    const cov = spec["x-cerefox-coverage"];
    expect(cov.routes).toBe(registeredRoutes().length);
    // Described + non-JSON + uncovered must account for every route exactly once.
    expect(cov.withResponseSchema + cov.nonJson.length + cov.uncovered.length).toBe(cov.routes);
    // And the detector must not have collapsed: a spec claiming zero coverage
    // would satisfy the arithmetic above while describing nothing.
    expect(cov.withResponseSchema).toBeGreaterThanOrEqual(25);
  });

  test("an uncovered route is candid rather than invented", () => {
    const spec = buildSpec() as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
      "x-cerefox-coverage": { uncovered: string[] };
    };
    for (const entry of spec["x-cerefox-coverage"].uncovered) {
      const [method, full] = entry.split(" ");
      const op = spec.paths[full!]![method!.toLowerCase()]!;
      const ok = (op.responses as Record<string, { content?: unknown; description: string }>)["200"]!;
      // No content block at all — the spec says "success" and declines to
      // describe the body, instead of guessing a shape a consumer would trust.
      expect(ok.content).toBeUndefined();
      expect(ok.description).toContain("no zod schema");
    }
  });
});
