/**
 * The `/api/v1` write contract against a REAL server and store (#296).
 *
 * `web-api-contract.test.ts` pins each handler fix against a mocked store; this
 * walks the same contract end to end as an identified API caller would, and
 * parses every write response with the schema the OpenAPI document publishes —
 * including the undocumented-field check, since the write shapes were never
 * verified live before.
 *
 * Writes real documents, so it carries the production-write guard. Every
 * fixture is `[E2E`-prefixed and purged in afterAll.
 */

import { afterAll, beforeAll, describe, expect } from "bun:test";

import { LIVE_TEST_BUDGET_MS, liveTest } from "../_live-test.ts";
import { mayWriteToLiveTarget } from "../_live-target-guard.ts";
import { undocumentedKeys } from "../_schema-keys.ts";
import { probeSupabase, spawnWebServer, type SpawnedServer } from "./_helpers.js";
import * as S from "../../../../_shared/schemas/index.ts";

const LIVE_OK = mayWriteToLiveTarget() && probeSupabase();
const AGENT = { "X-Cerefox-Author": "e2e-api-contract", "X-Cerefox-Author-Type": "user" };
const STALE = "0".repeat(64);

type Json = Record<string, unknown>;

/** Parse against the published schema, and fail on any undocumented field. */
function conforms(schema: Parameters<typeof undocumentedKeys>[0] & { safeParse: (v: unknown) => { success: boolean } }, body: unknown): void {
  expect({ parses: schema.safeParse(body).success, undocumented: undocumentedKeys(schema, body) }).toEqual({
    parses: true,
    undocumented: [],
  });
}

describe("the /api/v1 write contract, live (#296)", () => {
  let server: SpawnedServer | null = null;
  const created: string[] = [];
  const title = `[E2E api-contract] ${Date.now()}`;
  let docId = "";

  const api = (path: string, init: RequestInit = {}) =>
    fetch(`${server!.base}/api/v1${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...AGENT, ...(init.headers ?? {}) },
    });
  const post = (path: string, body: unknown) => api(path, { method: "POST", body: JSON.stringify(body) });
  const hashOf = async (id: string) => ((await (await api(`/documents/${id}`)).json()) as Json).content_hash as string;

  beforeAll(async () => {
    if (!LIVE_OK) return;
    server = await spawnWebServer();
  }, LIVE_TEST_BUDGET_MS);

  afterAll(async () => {
    if (server) {
      for (const id of created) {
        try {
          const h = await hashOf(id).catch(() => "");
          await api(`/documents/${id}?expected_content_hash=${h}`, { method: "DELETE" });
          await api(`/documents/${id}/purge`, { method: "DELETE" });
        } catch {
          /* best effort */
        }
      }
      await server.stop();
    }
  }, LIVE_TEST_BUDGET_MS);

  liveTest("create, then read: the document carries its content_hash", async () => {
    if (!LIVE_OK || !server) return;
    const r = await post("/ingest", { title, content: "# One\n\nFirst body.\n" });
    expect(r.status).toBe(200);
    const body = (await r.json()) as Json;
    conforms(S.IngestResponse, body);
    docId = body.document_id as string;
    created.push(docId);

    const doc = (await (await api(`/documents/${docId}`)).json()) as Json;
    conforms(S.DocumentDetailResponse, doc);
    expect(doc.content_hash).toMatch(/^[0-9a-f]{64}$/);
  }, LIVE_TEST_BUDGET_MS);

  liveTest("update by document_id: stale hash 409, no hash 400, current hash 200", async () => {
    if (!LIVE_OK || !server || !docId) return;
    const content = "# One\n\nSecond body.\n";
    const stale = await post("/ingest", { title, content, document_id: docId, expected_content_hash: STALE });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as Json).current_hash).toMatch(/^[0-9a-f]{64}$/);

    const none = await post("/ingest", { title, content, document_id: docId });
    expect(none.status).toBe(400);

    // The case that could not succeed before v1.15.2: the route never read the hash.
    const ok = await post("/ingest", { title, content, document_id: docId, expected_content_hash: await hashOf(docId) });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Json;
    conforms(S.IngestResponse, body);
    expect(body.updated).toBe(true);
  }, LIVE_TEST_BUDGET_MS);

  liveTest("update_if_exists matches by title and honours last_write_wins", async () => {
    if (!LIVE_OK || !server || !docId) return;
    const r = await post("/ingest", { title, content: "# One\n\nThird body.\n", update_if_exists: true, last_write_wins: true });
    expect(r.status).toBe(200);
    const body = (await r.json()) as Json;
    expect(body.document_id).toBe(docId); // an update, not a second document
    expect(body.updated).toBe(true);
  }, LIVE_TEST_BUDGET_MS);

  liveTest("an unknown field is refused before anything is written", async () => {
    if (!LIVE_OK || !server) return;
    const r = await post("/ingest", { title: `${title} unknown`, content: "x", update_if_exist: true });
    expect(r.status).toBe(400);
    expect(((await r.json()) as Json).detail).toContain("update_if_exist");
  }, LIVE_TEST_BUDGET_MS);

  liveTest("edit: a stale hash is refused on the metadata-only branch; the current one succeeds", async () => {
    if (!LIVE_OK || !server || !docId) return;
    const stale = await post(`/documents/${docId}/edit`, { metadata: { e2e: "1" }, expected_content_hash: STALE });
    expect(stale.status).toBe(409);
    const ok = await post(`/documents/${docId}/edit`, { metadata: { e2e: "1" }, expected_content_hash: await hashOf(docId) });
    expect(ok.status).toBe(200);
    conforms(S.EditResponse, await ok.json());
  }, LIVE_TEST_BUDGET_MS);

  liveTest("archive: a version that is not this document's is a 404", async () => {
    if (!LIVE_OK || !server || !docId) return;
    const r = await post(`/documents/${docId}/versions/${crypto.randomUUID()}/archive`, { archived: true });
    expect(r.status).toBe(404);
  }, LIVE_TEST_BUDGET_MS);

  liveTest("delete: no hash 400, stale 409, current 200; restore; purge; purge again 404", async () => {
    if (!LIVE_OK || !server || !docId) return;
    expect((await api(`/documents/${docId}`, { method: "DELETE" })).status).toBe(400);

    // Was a 500 before v1.15.2.
    const stale = await api(`/documents/${docId}`, {
      method: "DELETE",
      headers: { "X-Cerefox-Expected-Content-Hash": STALE },
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as Json).current_hash).toMatch(/^[0-9a-f]{64}$/);

    const del = await api(`/documents/${docId}?expected_content_hash=${await hashOf(docId)}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    conforms(S.DeleteResponse, await del.json());

    const restore = await api(`/documents/${docId}/restore`, { method: "POST" });
    expect(restore.status).toBe(200);
    conforms(S.RestoreResponse, await restore.json());

    await api(`/documents/${docId}?expected_content_hash=${await hashOf(docId)}`, { method: "DELETE" });
    const purge = await api(`/documents/${docId}/purge`, { method: "DELETE" });
    expect(purge.status).toBe(200);
    const purged = (await purge.json()) as Json;
    conforms(S.PurgeResponse, purged);
    expect(purged.purged).toBe(true);

    // Was `purged: true` for an id that no longer exists.
    expect((await api(`/documents/${docId}/purge`, { method: "DELETE" })).status).toBe(404);
  }, LIVE_TEST_BUDGET_MS);
});
