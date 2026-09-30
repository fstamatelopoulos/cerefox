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
 * The facts an API spec needs already live in places that are each already
 * kept honest. Writing a spec by hand would make another copy of all of them,
 * and this project's recurring failure is exactly that: a list that has to
 * match another list drifts (the tool counts, the live-suite probes, the Data
 * API grants, the Node floor, the `/api/v1` route table itself).
 *
 * So each part is taken from wherever it is already true:
 *
 *   paths         ← the `app.get|post|put|delete("/api/v1/…")` registrations in
 *                   `packages/memory/src/web/routes/`. Guarded by
 *                   `_shared/__tests__/api-routes-documented.test.ts`.
 *   inputs        ← the HANDLER SOURCE: every `c.req.query("…")`,
 *                   `c.req.header("…")`, `body.…` and `form.…` read, and whether
 *                   the handler resolves a caller identity (#296).
 *   error codes   ← the status literals the handler (and the same-file helpers
 *                   it calls) can return (#296).
 *   descriptions  ← the endpoint table in `docs/guides/api.md`.
 *   shapes        ← the zod schemas in `_shared/schemas/`, converted with zod
 *                   4's native `z.toJSONSchema()`. Responses are verified
 *                   against a live server by `api-schema-truth.test.ts`.
 *
 * ## The one hand-written part, and what keeps it honest
 *
 * A handler says which inputs it reads, not what they mean, so parameter
 * DESCRIPTIONS and types are written here (`QUERY_DOCS`, `HEADER_DOCS`,
 * `FORM_BODIES`). They are keyed by what the derivation finds, and
 * `api-request-contract.test.ts` requires the two to agree in BOTH directions:
 * a read input nobody documented fails, and so does a documented input no
 * handler reads. The second direction is the one #296 was about — the first
 * version of this document described six `/ingest` fields the route ignored.
 *
 * ## What it deliberately does not claim
 *
 * Routes with no zod schema get their path, parameters and description but no
 * response schema. Inventing a shape for an endpoint nobody has modelled would
 * produce a spec that lies, which is worse than one that is candid about its
 * coverage. `x-cerefox-coverage` in the output records the split.
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

/**
 * `info.version` describes the **API surface**, not the shipping package.
 *
 * It used to be read from `packages/memory/package.json`, which was wrong twice
 * over and broke the v1.15.1 release:
 *
 *   - The artifact is generated and committed, and the staleness guard compares
 *     it byte for byte against what the generator produces. `cut_release.ts`
 *     bumps the package version, so the cut commit itself made the committed
 *     file stale — CI failed on the tag, and `Publish to npm` was skipped. The
 *     guard fired correctly and for a reason no human had caused, which is the
 *     worst kind: it blocks a release and points at nothing anyone can fix by
 *     regenerating.
 *   - It was also wrong for consumers. `info.version` is what a client
 *     generator stamps into its output, so tying it to the package version
 *     churned every downstream client on every patch release while the API it
 *     describes had not changed at all.
 *
 * So it moves when `/api/v1` changes, and an incompatible change would be
 * `/api/v2` and a new document. `api-openapi-spec.test.ts` asserts the package
 * version is not embedded anywhere, so the coupling cannot come back.
 *
 * 1.1.0 (#296): the document now describes query and header parameters,
 * multipart bodies, per-route error codes and authentication, and the ingest
 * and edit request bodies were corrected to what the routes read. The routes
 * gained fields and lost no accepted input, so a minor.
 */
const API_VERSION = "1.1.0";

// ── Paths, from the registrations ────────────────────────────────────────────

export interface Route {
  method: string;
  /** OpenAPI-style path, `{param}` not `:param`, without the `/api/v1` prefix. */
  path: string;
  params: string[];
  file: string;
  /** The handler's source, plus the same-file helpers it calls. Empty for a
   *  route registered only in `server.ts` (the no-database 503 stubs). */
  source: string;
}

const REGISTRATION = /\.(get|post|put|delete)\(\s*"(\/api\/v1[^"]*)"/g;

/** Top-level functions in a file, by name → source. Ends at the first line
 *  that is exactly `}` — the file style every route module follows. */
function topLevelFunctions(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]/gm)) {
    const end = src.indexOf("\n}\n", m.index!);
    out.set(m[1]!, src.slice(m.index!, end === -1 ? undefined : end + 2));
  }
  return out;
}

