/**
 * Are the `/api/v1` schemas TRUE? (#270)
 *
 * `docs/api/openapi.json` is generated from the zod schemas in
 * `_shared/schemas/`, and `_shared/__tests__/api-openapi-spec.test.ts` checks
 * that the artifact is current. Neither says whether the schemas match what the
 * server actually returns — and nothing enforces that link, because the route
 * handlers do not parse with these schemas. They are consumed by the frontend
 * and by tests. So the shapes describe INTENT, and intent can drift from a
 * handler silently.
 *
 * That is the failure this file exists for. A spec that documents a field the
 * server stopped sending is worse than no spec: a consumer generating a client
 * from it produces code that compiles and breaks at runtime, and the spec looks
 * authoritative while being wrong.
 *
 * So: start a real server, call each documented endpoint, and `safeParse` the
 * real body with the schema the spec was built from. A mismatch here means
 * either the schema is stale or the handler changed — both worth failing for.
 *
 * Reads only. Nothing here writes, so it does not need the production-write
 * guard, but it does need a reachable store, hence `probeSupabase()`.
 */

import { afterAll, beforeAll, describe, expect } from "bun:test";

import { LIVE_TEST_BUDGET_MS, liveTest } from "../_live-test.ts";
import { probeSupabase, spawnWebServer, type SpawnedServer } from "./_helpers.js";
import * as S from "../../../../_shared/schemas/index.ts";

const LIVE_OK = probeSupabase();

/** One documented endpoint and the schema the spec claims for it. */
interface Case {
  name: string;
  path: (ctx: Ctx) => string | null;
  schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: unknown[]; message: string }> } } };
  /** The endpoint returns an array; check its first element. */
  array?: boolean;
}
interface Ctx {
  docId: string | null;
  projectId: string | null;
}

const CASES: Case[] = [
  { name: "GET /version", path: () => "/version", schema: S.VersionResponse },
  { name: "GET /schema-version", path: () => "/schema-version", schema: S.SchemaVersionResponse },
  { name: "GET /search", path: () => "/search?q=cerefox&limit=2", schema: S.SearchResponse },
  { name: "GET /dashboard", path: () => "/dashboard", schema: S.DashboardResponse },
  { name: "GET /projects", path: () => "/projects", schema: S.ProjectResponse, array: true },
  { name: "GET /metadata-keys", path: () => "/metadata-keys", schema: S.MetadataKeyResponse, array: true },
  { name: "GET /documents/trash", path: () => "/documents/trash?limit=2", schema: S.TrashedDoc, array: true },
  { name: "GET /audit-log", path: () => "/audit-log?limit=2", schema: S.AuditEntryResponse, array: true },
  { name: "GET /usage-log", path: () => "/usage-log?limit=2", schema: S.UsageLogEntryResponse, array: true },
  { name: "GET /usage-log/summary", path: () => "/usage-log/summary", schema: S.UsageSummaryResponse },
  { name: "GET /docs", path: () => "/docs", schema: S.BundledDocEntry, array: true },
  { name: "GET /check-filename", path: () => "/check-filename?title=Cerefox", schema: S.FilenameCheckResponse },
  { name: "GET /resolve-link", path: () => "/resolve-link?path=Cerefox", schema: S.ResolveLinkResponse },
  { name: "GET /config", path: () => "/config", schema: S.ConfigListResponse },
  { name: "GET /config/{key}", path: () => "/config/usage_tracking_enabled", schema: S.ConfigValueResponse },
  { name: "GET /preferences", path: () => "/preferences", schema: S.PreferencesResponse },
  { name: "GET /documents/{id}", path: (c) => (c.docId ? `/documents/${c.docId}` : null), schema: S.DocumentDetailResponse },
  { name: "GET /documents/{id}/chunks", path: (c) => (c.docId ? `/documents/${c.docId}/chunks` : null), schema: S.ChunkResponse, array: true },
  { name: "GET /documents/{id}/versions", path: (c) => (c.docId ? `/documents/${c.docId}/versions` : null), schema: S.DocumentVersionResponse, array: true },
  { name: "GET /projects/{id}/documents", path: (c) => (c.projectId ? `/projects/${c.projectId}/documents` : null), schema: S.ProjectDocumentsResponse },
];

describe("the /api/v1 schemas match what the server returns (#270)", () => {
  let server: SpawnedServer | null = null;
  const ctx: Ctx = { docId: null, projectId: null };

  beforeAll(async () => {
    if (!LIVE_OK) return;
    server = await spawnWebServer();
    if (!server) return;
    // Discover real ids so the parameterised paths address real rows. A store
    // with no documents simply skips those cases rather than failing.
    try {
      const projects = (await (await fetch(`${server.base}/api/v1/projects`)).json()) as Array<{ id: string }>;
      ctx.projectId = projects[0]?.id ?? null;
      const search = (await (await fetch(`${server.base}/api/v1/search?q=cerefox&limit=1`)).json()) as {
        results?: Array<{ document_id: string }>;
      };
      ctx.docId = search.results?.[0]?.document_id ?? null;
    } catch {
      /* leave ids null; the affected cases self-skip */
    }
  }, LIVE_TEST_BUDGET_MS);

  afterAll(async () => {
    if (server) await server.stop();
  }, LIVE_TEST_BUDGET_MS);

  liveTest("every documented response shape parses against a real response", async () => {
    if (!LIVE_OK || !server) return;

    const failures: string[] = [];
    let checked = 0;

    for (const c of CASES) {
      const path = c.path(ctx);
      if (path === null) continue; // no id available on this store
      const resp = await fetch(`${server.base}/api/v1${path}`);
      if (!resp.ok) {
        failures.push(`${c.name}: HTTP ${resp.status}`);
        continue;
      }
      const body: unknown = await resp.json();
      const target = c.array ? (Array.isArray(body) ? body[0] : undefined) : body;
      if (c.array && target === undefined) continue; // empty collection, nothing to assert
      checked++;
      const res = c.schema.safeParse(target);
      if (!res.success) {
        const issues = (res.error?.issues ?? [])
          .slice(0, 3)
          .map((i) => `${(i.path as string[]).join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        failures.push(`${c.name}: ${issues}`);
      }
    }

    // Report every mismatch at once: fixing them one failed run at a time is how
    // a drifted schema set takes a whole afternoon.
    expect(failures).toEqual([]);
    // A run that asserted nothing would pass the line above vacuously — the same
    // vacuous-guard shape this project has been bitten by repeatedly.
    expect(checked).toBeGreaterThanOrEqual(12);
  }, LIVE_TEST_BUDGET_MS);

  liveTest("a response missing a documented field is caught", async () => {
    if (!LIVE_OK || !server) return;
    // Proves the assertion above can fail. The schemas are only worth anything
    // if safeParse actually rejects a body that lost a field.
    const real = (await (await fetch(`${server.base}/api/v1/version`)).json()) as Record<string, unknown>;
    expect(S.VersionResponse.safeParse(real).success).toBe(true);
    const { version: _dropped, ...withoutVersion } = real;
    expect(S.VersionResponse.safeParse(withoutVersion).success).toBe(false);
  }, LIVE_TEST_BUDGET_MS);
});
