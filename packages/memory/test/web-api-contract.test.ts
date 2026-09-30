/**
 * The `/api/v1` write contract, at the HTTP boundary, against a mocked store
 * (#296).
 *
 * Each case here is a place the handler and its published contract disagreed:
 * a delete conflict answering 500, `POST /ingest` ignoring the concurrency
 * token so an update by id could never succeed, refusals answering 200,
 * unknown fields silently dropped, an archive of a version that does not exist
 * answering 200. The pipeline is spied on rather than run, so these assert what
 * the ROUTE passes on, which is exactly where the bugs were.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { IngestionPipeline } from "../src/ingestion/pipeline.ts";
import { ConcurrencyConflictError } from "../src/ingestion/types.ts";
import { COMPATIBILITY, compareSemver } from "../../../_shared/compatibility/index.ts";
import { buildApp } from "../src/web/server.ts";

process.env.NODE_ENV = "test";

const DOC = "11111111-1111-1111-1111-111111111111";
const VER = "22222222-2222-2222-2222-222222222222";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

interface StoreState {
  /** What `.maybeSingle()` returns, per table, given the recorded filters. */
  rows: Record<string, (filters: Record<string, unknown>) => unknown>;
  rpc: (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown };
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
}

function fakeStore(state: Partial<StoreState> = {}): StoreState & { client: unknown } {
  const s: StoreState = {
    rows: state.rows ?? {},
    rpc: state.rpc ?? (() => ({ data: null, error: null })),
    rpcCalls: [],
  };
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      s.rpcCalls.push({ name, args });
      return s.rpc(name, args);
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const q: Record<string, unknown> = {};
      const chain = () => q;
      for (const m of ["select", "update", "order", "limit", "range", "is", "not", "in"]) q[m] = chain;
      q.eq = (col: string, val: unknown) => {
        filters[col] = val;
        return q;
      };
      q.maybeSingle = async () => ({ data: s.rows[table]?.(filters) ?? null, error: null });
      q.then = undefined;
      return q;
    },
  };
  return { ...s, client, get rpcCalls() { return s.rpcCalls; } };
}

function app(store: { client: unknown }) {
  return buildApp({ supabase: store.client, openAiApiKey: "sk-test", settings: {} } as never);
}

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
});

function spyIngest(impl?: (opts: Record<string, unknown>) => unknown) {
  const calls: Array<Record<string, unknown>> = [];
  const spy = spyOn(IngestionPipeline.prototype, "ingestText").mockImplementation((async (
    opts: Record<string, unknown>,
  ) => {
    calls.push(opts);
    if (impl) return impl(opts);
    return { documentId: DOC, title: String(opts.title), action: "updated", reindexed: true };
  }) as never);
  spies.push(spy);
  return calls;
}

// ── DELETE /documents/{id} ──────────────────────────────────────────────────

describe("DELETE /documents/{id}", () => {
  test("a stale hash is a 409 with current_hash, not a 500", async () => {
    const store = fakeStore({
      rpc: () => ({
        data: null,
        error: {
          code: "PT409",
          message: `CEREFOX_CONFLICT: document ${DOC} changed since it was read (expected hash ${HASH_A}, current hash ${HASH_B})`,
        },
      }),
    });
    const r = await app(store).request(`/api/v1/documents/${DOC}`, {
      method: "DELETE",
      headers: { "X-Cerefox-Author": "example-bot", "X-Cerefox-Expected-Content-Hash": HASH_A },
    });
    expect(r.status).toBe(409);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.current_hash).toBe(HASH_B);
    expect(String(body.detail)).toContain("CEREFOX_CONFLICT");
  });

  test("a named caller without a hash is a 400, and the RPC is never called", async () => {
    const store = fakeStore();
    const r = await app(store).request(`/api/v1/documents/${DOC}`, {
      method: "DELETE",
      headers: { "X-Cerefox-Author": "example-bot" },
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { detail: string }).detail).toContain("CEREFOX_TOKEN_REQUIRED");
    expect(store.rpcCalls).toHaveLength(0);
  });

  test("the hash is accepted as a query parameter too", async () => {
    const store = fakeStore({ rpc: () => ({ data: { already_deleted: false }, error: null }) });
    const r = await app(store).request(`/api/v1/documents/${DOC}?expected_content_hash=${HASH_A}`, {
      method: "DELETE",
      headers: { "X-Cerefox-Author": "example-bot" },
    });
    expect(r.status).toBe(200);
    expect(store.rpcCalls[0]!.args.p_expected_content_hash).toBe(HASH_A);
  });
});

// ── DELETE /documents/{id}/purge ────────────────────────────────────────────

describe("DELETE /documents/{id}/purge", () => {
  test("an id that does not exist is a 404, not purged:true", async () => {
    const store = fakeStore();
    const r = await app(store).request(`/api/v1/documents/${DOC}/purge`, { method: "DELETE" });
    expect(r.status).toBe(404);
    expect(store.rpcCalls).toHaveLength(0);
  });
});

// ── POST /documents/{id}/versions/{vid}/archive ─────────────────────────────