/** A handler's source with the same-file helpers it calls folded in, so an
 *  input read inside a helper (`fetchUsageLog`, `ingestFailure`, `runSearch`)
 *  is attributed to every route that calls it. */
function expandHelpers(segment: string, fns: Map<string, string>): string {
  const seen = new Set<string>();
  const walk = (s: string, depth: number): string => {
    let acc = s;
    if (depth > 4) return acc;
    for (const [name, body] of fns) {
      if (seen.has(name) || name.startsWith("register")) continue;
      if (new RegExp(`\\b${name}\\(`).test(s)) {
        seen.add(name);
        acc += "\n" + walk(body, depth + 1);
      }
    }
    return acc;
  };
  return walk(segment, 0);
}

export function registeredRoutes(): Route[] {
  const files = readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => join(ROUTES_DIR, f));
  if (existsSync(SERVER_TS)) files.push(SERVER_TS);

  const out: Route[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const fns = topLevelFunctions(src);
    const regs = [...src.matchAll(REGISTRATION)];
    regs.forEach((m, i) => {
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
      if (seen.has(key)) return;
      seen.add(key);
      // server.ts registers only the no-database stubs; their inputs are not
      // the route's contract, so they contribute no source.
      const segment =
        file === SERVER_TS ? "" : src.slice(m.index!, i + 1 < regs.length ? regs[i + 1]!.index! : undefined);
      out.push({
        method,
        path,
        params,
        file: file.replace(REPO_ROOT + "/", ""),
        source: segment ? expandHelpers(segment, fns) : "",
      });
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

// ── Inputs, from the handler source (#296) ───────────────────────────────────

export interface DerivedInputs {
  query: string[];
  /** Lower-cased, as Hono reads them. Identity headers are NOT listed here. */
  headers: string[];
  /** `body.<field>` reads on a JSON body. */
  bodyFields: string[];
  /** `form.<field>` reads on a multipart body. */
  formFields: string[];
  /** Does the handler read a JSON body / a multipart body at all? */
  jsonBody: boolean;
  formBody: boolean;
  /** Does it resolve a caller identity (headers, and body fields on a write)? */
  identity: boolean;
  /** 4xx/5xx statuses it can return. */
  statuses: string[];
  responseHeaders: string[];
  /** A runtime allow-list the handler enforces (`INGEST_FIELDS`, …), if any. */
  allowList: string[] | null;
}

const uniq = (xs: string[]) => [...new Set(xs)];

/** Pure, so the tests can prove it fires on synthetic handler source. */
export function deriveInputs(source: string, fileSource = ""): DerivedInputs {
  const all = (re: RegExp) => uniq([...source.matchAll(re)].map((m) => m[1]!));
  const allowName = source.match(/\b([A-Z][A-Z_]*_FIELDS)\.has\(/)?.[1];
  let allowList: string[] | null = null;
  if (allowName) {
    const decl = fileSource.match(new RegExp(`${allowName}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`));
    allowList = decl ? [...decl[1]!.matchAll(/"([\w-]+)"/g)].map((m) => m[1]!) : [];
  }
  return {
    query: all(/c\.req\.query\("(\w+)"\)/g),
    headers: all(/c\.req\.header\("([\w-]+)"\)/g).map((h) => h.toLowerCase()),
    bodyFields: all(/\bbody\.(\w+)/g),
    formFields: all(/\bform\.(\w+)/g),
    jsonBody: /c\.req\.json\(/.test(source),
    formBody: /c\.req\.parseBody\(/.test(source),
    identity: /resolveCallerIdentity\(/.test(source),
    // A status literal is an argument or a tuple element: `c.json(x, 404)`,
    // `HttpError(503, …)`, `return [body, 409]` — never a bare number in prose.
    statuses: all(/[,(\[]\s*([45]\d\d)\s*[,)\]]/g).sort(),
    responseHeaders: all(/c\.header\("([\w-]+)"/g),
    allowList,
  };
}

export function routeInputs(route: Route): DerivedInputs {
  const fileSrc = route.source ? readFileSync(join(REPO_ROOT, route.file), "utf8") : "";
  return deriveInputs(route.source, fileSrc);
}

// ── Descriptions, from the guide's endpoint table ────────────────────────────

/** Same normalisation the route-doc guard uses, so the two agree by construction. */
export function normalise(method: string, path: string): string {
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

// ── What the inputs mean (checked against the derivation) ────────────────────

type ParamDoc = { description: string; schema: Record<string, unknown>; required?: boolean };

const UUID = { type: "string", format: "uuid" };
const TIMESTAMP = { type: "string", format: "date-time" };
const int = (min: number, max: number | null, dflt: number) => ({
  type: "integer",
  minimum: min,
  ...(max !== null ? { maximum: max } : {}),
  default: dflt,
});

const USAGE_FILTERS: Record<string, ParamDoc> = {
  start: { description: "Only entries logged at or after this time.", schema: TIMESTAMP },
  end: { description: "Only entries logged before this time.", schema: TIMESTAMP },
  access_path: {
    description: "Only entries from this transport (`api`, `webapp`, `local-mcp`, `remote-mcp`, `cli`, …).",
    schema: { type: "string" },
  },
  project_id: { description: "Only entries touching this project.", schema: UUID },
};
const USAGE_LIST: Record<string, ParamDoc> = {
  ...USAGE_FILTERS,
  operation: { description: "Only this operation (`search`, `ingest`, `get-document`, …).", schema: { type: "string" } },
  requestor: { description: "Only entries recorded for this requestor.", schema: { type: "string" } },
};
const HASH_PARAM: ParamDoc = {
  description:
    "The `content_hash` you read the document at. Required when the caller identifies itself; a stale one is a 409.",
  schema: { type: "string" },
};

/** Route → query parameter → meaning. Keys must equal what the handler reads. */
export const QUERY_DOCS: Record<string, Record<string, ParamDoc>> = {
  "GET /search": {
    q: {
      description:
        "The query. Empty returns no results — or, with `project_id`, browses that project's documents (up to 100).",
      schema: { type: "string" },
    },
    mode: {
      description:
        "`docs` (default): one row per document with its full content. `hybrid`, `fts`, `semantic`: one row per chunk.",
      schema: { type: "string", enum: ["docs", "hybrid", "fts", "semantic"], default: "docs" },
    },
    project_id: { description: "Restrict to one project.", schema: UUID },
    count: {
      description: "Maximum results. Clamped to 1–50, and to 5 in `docs` mode, where each result is a whole document.",
      schema: int(1, 50, 10),
    },
    metadata_filter: {
      description: 'A JSON-encoded object of metadata key/value pairs that must all match, e.g. `{"type":"note"}`.',
      schema: { type: "string" },
    },
    review_status: {
      description: "Only documents in this review state. A 400 while the review workflow is off.",
      schema: { type: "string", enum: ["approved", "pending_review"] },
    },
  },
  "GET /documents/*": {
    version_id: { description: "An archived version to read instead of the current one.", schema: UUID },
  },
  "GET /documents/*/download": {
    version_id: { description: "An archived version to download instead of the current one.", schema: UUID },
  },
  "DELETE /documents/*": { expected_content_hash: HASH_PARAM },
  "GET /documents/trash": { limit: { description: "Maximum rows. Clamped to 1–500.", schema: int(1, 500, 50) } },
  "GET /check-filename": {
    filename: {
      description: "A source path, matched exactly. Empty answers `exists: false`.",
      schema: { type: "string" },
    },
  },
  "GET /resolve-link": {
    path: {
      description: "The link target: a document id, a relative path, or a filename. `#anchor` is split off and echoed.",
      schema: { type: "string" },
      required: true,
    },
    from_doc_id: { description: "The linking document, excluded from the matches.", schema: UUID },
    limit: { description: "Maximum matches. Clamped to 1–50.", schema: int(1, 50, 10) },
  },
  "GET /dashboard/recent-docs": {
    project_id: { description: "Scope the tile to one project. A malformed id is a 400.", schema: UUID },
  },
  "GET /projects/*/documents": {
    limit: { description: "Page size. Clamped to 1–200.", schema: int(1, 200, 50) },
    offset: { description: "Rows to skip.", schema: int(0, null, 0) },
  },
  "GET /audit-log": {
    limit: { description: "Maximum entries. Clamped to 1–200.", schema: int(1, 200, 50) },
    document_id: { description: "Only entries for this document.", schema: UUID },
    author: {
      description: "Only entries written by this author. A filter, not the caller's identity (that is `X-Cerefox-Author`).",
      schema: { type: "string" },
    },
    operation: { description: "Only this operation (`create`, `update-content`, `delete`, …).", schema: { type: "string" } },
    since: { description: "Only entries at or after this time.", schema: TIMESTAMP },
    until: { description: "Only entries before this time.", schema: TIMESTAMP },
  },
  "GET /usage-log": {
    ...USAGE_LIST,
    limit: { description: "Maximum entries. Not capped.", schema: int(1, null, 100) },
  },
  "GET /usage-log/export.csv": {
    ...USAGE_LIST,
    limit: { description: "Maximum rows. Not capped.", schema: int(1, null, 10000) },
  },
  "GET /usage-log/summary": USAGE_FILTERS,
};

/** Non-identity request headers, by lower-cased name. */
export const HEADER_DOCS: Record<string, { name: string } & ParamDoc> = {
  "x-cerefox-expected-content-hash": { name: "X-Cerefox-Expected-Content-Hash", ...HASH_PARAM },
};

/** Sent on every route that resolves a caller identity (#226). */
const IDENTITY_HEADERS: Array<{ name: string } & ParamDoc> = [
  {
    name: "X-Cerefox-Author",
    description:
      "Who is calling. Omit all three identity headers to be recorded as the bundled web UI (`web-ui`, access path `webapp`); supply any to be recorded as yourself with access path `api`.",
    schema: { type: "string", minLength: 1 },
  },
  {
    name: "X-Cerefox-Requestor",
    description: "Recorded in the usage log. Defaults to `X-Cerefox-Author`.",
    schema: { type: "string", minLength: 1 },
  },
  {
    name: "X-Cerefox-Author-Type",
    description: "`agent` makes a new document land in `pending_review`, as it does over MCP.",
    schema: { type: "string", enum: ["user", "agent"] },
  },
];

/** Set on every /api/v1 response by middleware in server.ts (RFC 8631). */
const LINK_HEADER = {
  Link: {
    description: 'Always `</api/v1/openapi.json>; rel="service-desc"` (RFC 8631): where this API describes itself.',
    schema: { type: "string" },
  },
};

/** Response headers set by individual handlers, by name. */
export const RESPONSE_HEADER_DOCS: Record<string, { description: string; schema: Record<string, unknown> }> = {
  "X-Total-Count": {
    description: "The exact number of rows matching, independent of `limit`.",
    schema: { type: "integer", minimum: 0 },
  },
};

const IDENTITY_FORM_FIELDS = {
  author: { type: "string" },
  requestor: { type: "string" },
  author_type: { type: "string", enum: ["user", "agent"] },
};
const FORM_HASH = {
  expected_content_hash: {
    type: "string",
    description: "The content_hash you read the document at. Required on a content update unless last_write_wins is `true`.",
  },
  last_write_wins: { type: "string", enum: ["true", "false"], description: "Skip the concurrency check." },
};

/** Multipart bodies. Every field is a string on the wire. Keys must equal the
 *  handler's `form.…` reads plus the identity fields. */
export const FORM_BODIES: Record<string, { required: string[]; properties: Record<string, unknown> }> = {
  "POST /ingest/file": {
    required: ["file"],
    properties: {
      file: {
        type: "string",
        format: "binary",
        description: "The file to convert to markdown and ingest (.md, .txt, .pdf, .docx, …).",
      },
      title: { type: "string", description: "Defaults to the filename." },
      update_existing: {
        type: "string",
        enum: ["true", "false"],
        description: "Update the document matching this file's path or title instead of creating another.",
      },
      project_ids: { type: "string", description: "Comma-separated project ids." },
      metadata: { type: "string", description: "A JSON-encoded object of metadata key/value pairs." },
      ...FORM_HASH,
      ...IDENTITY_FORM_FIELDS,
    },
  },
  "POST /documents/*/upload": {
    required: ["file"],
    properties: {
      file: { type: "string", format: "binary", description: "The replacement content, converted to markdown." },
      ...FORM_HASH,
      ...IDENTITY_FORM_FIELDS,
    },
  },
};

// ── Shapes, from the zod schemas ─────────────────────────────────────────────

type SchemaRef = { schema: z.ZodType; array?: boolean };

/**
 * Route → the zod schema describing its success body, and its JSON request
 * body. A mapping, not a restatement of the shapes. A route missing from it is
 * reported as uncovered rather than guessed at; `api-openapi-spec.test.ts`
 * fails if a route named here no longer exists, and
 * `api-request-contract.test.ts` pins each request schema's fields to the
 * handler's reads.
 */
export const ROUTE_SCHEMAS: Record<string, { response?: SchemaRef; request?: z.ZodType }> = {
  "GET /version": { response: { schema: Schemas.VersionResponse } },
  "GET /schema-version": { response: { schema: Schemas.SchemaVersionResponse } },
  "GET /search": { response: { schema: Schemas.SearchResponse } },
  "GET /dashboard": { response: { schema: Schemas.DashboardResponse } },
  "GET /dashboard/recent-docs": { response: { schema: Schemas.DashboardRecentDocsResponse } },
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
  "POST /ingest/file": { response: { schema: Schemas.IngestResponse } },
  "POST /documents/*/upload": { response: { schema: Schemas.UploadResponse } },
  "DELETE /documents/*": { response: { schema: Schemas.DeleteResponse } },
  "POST /documents/*/restore": { response: { schema: Schemas.RestoreResponse } },
  "DELETE /documents/*/purge": { response: { schema: Schemas.PurgeResponse } },
  "GET /config": { response: { schema: Schemas.ConfigListResponse } },
  "PUT /config/*": { response: { schema: Schemas.ConfigValueResponse }, request: Schemas.SetConfigRequest },
  "GET /preferences": { response: { schema: Schemas.PreferencesResponse } },
  "PUT /preferences": { response: { schema: Schemas.PreferencesResponse }, request: Schemas.PreferencesRequest },
  "POST /documents/*/versions/*/archive": {
    response: { schema: Schemas.VersionArchiveResponse },
    request: Schemas.VersionArchiveRequest,
  },
  "GET /metadata-keys": { response: { schema: Schemas.MetadataKeyResponse, array: true } },
  "GET /projects": { response: { schema: Schemas.ProjectResponse, array: true } },
  "POST /projects": { response: { schema: Schemas.ProjectResponse }, request: Schemas.CreateProjectRequest },
  "PUT /projects/*": { response: { schema: Schemas.ProjectResponse }, request: Schemas.UpdateProjectRequest },
  "DELETE /projects/*": { response: { schema: Schemas.SuccessResponse } },
  "GET /projects/*/documents": { response: { schema: Schemas.ProjectDocumentsResponse } },
  "GET /config/*": { response: { schema: Schemas.ConfigValueResponse } },
  "GET /audit-log": { response: { schema: Schemas.AuditEntryResponse, array: true } },
  "GET /usage-log": { response: { schema: Schemas.UsageLogEntryResponse, array: true } },
  "GET /usage-log/summary": { response: { schema: Schemas.UsageSummaryResponse } },
  "GET /docs": { response: { schema: Schemas.BundledDocEntry, array: true } },
  "GET /check-filename": { response: { schema: Schemas.FilenameCheckResponse } },
  "GET /resolve-link": { response: { schema: Schemas.ResolveLinkResponse } },
};

/**
 * A response describes what the server SENDS (`io: "output"`: defaults applied,
 * so a defaulted field is present). A request describes what the caller may
 * send (`io: "input"`: a defaulted field is optional). Converting requests as
 * outputs is how the first version of this document marked `project_ids`,
 * `metadata`, `limit` and `description` required when the routes default them.
 */
export function toJsonSchema(s: z.ZodType, io: "input" | "output"): Record<string, unknown> {
  // `unrepresentable: "any"` keeps a JSONB-ish `z.record(z.unknown())` from
  // aborting the whole conversion.
  const out = (z as unknown as { toJSONSchema: (s: unknown, o: unknown) => Record<string, unknown> }).toJSONSchema(s, {
    io,
    unrepresentable: "any",
    target: "draft-2020-12",
  });
  delete out.$schema;
  return out;
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/**
 * Endpoints whose body is served verbatim rather than modelled: markdown, CSV,
 * and this document itself. Declaring a zod-derived schema for these would be a
 * lie of a different kind from an absent one, so they get their real media
 * type and a plain schema.
 */
const NON_JSON: Record<string, { mediaType: string; description: string }> = {
  "GET /openapi.json": {
    mediaType: "application/json",
    description: "This document, byte-identical to docs/api/openapi.json for the running version.",
  },
  "GET /documents/*/download": {
    mediaType: "text/markdown",
    description: "The document's reconstructed markdown, as a file download.",
  },
  "GET /docs/*": {
    mediaType: "text/markdown",
    description: "One bundled guide's markdown.",
  },
  "GET /usage-log/export.csv": {
    mediaType: "text/csv",
    description: "The usage log as CSV.",
  },
};

const ERROR_SCHEMA = {
  type: "object",
  description:
    "Error body. `detail` is the human-readable reason. Write routes also return `success: false`; the ingest and edit routes also carry the same text as `error` (and edit as `message`), and a concurrency conflict adds `current_hash`.",
  properties: {
    detail: { type: "string" },
    success: { type: "boolean", enum: [false] },
    error: { type: "string" },
    message: { type: "string" },
    current_hash: { type: "string", description: "On a 409 conflict: the document's hash now. Re-read, merge, retry with it." },
  },
  additionalProperties: true,
};

/** What each status means on this API. Only the ones a route can return are attached to it. */
const STATUS_TEXT: Record<string, string> = {
  "400":
    "The request is malformed or incomplete: a bad parameter or body, an unknown body field, a blank identity header, or a content update with no `expected_content_hash` and no `last_write_wins` (`CEREFOX_TOKEN_REQUIRED`).",
  "401":
    "An API key is required: a non-loopback request while `CEREFOX_API_KEY` is set. See docs/guides/securing-local-access.md.",
  "404": "No such document, version or project; or the feature is off on this store.",
  "409":
    "Conflict with the current state: a stale `expected_content_hash` (`CEREFOX_CONFLICT`; the body carries `current_hash` — re-read, merge, retry; never resolve by overwriting blindly), a document in the trash, or a duplicate name.",
  "422": "Well-formed, but fails a semantic check: content linking to document ids that do not exist, or a missing required parameter.",
  "500": "Unhandled server or database error.",
  "503": "A dependency is unavailable: no embedder configured, or the deployed schema needs `cerefox server deploy`.",
};

function errorResponse(code: string): Record<string, unknown> {
  return {
    description: STATUS_TEXT[code] ?? "Error.",
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

export function buildSpec(): Record<string, unknown> {
  const routes = registeredRoutes();
  const descriptions = descriptionsFromGuide();

  const paths: Record<string, Record<string, unknown>> = {};
  let withSchema = 0;
  let queryParams = 0;

  for (const r of routes) {
    const key = normalise(r.method, r.path);
    const mapping = ROUTE_SCHEMAS[key];
    const inputs = routeInputs(r);

    const parameters: Array<Record<string, unknown>> = r.params.map((p) => ({
      name: p,
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    for (const q of inputs.query) {
      const doc = QUERY_DOCS[key]?.[q];
      queryParams++;
      parameters.push({
        name: q,
        in: "query",
        required: doc?.required ?? false,
        ...(doc ? { description: doc.description } : {}),
        schema: doc?.schema ?? { type: "string" },
      });
    }
    for (const h of inputs.headers) {
      const doc = HEADER_DOCS[h];
      parameters.push({
        name: doc?.name ?? h,
        in: "header",
        required: false,
        ...(doc ? { description: doc.description } : {}),
        schema: doc?.schema ?? { type: "string" },
      });
    }
    if (inputs.identity) {
      for (const h of IDENTITY_HEADERS) {
        parameters.push({ name: h.name, in: "header", required: false, description: h.description, schema: h.schema });
      }
    }

    const responseHeaders = Object.fromEntries(
      inputs.responseHeaders.map((h) => [h, RESPONSE_HEADER_DOCS[h] ?? { schema: { type: "string" } }]),
    );
    const ok: Record<string, unknown> = NON_JSON[key]
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
                ? { type: "array", items: toJsonSchema(mapping.response.schema, "output") }
                : toJsonSchema(mapping.response.schema, "output"),
            },
          },
        }
      : {
          description:
            "Success. This endpoint has no zod schema in `_shared/schemas/`, so its body is not described here rather than guessed at — see docs/guides/api.md.",
        };
    ok.headers = { ...LINK_HEADER, ...responseHeaders };

    // Every route sits behind the auth gate (401) and can fail unhandled (500).
    const codes = uniq([...inputs.statuses, "401", "500"]).sort();
    const responses: Record<string, unknown> = { "200": ok };
    for (const code of codes) responses[code] = errorResponse(code);

    const op: Record<string, unknown> = {
      summary: descriptions.get(key) ?? undefined,
      operationId: `${r.method.toLowerCase()}${r.path.replace(/[^A-Za-z0-9]+/g, "_").replace(/_+$/, "")}`,
      parameters,
      responses,
    };
    if (mapping?.response) withSchema++;
    if (mapping?.request) {
      op.requestBody = {
        required: true,
        content: { "application/json": { schema: toJsonSchema(mapping.request, "input") } },
      };
    } else if (FORM_BODIES[key]) {
      op.requestBody = {
        required: true,
        content: {
          "multipart/form-data": {
            schema: { type: "object", required: FORM_BODIES[key]!.required, properties: FORM_BODIES[key]!.properties },
          },
        },
      };
    }
    if ((op.parameters as unknown[]).length === 0) delete op.parameters;
    if (op.summary === undefined) delete op.summary;

    paths[`${PREFIX}${r.path}`] ??= {};
    paths[`${PREFIX}${r.path}`]![r.method.toLowerCase()] = op;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Cerefox /api/v1",
      version: API_VERSION,
      description: [
        "The HTTP API served by `cerefox web`. Intended for callers that embed Cerefox rather than",
        "using MCP or the CLI — MCP remains the recommended path for AI agents.",
        "",
        "GENERATED by `bun scripts/gen_openapi.ts`; do not edit by hand. Paths and every input a route",
        "reads come from the route handlers, summaries from the endpoint table in docs/guides/api.md,",
        "and body shapes from the zod schemas in `_shared/schemas/` (responses verified against a live",
        "server by `api-schema-truth.test.ts`).",
        "",
        "AUTH: a request arriving on loopback needs no credential. From any other interface, an",
        "`X-API-Key` (or `Authorization: Bearer`) matching `CEREFOX_API_KEY` is required.",
        "See docs/guides/securing-local-access.md.",
        "",
        "IDENTITY: send `X-Cerefox-Author` (and optionally `X-Cerefox-Author-Type`) to be recorded as",
        "yourself. Without them you are recorded as the bundled web UI.",
        "",
        "CONCURRENCY: read before you write. A content update (`POST /ingest` with `document_id` or",
        "`update_if_exists`, `POST /documents/{id}/edit`, `/upload`) needs the `content_hash` you read",
        "as `expected_content_hash`, or an explicit `last_write_wins`. `DELETE /documents/{id}` needs it",
        "too when you identify yourself, as `X-Cerefox-Expected-Content-Hash` or a query parameter.",
        "Neither is a 400 (`CEREFOX_TOKEN_REQUIRED`); a stale hash is a 409 carrying `current_hash`.",
        "Restore and purge take no hash.",
        "",
        "DISCOVERY: this document is served at `GET /api/v1/openapi.json` by the server it describes,",
        "and every /api/v1 response carries `Link: </api/v1/openapi.json>; rel=\"service-desc\"` (RFC 8631).",
      ].join("\n"),
    },
    servers: [
      { url: "http://127.0.0.1:8000", description: "`cerefox web` default" },
      { url: "http://127.0.0.1:8010", description: "Cerefox Local default (the container publishes 8000)" },
    ],
    // `{}` first: no credential is a valid way in (loopback). The other two are
    // the two spellings of the same key for everything else.
    security: [{}, { apiKey: [] }, { bearerAuth: [] }],
    components: {
      schemas: { Error: ERROR_SCHEMA },
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
        bearerAuth: { type: "http", scheme: "bearer", description: "The same `CEREFOX_API_KEY`, as a bearer token." },
      },
    },
    paths,
    "x-cerefox-coverage": {
      routes: routes.length,
      withResponseSchema: withSchema,
      queryParameters: queryParams,
      note:
        "Routes without a response schema are listed with their parameters and summary only. " +
        "Nothing is invented; see `uncovered`.",
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
