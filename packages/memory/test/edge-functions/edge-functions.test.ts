/**
 * E2E tests for the 8 primitive Cerefox Edge Functions via direct HTTP POST
 * (iter-26 Part 26G — TS port of tests/e2e/test_edge_functions_e2e.py).
 *
 * Tests each EF independently (bypassing cerefox-mcp). Probe-and-skip when
 * Supabase / the access token isn't available. All created documents are
 * prefixed `[E2E-EF]` and purged in afterAll via the purge RPC (audited).
 *
 * Requires CEREFOX_SUPABASE_URL + the Cerefox access token
 * (CEREFOX_ACCESS_TOKEN, set by `cerefox token generate`) + OPENAI_API_KEY
 * set as a Supabase secret (for search/ingest). The EFs validate the token
 * in-function (iter-28E); the legacy anon JWT is no longer accepted.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { loadSettings } from "../../../../_shared/config/index.ts";
import { createClient } from "../../../../_shared/db-client/index.ts";
import { mayWriteToLiveTarget } from "../_live-target-guard.ts";

const E2E_PREFIX = "[E2E-EF]";

const SAMPLE_CONTENT = `# The Meridian Codex

The Meridian Codex is the foundational legal document of the Teliboria Compact.
It establishes the rights and responsibilities of all signatories.

## The Twelve Tenets

The Codex enumerates twelve tenets that govern relations between member nations.
The first tenet establishes freedom of travel across borders for all citizens.

## Enforcement

Violations of the Codex are adjudicated by the Compact High Court in Auraveil.
`;

function uniqueTitle(label: string): string {
  return `${E2E_PREFIX} ${label} ${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * SAMPLE_CONTENT + a unique marker line, so each ingest has a distinct
 * content_hash. Without this, the v0.7 dedup check skips the 2nd+ ingest of
 * identical content within a run, and a freshly-tagged doc is never created.
 */
function uniqueContent(): string {
  return `${SAMPLE_CONTENT}\n<!-- e2e-marker ${crypto.randomUUID()} -->\n`;
}

// ── Resolve access token + base URL (probe-and-skip) ─────────────────────────────
const settings = loadSettings();
const accessToken = settings.accessToken;
const efBase = settings.supabaseUrl
  ? `${settings.supabaseUrl.replace(/\/$/, "")}/functions/v1`
  : "";

interface InvokeResult {
  status: number;
  body: unknown;
}