describe("POST /documents/{id}/versions/{vid}/archive", () => {
  test("a version that is not this document's is a 404 and writes no audit entry", async () => {
    const store = fakeStore({ rows: { cerefox_document_versions: () => null } });
    const r = await app(store).request(
      `/api/v1/documents/${DOC}/versions/${VER}/archive`,
      json({ archived: true }),
    );
    expect(r.status).toBe(404);
    expect(store.rpcCalls.filter((c) => c.name === "cerefox_create_audit_entry")).toHaveLength(0);
  });

  test("the update is scoped to the document in the path", async () => {
    let seen: Record<string, unknown> = {};
    const store = fakeStore({
      rows: {
        cerefox_document_versions: (f) => {
          seen = { ...f };
          return { document_id: DOC, version_number: 3 };
        },
      },
    });
    const r = await app(store).request(
      `/api/v1/documents/${DOC}/versions/${VER}/archive`,
      json({ archived: false }),
    );
    expect(r.status).toBe(200);
    expect(seen).toEqual({ id: VER, document_id: DOC });
  });

  test('"archived" must be a boolean — the string "false" no longer archives', async () => {
    const store = fakeStore();
    const r = await app(store).request(
      `/api/v1/documents/${DOC}/versions/${VER}/archive`,
      json({ archived: "false" }),
    );
    expect(r.status).toBe(400);
  });
});

// ── POST /ingest ────────────────────────────────────────────────────────────

