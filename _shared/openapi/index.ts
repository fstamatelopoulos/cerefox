#!/usr/bin/env bun
/**
 * OpenAPI spec builder for the `/api/v1` HTTP API.
 *
 * Lives here rather than in `scripts/` because it imports zod, which resolves
 * in this workspace, and because `_shared/__tests__/` can then import it.
 * `scripts/gen_openapi.ts` is the thin CLI over `buildSpec()`.
 *
 * ## Why this is generated and not written
 *
 * The facts an API spec needs already live in three places that are each
 * already kept honest. Writing a spec by hand would make a fourth copy of all
 * of them, and this project's recurring failure is exactly that: a list that
 * has to match another list drifts (the tool counts, the live-suite probes, the
 * Data API grants, the Node floor, the `/api/v1` route table itself).
 *
 * So each part is taken from wherever it is already true:
 *
 *   paths         ← the `app.get|post|put|delete("/api/v1/…")` registrations in
 *                   `packages/memory/src/web/routes/`. Already guarded by
 *                   `_shared/__tests__/api-routes-documented.test.ts`.
 *   descriptions  ← the endpoint table in `docs/guides/api.md`. Already guarded
 *                   by the same test, in both directions.
 *   shapes        ← the zod schemas in `_shared/schemas/`, converted with zod
 *                   4's native `z.toJSONSchema()`. Verified against live
 *                   responses by `api-schema-truth.test.ts`.
 *
 * Nothing here is authored twice. The one hand-written thing is ROUTE_SCHEMAS
 * below — the mapping from a route to its schema — and it is a mapping, not a
 * duplicate of the shapes, with a completeness check in the test.
 *
 * ## What it deliberately does not claim
 *
 * Routes with no zod schema get their path, parameters and description but no
 * response schema. That is honest: inventing a shape for an endpoint nobody has
 * modelled would produce a spec that lies, which is worse than one that is
 * candid about its coverage. `coverage` in the output records the split.
 *
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";
import * as Schemas from "../schemas/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const ROUTES_DIR = join(REPO_ROOT, "packages", "memory", "src", "web", "routes");
const SERVER_TS = join(REPO_ROOT, "packages", "memory", "src", "web", "server.ts");
const API_DOC = join(REPO_ROOT, "docs", "guides", "api.md");
export const OUT_FILE = join(REPO_ROOT, "docs", "api", "openapi.json");

const PREFIX = "/api/v1";

/** Cerefox's own version, so the spec says what it was generated from. */
function cerefoxVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(REPO_ROOT, "packages", "memory", "package.json"), "utf8"),
  ) as { version: string };
  return pkg.version;
}

// ── Paths, from the registrations ────────────────────────────────────────────

export interface Route {
  method: string;
  /** OpenAPI-style path, `{param}` not `:param`, without the `/api/v1` prefix. */
  path: string;
  params: string[];
  file: string;
}

export function registeredRoutes(): Route[] {
  const files = readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(ROUTES_DIR, f));
  if (existsSync(SERVER_TS)) files.push(SERVER_TS);

  const out: Route[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/\.(get|post|put|delete)\(\s*"(\/api\/v1[^"]*)"/g)) {
      const method = m[1]!.toUpperCase();
      let path = m[2]!.slice(PREFIX.length) || "/";
      const params: string[] = [];
      // `:path{.+}` is a wildcard segment; `:document_id` is a plain param.
      path = path.replace(/:(\w+)\{[^}]*\}/g, (_s, n: string) => {
        params.push(n);
        return `{${n}}`;
      });
      path = path.replace(/:(\w+)/g, (_s, n: string) => {
        params.push(n);
        return `{${n}}`;
      });
      const key = `${method} ${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ method, path, params, file: file.replace(REPO_ROOT + "/", "") });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

// ── Descriptions, from the guide's endpoint table ────────────────────────────

/** Same normalisation the route-doc guard uses, so the two agree by construction. */
function normalise(method: string, path: string): string {
  let p = path.split("?")[0]!.trim();
  if (p.startsWith(PREFIX)) p = p.slice(PREFIX.length) || "/";
  p = p.replace(/\{[^}]*\}/g, "*");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return `${method.toUpperCase()} ${p}`;
}

export function descriptionsFromGuide(): Map<string, string> {
  const doc = readFileSync(API_DOC, "utf8");
  const out = new Map<string, string>();
  for (const line of doc.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 3) continue;
    const [, endpointCell, descCell] = cells;
    const endpoints = [...endpointCell!.matchAll(/`(GET|POST|PUT|DELETE)\s+([^`]+)`/g)];
    if (endpoints.length === 0) continue;
    // A cell may list several endpoints sharing one description (project CRUD).
    const desc = descCell!.replace(/\\\|/g, "|").trim();
    for (const e of endpoints) out.set(normalise(e[1]!, e[2]!), desc);
  }
  return out;
}