async function invoke(fn: string, body: Record<string, unknown> = {}): Promise<InvokeResult> {
  const resp = await fetch(`${efBase}/${fn}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: accessToken,
      "Content-Type": "application/json",
    },
    // Tag every call with a `requestor` so usage-log rows from the test suite
    // are attributable to "e2e-test" rather than NULL → "Unknown" in the
    // Analytics word cloud. The primitive EFs log `body.requestor ?? null`.
    // Individual bodies can still override it.
    body: JSON.stringify({ requestor: "e2e-test", ...body }),
  });
  let parsed: unknown = null;
  try {
    parsed = await resp.json();
  } catch {
    parsed = null;
  }
  return { status: resp.status, body: parsed };
}

/** invoke + assert 2xx, returning the parsed body (mirrors raise_for_status). */
async function invokeOk(fn: string, body: Record<string, unknown> = {}): Promise<any> {
  const r = await invoke(fn, body);
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`${fn} returned HTTP ${r.status}: ${JSON.stringify(r.body)}`);
  }
  return r.body;
}

// Opt-in gate: these tests make real Edge Function invocations, which count
// against the (low) Supabase free-tier quota. They're SKIPPED unless
// CEREFOX_LIVE_E2E=1, and the env var is checked BEFORE the reachability
// probe so a default `bun test` makes ZERO Edge Function calls. Run them only
// when changing EF code or for pre-release validation:
//   CEREFOX_LIVE_E2E=1 bun test test/edge-functions/edge-functions.test.ts
const E2E_ENABLED =
  process.env.CEREFOX_LIVE_E2E === "1" && mayWriteToLiveTarget();

// Probe reachability once (only when enabled). The deployed EFs answer POST; a
// network/credential failure or missing access token skips the whole suite.
let LIVE_OK = false;
if (E2E_ENABLED && accessToken && efBase) {
  try {
    const probe = await invoke("cerefox-metadata", {});
    LIVE_OK = probe.status >= 200 && probe.status < 500;
  } catch {
    LIVE_OK = false;
  }
}

const createdIds: string[] = [];
function track(id: unknown): void {
  if (typeof id === "string") createdIds.push(id);
}

describe("Edge Functions (live HTTP)", () => {
  if (!E2E_ENABLED) {
    test.skip("opt-in only — set CEREFOX_LIVE_E2E=1 to run (hits live EFs; consumes free-tier quota)", () => {});
    return;
  }
  if (!LIVE_OK) {
    test.skip("Supabase / access token not available — skipping EF e2e", () => {});
    return;
  }

  afterAll(async () => {
    try {
      const client = createClient(settings);
      for (const id of createdIds) {
        // Full audited lifecycle, matching the acceptance harness: purge has
        // a trash-first guard (it only acts on soft-deleted rows — it is the
        // empty-trash action), so a bare purge of a live doc is a no-op.
        // First attempt purged live docs and left every fixture behind, with
        // the {error} returns unchecked — supabase-js resolves, never
        // throws, so EVERY result must be inspected.
        const { data: doc } = await client.raw
          .from("cerefox_documents")
          .select("content_hash")
          .eq("id", id)
          .maybeSingle();
        if (!doc) continue; // already gone
        const del = await client.raw.rpc("cerefox_delete_document", {
          p_document_id: id,
          p_author: "e2e-test",
          p_author_type: "agent",
          p_expected_content_hash: (doc as { content_hash: string }).content_hash,
          p_reason: "e2e cleanup",
        });
        if (del.error) console.warn("cleanup soft-delete failed:", id, del.error.message);
        const purge = await client.raw.rpc("cerefox_purge_document", {
          p_document_id: id,
          p_author: "e2e-test",
          p_author_type: "agent",
        });
        if (purge.error) console.warn("cleanup purge failed:", id, purge.error.message);
      }
    } catch (err) {
      console.warn("cleanup failed:", err);
    }
  });

  // ── cerefox-search ────────────────────────────────────────────────────────
  describe("cerefox-search", () => {
    test("basic search returns results envelope", async () => {
      const data = await invokeOk("cerefox-search", { query: "knowledge" });
      expect(data).toHaveProperty("results");
      expect(data).toHaveProperty("query");
      expect(data).toHaveProperty("truncated");
    });

    test("metadata_filter narrows results", async () => {
      const title = uniqueTitle("Metadata Filter Test");
      const tag = `mf-${crypto.randomUUID().slice(0, 8)}`;
      const created = await invokeOk("cerefox-ingest", {
        title,
        content: uniqueContent(),
        metadata: { ef_tag: tag },
        author: "e2e-ef-test",
        author_type: "agent",
      });
      track(created.document_id);
      const data = await invokeOk("cerefox-search", {
        query: "Meridian Codex",
        metadata_filter: { ef_tag: tag },
      });
      expect(data).toHaveProperty("results");
    });

    test("unknown project returns 404", async () => {
      const r = await invoke("cerefox-search", {
        query: "anything",
        project_name: `no-such-project-${crypto.randomUUID().slice(0, 8)}`,
      });
      expect(r.status).toBe(404);
    });
  });

  // ── cerefox-ingest ──────────────────────────────────────────────────────
  describe("cerefox-ingest", () => {
    test("creates a document", async () => {
      const title = uniqueTitle("Ingest Create");
      const r = await invokeOk("cerefox-ingest", {
        title,
        content: uniqueContent(),
        author: "e2e-ef-test",
        author_type: "agent",
      });
      expect(typeof r.document_id).toBe("string");
      track(r.document_id);
    });

    test("update_if_exists updates the same doc", async () => {
      const title = uniqueTitle("Ingest Update-If-Exists");
      const r1 = await invokeOk("cerefox-ingest", {
        title,
        content: "# A\n\nv1.",
        update_if_exists: true,
        author: "e2e-ef-test",
        author_type: "agent",
      });
      track(r1.document_id);
      const r2 = await invokeOk("cerefox-ingest", {
        title,
        content: "# A\n\nv2 changed.",
        update_if_exists: true,
        // sole-writer test: bypass the v0.11 concurrency token (no concurrent writer)
        last_write_wins: true,
        author: "e2e-ef-test",
        author_type: "agent",
      });
      expect(r2.document_id).toBe(r1.document_id);
    });

    test("missing title returns 400", async () => {
      const r = await invoke("cerefox-ingest", { content: "Some content" });
      expect(r.status).toBe(400);
    });
  });

  // ── cerefox-metadata ────────────────────────────────────────────────────
  describe("cerefox-metadata", () => {
    test("returns an array of metadata keys", async () => {
      const r = await invokeOk("cerefox-metadata", {});
      expect(Array.isArray(r)).toBe(true);
    });
  });

  // ── cerefox-get-document ──────────────────────────────────────────────────
  describe("cerefox-get-document", () => {
    test("returns full content for a created doc", async () => {
      const title = uniqueTitle("Get Document");
      const ingest = await invokeOk("cerefox-ingest", {
        title,
        content: uniqueContent(),
        author: "e2e-ef-test",
        author_type: "agent",
      });
      track(ingest.document_id);
      const r = await invokeOk("cerefox-get-document", { document_id: ingest.document_id });
      expect(r.document_id).toBe(ingest.document_id);
      expect(typeof r.full_content).toBe("string");
      expect(r.full_content.length).toBeGreaterThan(0);
    });

    test("not-found returns 404", async () => {
      const r = await invoke("cerefox-get-document", { document_id: crypto.randomUUID() });
      expect(r.status).toBe(404);
    });
  });

  // ── cerefox-list-versions ──────────────────────────────────────────────────
  describe("cerefox-list-versions", () => {
    test("returns an array", async () => {
      const title = uniqueTitle("List Versions");
      const r = await invokeOk("cerefox-ingest", {
        title,
        content: uniqueContent(),
        author: "e2e-ef-test",
        author_type: "agent",
      });
      track(r.document_id);
      const versions = await invokeOk("cerefox-list-versions", { document_id: r.document_id });
      expect(Array.isArray(versions)).toBe(true);
    });
  });

  // ── cerefox-get-audit-log ──────────────────────────────────────────────────
  describe("cerefox-get-audit-log", () => {
    test("returns entries", async () => {
      const title = uniqueTitle("Audit Entries");
      const r = await invokeOk("cerefox-ingest", {
        title,
        content: uniqueContent(),
        author: "e2e-ef-test",
        author_type: "agent",
      });
      track(r.document_id);
      const entries = await invokeOk("cerefox-get-audit-log", { limit: 50 });
      expect(Array.isArray(entries)).toBe(true);
    });

    test("operation filter is accepted", async () => {
      const title = uniqueTitle("Audit Filter");
      const r = await invokeOk("cerefox-ingest", {
        title,
        content: uniqueContent(),
        author: "e2e-ef-test",
        author_type: "agent",
      });
      track(r.document_id);
      const entries = await invokeOk("cerefox-get-audit-log", {
        operation: "create",
        limit: 50,
      });
      expect(Array.isArray(entries)).toBe(true);
    });
  });

  // ── cerefox-metadata-search ────────────────────────────────────────────────
  describe("cerefox-metadata-search", () => {
    test("returns matches for a metadata filter", async () => {
      const title = uniqueTitle("MetaSearch Match");
      const tag = `ms-${crypto.randomUUID().slice(0, 8)}`;
      const r = await invokeOk("cerefox-ingest", {
        title,
        content: uniqueContent(),
        metadata: { ef_tag: tag },
        author: "e2e-ef-test",
        author_type: "agent",
      });
      track(r.document_id);
      const result = await invokeOk("cerefox-metadata-search", {
        metadata_filter: { ef_tag: tag },
      });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    test("include_content returns document text", async () => {
      const title = uniqueTitle("MetaSearch Content");
      const tag = `msc-${crypto.randomUUID().slice(0, 8)}`;
      const r = await invokeOk("cerefox-ingest", {
        title,
        content: uniqueContent(),
        metadata: { ef_tag: tag },
        author: "e2e-ef-test",
        author_type: "agent",
      });
      track(r.document_id);
      const result = await invokeOk("cerefox-metadata-search", {
        metadata_filter: { ef_tag: tag },
        include_content: true,
      });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(typeof result[0].content).toBe("string");
    });

    test("empty filter returns 400", async () => {
      const r = await invoke("cerefox-metadata-search", { metadata_filter: {} });
      expect(r.status).toBe(400);
    });

    test("results include project_names", async () => {
      const title = uniqueTitle("MetaSearch Projects");
      const tag = `mp-${crypto.randomUUID().slice(0, 8)}`;
      const r = await invokeOk("cerefox-ingest", {
        title,
        content: uniqueContent(),
        metadata: { ef_tag: tag },
        project_name: "Test Files",
        author: "e2e-ef-test",
        author_type: "agent",
      });
      track(r.document_id);
      const result = await invokeOk("cerefox-metadata-search", {
        metadata_filter: { ef_tag: tag },
      });
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(result[0].project_names)).toBe(true);
      expect(result[0].project_names.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── ID-based ingest ────────────────────────────────────────────────────────
  describe("cerefox-ingest (document_id path)", () => {
    test("document_id routes to update → updated=true", async () => {
      const title = uniqueTitle("ID Update");
      const r1 = await invokeOk("cerefox-ingest", {
        title,
        content: "# ID Update\n\nOriginal.",
        author: "e2e-ef-test",
        author_type: "agent",
      });
      track(r1.document_id);
      const r2 = await invokeOk("cerefox-ingest", {
        title,
        content: "# ID Update\n\nOriginal.\n\n## Added\n\nVia id path.",
        document_id: r1.document_id,
        last_write_wins: true, // sole-writer test (see above)
        author: "e2e-ef-test",
        author_type: "agent",
      });
      expect(r2.updated).toBe(true);
      expect(r2.document_id).toBe(r1.document_id);
    });

    test("document_id pointing at a ghost returns 404", async () => {
      const r = await invoke("cerefox-ingest", {
        title: "Ghost",
        content: "# Ghost\n\nContent.",
        document_id: crypto.randomUUID(),
        author: "e2e-ef-test",
        author_type: "agent",
      });
      expect(r.status).toBe(404);
    });

    test("document_id + update_if_exists=false still updates + returns a note", async () => {
      const title = uniqueTitle("ID Note");
      // uniqueContent() (not fixed strings) so the global content_hash
      // uniqueness constraint isn't tripped by leftovers from a prior run.
      const r1 = await invokeOk("cerefox-ingest", {
        title,
        content: uniqueContent(),
        author: "e2e-ef-test",
        author_type: "agent",
      });
      track(r1.document_id);
      const r2 = await invokeOk("cerefox-ingest", {
        title,
        content: uniqueContent(),
        document_id: r1.document_id,
        update_if_exists: false,
        last_write_wins: true, // sole-writer test (see above)
        author: "e2e-ef-test",
        author_type: "agent",
      });
      expect(r2.updated).toBe(true);
      expect(r2.document_id).toBe(r1.document_id);
      expect(typeof r2.note).toBe("string");
      expect(r2.note.length).toBeGreaterThan(0);
    });
  });
});