describe("POST /ingest", () => {
  test("forwards the concurrency token and last_write_wins (update by id was impossible)", async () => {
    const calls = spyIngest();
    const r = await app(fakeStore()).request(
      "/api/v1/ingest",
      json({ title: "T", content: "body", document_id: DOC, expected_content_hash: HASH_A }),
    );
    expect(r.status).toBe(200);
    expect(calls[0]!.expectedContentHash).toBe(HASH_A);
    expect(calls[0]!.documentId).toBe(DOC);

    await app(fakeStore()).request(
      "/api/v1/ingest",
      json({ title: "T", content: "body", document_id: DOC, last_write_wins: true }),
    );
    expect(calls[1]!.lastWriteWins).toBe(true);
  });

  test("update_if_exists reaches the pipeline as sent: absent stays undefined", async () => {
    // The pipeline's override note depends on telling "not sent" from "false".
    const calls = spyIngest();
    const send = (extra: Record<string, unknown>) =>
      app(fakeStore()).request(
        "/api/v1/ingest",
        json({ title: "T", content: "body", document_id: DOC, last_write_wins: true, ...extra }),
      );
    await send({});
    await send({ update_if_exists: false });
    await send({ update_existing: true });
    expect(calls.map((c) => c.updateExisting)).toEqual([undefined, false, true]);
  });

  test("honours every field the published contract lists", async () => {
    const calls = spyIngest();
    const r = await app(fakeStore()).request(
      "/api/v1/ingest",
      json({
        title: "T",
        content: "body",
        update_if_exists: true,
        project_name: "P",
        project_names: ["Q", "R"],
        source: "agent-sync",
        metadata: { type: "note" },
      }),
    );
    expect(r.status).toBe(200);
    expect(calls[0]).toMatchObject({
      updateExisting: true,
      projectName: "P",
      projectNames: ["Q", "R"],
      source: "agent-sync",
      metadata: { type: "note" },
    });
  });

  test("the bundled web UI's payload is still accepted unchanged", async () => {
    const calls = spyIngest();
    const r = await app(fakeStore()).request(
      "/api/v1/ingest",
      json({ mode: "paste", title: "T", content: "body", update_existing: false, project_ids: [], metadata: {} }),
    );
    expect(r.status).toBe(200);
    expect(calls[0]!.source).toBe("paste");
  });

  test("an unknown field is a 400 naming it, not a silent drop", async () => {
    const calls = spyIngest();
    const r = await app(fakeStore()).request(
      "/api/v1/ingest",
      json({ title: "T", content: "body", update_if_exist: true }),
    );
    expect(r.status).toBe(400);
    expect(((await r.json()) as { detail: string }).detail).toContain("update_if_exist");
    expect(calls).toHaveLength(0);
  });

  test("a missing title or empty content is a 400, not 200 success:false", async () => {
    spyIngest();
    const a = await app(fakeStore()).request("/api/v1/ingest", json({ title: "", content: "x" }));
    const b = await app(fakeStore()).request("/api/v1/ingest", json({ title: "T", content: "  " }));
    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
  });

  test("wrong types are a 400 before anything is written", async () => {
    const calls = spyIngest();
    for (const bad of [
      { metadata: "type=note" },
      { project_ids: "abc" },
      { last_write_wins: "true" },
      { expected_content_hash: 42 },
    ]) {
      const r = await app(fakeStore()).request("/api/v1/ingest", json({ title: "T", content: "x", ...bad }));
      expect(r.status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  test("caller-state failures map to 404 / 409 / 409, not 500", async () => {
    const cases: Array<[() => never, number]> = [
      [() => { throw new Error(`Document not found: ${DOC}`); }, 404],
      [() => { throw new Error(`Document ${DOC} ("T") is soft-deleted (in the trash).`); }, 409],
      [() => { throw new ConcurrencyConflictError(DOC, HASH_B, "CEREFOX_CONFLICT"); }, 409],
    ];
    for (const [impl, status] of cases) {
      spyIngest(impl);
      const r = await app(fakeStore()).request(
        "/api/v1/ingest",
        json({ title: "T", content: "x", document_id: DOC, expected_content_hash: HASH_A }),
      );
      expect(r.status).toBe(status);
      spies.pop()!.mockRestore();
    }
  });
});

// ── POST /documents/{id}/edit ───────────────────────────────────────────────

describe("POST /documents/{id}/edit", () => {
  const current = () => ({
    id: DOC,
    title: "T",
    content_hash: HASH_B,
    deleted_at: null,
    metadata: {},
  });

  test("a stale hash is refused on the metadata-only branch too", async () => {
    const store = fakeStore({ rows: { cerefox_documents: current } });
    const r = await app(store).request(
      `/api/v1/documents/${DOC}/edit`,
      json({ title: "T", content: "", metadata: { a: "1" }, expected_content_hash: HASH_A }),
    );
    expect(r.status).toBe(409);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.current_hash).toBe(HASH_B);
    expect(typeof body.detail).toBe("string");
  });

  test("last_write_wins is forwarded to the pipeline", async () => {
    const calls: Array<Record<string, unknown>> = [];
    spies.push(
      spyOn(IngestionPipeline.prototype, "updateDocument").mockImplementation((async (
        o: Record<string, unknown>,
      ) => {
        calls.push(o);
        return { documentId: DOC, title: "T", action: "updated", reindexed: true };
      }) as never),
    );
    const store = fakeStore({ rows: { cerefox_documents: current } });
    const r = await app(store).request(
      `/api/v1/documents/${DOC}/edit`,
      json({ title: "T", content: "new body", last_write_wins: true }),
    );
    expect(r.status).toBe(200);
    expect(calls[0]!.lastWriteWins).toBe(true);
  });

  test("an unknown field is a 400", async () => {
    const store = fakeStore({ rows: { cerefox_documents: current } });
    const r = await app(store).request(
      `/api/v1/documents/${DOC}/edit`,
      json({ title: "T", content: "", expected_hash: HASH_B }),
    );
    expect(r.status).toBe(400);
  });
});

// ── GET /schema-version (#301) ──────────────────────────────────────────────

describe("GET /schema-version", () => {
  const at = async (deployed: string) => {
    const store = fakeStore({ rpc: (name) => (name === "cerefox_schema_version" ? { data: deployed, error: null } : { data: null, error: null }) });
    return (await (await app(store).request("/api/v1/schema-version")).json()) as {
      bundled: string | null;
      deployed: string;
      mismatch: boolean;
      level: string;
    };
  };

  test("reports the bundled version", async () => {
    expect((await at("0.16.2")).bundled).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("mismatch only when the deployed schema is OLDER than the client's", async () => {
    const bundled = (await at("0.0.0")).bundled!;
    const newer = `${Number(bundled.split(".")[0]) + 1}.0.0`;
    const equal = await at(bundled);
    expect({ mismatch: equal.mismatch, level: equal.level }).toEqual({ mismatch: false, level: "ok" });
    // An older client against a newer server needs no redeploy: no banner.
    const ahead = await at(newer);
    expect({ mismatch: ahead.mismatch, level: ahead.level }).toEqual({ mismatch: false, level: "ok" });
    // At the minimum but below the client's bundled version: redeploy needed.
    // The minimum is below the bundled version whenever the schema has moved on
    // since the last minimum raise, which is the steady state; assert that too,
    // so this case can never pass without asserting anything.
    expect(compareSemver(COMPATIBILITY.minSchema, bundled)).toBeLessThan(0);
    const behind = await at(COMPATIBILITY.minSchema);
    expect({ mismatch: behind.mismatch, level: behind.level }).toEqual({ mismatch: true, level: "above-min-but-old" });
  });
});

// ── Self-description (#303) ─────────────────────────────────────────────────

describe("GET /openapi.json and the service-desc Link", () => {
  const LINK = '</api/v1/openapi.json>; rel="service-desc"';

  test("serves the committed OpenAPI document, byte for byte", async () => {
    const r = await app(fakeStore()).request("/api/v1/openapi.json");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/json");
    const committed = readFileSync(join(import.meta.dir, "..", "..", "..", "docs", "api", "openapi.json"), "utf8");
    expect(await r.text()).toBe(committed);
  });

  test("every /api/v1 response points at it (RFC 8631), errors included", async () => {
    const a = app(fakeStore());
    const ok = await a.request("/api/v1/version");
    const notFound = await a.request(`/api/v1/documents/${DOC}/purge`, { method: "DELETE" });
    const bad = await a.request("/api/v1/ingest", json({ title: "T", content: "x", bogus: 1 }));
    expect([ok.status, notFound.status, bad.status]).toEqual([200, 404, 400]);
    for (const r of [ok, notFound, bad]) expect(r.headers.get("link")).toBe(LINK);
  });
});