// ── Shapes, from the zod schemas ─────────────────────────────────────────────

type SchemaRef = { schema: z.ZodType; array?: boolean };

/**
 * Route → the zod schema describing its success body, and its request body.
 *
 * The only hand-written table here. It maps; it does not restate shapes. A
 * route missing from it is reported as uncovered rather than guessed at, and
 * `api-openapi-spec.test.ts` fails if a route named here no longer exists.
 */
export const ROUTE_SCHEMAS: Record<string, { response?: SchemaRef; request?: z.ZodType }> = {
  "GET /version": { response: { schema: Schemas.VersionResponse } },
  "GET /schema-version": { response: { schema: Schemas.SchemaVersionResponse } },
  "GET /search": { response: { schema: Schemas.SearchResponse } },
  "GET /dashboard": { response: { schema: Schemas.DashboardResponse } },
  "GET /documents/*": { response: { schema: Schemas.DocumentDetailResponse } },
  "GET /documents/*/chunks": { response: { schema: Schemas.ChunkResponse, array: true } },
  "GET /documents/*/versions": { response: { schema: Schemas.DocumentVersionResponse, array: true } },
  "GET /documents/trash": { response: { schema: Schemas.TrashedDoc, array: true } },
  "POST /documents/metadata-search": {
    response: { schema: Schemas.MetadataSearchResult, array: true },
    request: Schemas.MetadataSearchRequest,
  },
  "POST /documents/*/edit": { response: { schema: Schemas.EditResponse }, request: Schemas.EditRequest },
  "POST /documents/*/review-status": {
    response: { schema: Schemas.ReviewStatusResponse },
    request: Schemas.ReviewStatusRequest,
  },
  "POST /ingest": { response: { schema: Schemas.IngestResponse }, request: Schemas.IngestRequest },
  "DELETE /documents/*": { response: { schema: Schemas.DeleteResponse } },
  "POST /documents/*/restore": { response: { schema: Schemas.RestoreResponse } },
  "DELETE /documents/*/purge": { response: { schema: Schemas.PurgeResponse } },
  "GET /config": { response: { schema: Schemas.ConfigListResponse } },
  "PUT /config/*": { response: { schema: Schemas.ConfigValueResponse }, request: Schemas.SetConfigRequest },
  "GET /preferences": { response: { schema: Schemas.PreferencesResponse } },
  "PUT /preferences": { response: { schema: Schemas.PreferencesResponse }, request: Schemas.PreferencesResponse },
  "POST /documents/*/versions/*/archive": { request: Schemas.VersionArchiveRequest },
  "GET /metadata-keys": { response: { schema: Schemas.MetadataKeyResponse, array: true } },
  "GET /projects": { response: { schema: Schemas.ProjectResponse, array: true } },
  "POST /projects": { response: { schema: Schemas.ProjectResponse }, request: Schemas.CreateProjectRequest },
  "GET /projects/*/documents": { response: { schema: Schemas.ProjectDocumentsResponse } },
  "GET /config/*": { response: { schema: Schemas.ConfigValueResponse } },
  "GET /audit-log": { response: { schema: Schemas.AuditEntryResponse, array: true } },
  "GET /usage-log": { response: { schema: Schemas.UsageLogEntryResponse, array: true } },
  "GET /usage-log/summary": { response: { schema: Schemas.UsageSummaryResponse } },
  "GET /docs": { response: { schema: Schemas.BundledDocEntry, array: true } },
  "GET /check-filename": { response: { schema: Schemas.FilenameCheckResponse } },
  "GET /resolve-link": { response: { schema: Schemas.ResolveLinkResponse } },
};

function toJsonSchema(s: z.ZodType): unknown {
  // `io: "output"` describes what the server SENDS (defaults applied), which is
  // the right side for a response. `unrepresentable: "any"` keeps a JSONB-ish
  // `z.record(z.unknown())` from aborting the whole conversion.
  return (z as unknown as { toJSONSchema: (s: unknown, o: unknown) => unknown }).toJSONSchema(s, {
    io: "output",
    unrepresentable: "any",
    target: "draft-2020-12",
  });
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/**
 * Endpoints that do NOT return JSON. Declaring a JSON schema for these would be
 * a lie of a different kind from an absent one, so they get their real media
 * type and no schema.
 */
const NON_JSON: Record<string, { mediaType: string; description: string }> = {
  "GET /documents/*/download": {
    mediaType: "text/markdown",
    description: "The document's reconstructed markdown, as a file download.",
  },
  "GET /usage-log/export.csv": {
    mediaType: "text/csv",
    description: "The usage log as CSV.",
  },
};

const ERROR_SCHEMA = {
  type: "object",
  description:
    "Error body. `detail` is the human-readable reason; routes that wrap a write also return `success: false`.",
  properties: {
    detail: { type: "string" },
    success: { type: "boolean", enum: [false] },
    error: { type: "string", description: "Legacy alias for `detail` on some write routes." },
  },
  additionalProperties: true,
};

/** Responses every route can produce, documented once. */
function commonResponses(method: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    "400": { description: "Malformed request, or a parameter the server rejects.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
    "401": { description: "An API key is required (a non-loopback request when `CEREFOX_API_KEY` is set). See docs/guides/securing-local-access.md.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
    "404": { description: "No such resource; or the feature is disabled for this store.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
    "500": { description: "Unhandled server or database error.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  };
  if (method !== "GET") {
    out["409"] = {
      description:
        "Optimistic-concurrency conflict (`CEREFOX_CONFLICT`, SQLSTATE `PT409`): the document changed since the `expected_content_hash` you sent. Re-read, merge, retry with the new hash. Never resolve by overwriting blindly.",
      content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
    };
  }
  return out;
}

export function buildSpec(): Record<string, unknown> {
  const routes = registeredRoutes();
  const descriptions = descriptionsFromGuide();

  const paths: Record<string, Record<string, unknown>> = {};
  let withSchema = 0;

  for (const r of routes) {
    const key = normalise(r.method, r.path);
    const mapping = ROUTE_SCHEMAS[key];
    const op: Record<string, unknown> = {
      summary: descriptions.get(key) ?? undefined,
      operationId: `${r.method.toLowerCase()}${r.path.replace(/[^A-Za-z0-9]+/g, "_").replace(/_+$/, "")}`,
      parameters: r.params.map((p) => ({
        name: p,
        in: "path",
        required: true,
        schema: { type: "string" },
      })),
      responses: {
        "200": NON_JSON[key]
          ? {
              description: NON_JSON[key]!.description,
              content: { [NON_JSON[key]!.mediaType]: { schema: { type: "string" } } },
            }
          : mapping?.response
          ? {
              description: "Success.",
              content: {
                "application/json": {
                  schema: mapping.response.array
                    ? { type: "array", items: toJsonSchema(mapping.response.schema) }
                    : toJsonSchema(mapping.response.schema),
                },
              },
            }
          : {
              description:
                "Success. This endpoint has no zod schema in `_shared/schemas/`, so its body is not described here rather than guessed at — see docs/guides/api.md.",
            },
        ...commonResponses(r.method),
      },
    };
    if (mapping?.response) withSchema++;
    if (mapping?.request) {
      op.requestBody = {
        required: true,
        content: { "application/json": { schema: toJsonSchema(mapping.request) } },
      };
    }
    if (op.parameters && (op.parameters as unknown[]).length === 0) delete op.parameters;
    if (op.summary === undefined) delete op.summary;

    paths[`${PREFIX}${r.path}`] ??= {};
    paths[`${PREFIX}${r.path}`]![r.method.toLowerCase()] = op;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Cerefox /api/v1",
      version: cerefoxVersion(),
      description: [
        "The HTTP API served by `cerefox web`. Intended for callers that embed Cerefox rather than",
        "using MCP or the CLI — MCP remains the recommended path for AI agents.",
        "",
        "GENERATED by `bun scripts/gen_openapi.ts`; do not edit by hand. Paths come from the route",
        "registrations, summaries from the endpoint table in docs/guides/api.md, and response shapes",
        "from the zod schemas in `_shared/schemas/` (verified against live responses by",
        "`api-schema-truth.test.ts`).",
        "",
        "AUTH: a request arriving on loopback needs no credential. From any other interface, an",
        "`X-API-Key` (or `Authorization: Bearer`) matching `CEREFOX_API_KEY` is required.",
        "See docs/guides/securing-local-access.md.",
        "",
        "CONCURRENCY: every content update requires `expected_content_hash` — the hash you read the",
        "document at — or an explicit `last_write_wins`. A stale hash is a 409.",
      ].join("\n"),
    },
    servers: [
      { url: "http://127.0.0.1:8000", description: "`cerefox web` default" },
      { url: "http://127.0.0.1:8010", description: "Cerefox Local default (the container publishes 8000)" },
    ],
    components: {
      schemas: { Error: ERROR_SCHEMA },
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
      },
    },
    paths,
    "x-cerefox-coverage": {
      routes: routes.length,
      withResponseSchema: withSchema,
      note:
        "Routes without a response schema are listed with their parameters and summary only. " +
        "Nothing is invented; see x-cerefox-uncovered.",
      nonJson: Object.keys(NON_JSON),
      uncovered: routes
        .filter((r) => {
          const k = normalise(r.method, r.path);
          return !ROUTE_SCHEMAS[k]?.response && !NON_JSON[k];
        })
        .map((r) => `${r.method} ${PREFIX}${r.path}`),
    },
  };
}


/** Canonical serialisation, so `--check` and the test compare like with like. */
export function specJson(spec: Record<string, unknown>): string {
  return JSON.stringify(spec, null, 2) + "\n";
}
