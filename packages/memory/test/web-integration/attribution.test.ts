/**
 * HTTP-boundary tests for caller attribution on `/api/v1` (iter-40, #226).
 *
 * The unit tests in `../web-identity.test.ts` pin the resolver. These prove the
 * part that a unit test cannot: that what the resolver decided actually reaches
 * `cerefox_audit_log` and `cerefox_usage_log` through a real HTTP request
 * against a real database, and that omitting the parameters writes the same
 * rows the pre-#226 code wrote.
 *
 * The compatibility case is the one that matters most here. "It still works"
 * is not the claim; the claim is that the stored row is unchanged, so the
 * assertion is on the row, not on the response.
 *
 * Probe-and-skip when Supabase + OpenAI aren't both reachable, and refuses an
 * unlabelled (production) target like every other write-bearing suite.
 * Self-cleaning via the `[E2E web-attr]` title prefix.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { probeSupabase, spawnWebServer, type SpawnedServer } from "./_helpers.js";
import { loadEnv } from "../../../../_shared/config/index.js";
import { mayWriteToLiveTarget } from "../_live-target-guard.ts";

loadEnv();

const SUPABASE_URL = process.env.CEREFOX_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.CEREFOX_SUPABASE_KEY ?? "";
const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || process.env.CEREFOX_OPENAI_API_KEY || "";

const LIVE_OK =
  mayWriteToLiveTarget() &&
  probeSupabase() &&
  SUPABASE_URL.length > 0 &&
  SUPABASE_KEY.length > 0 &&
  OPENAI_API_KEY.length > 0;

const TITLE_PREFIX = "[E2E web-attr]";
const RUN_TAG = String(Date.now());

interface AuditRow {
  author: string;
  author_type: string;
  operation: string;
}

interface UsageRow {
  requestor: string;
  access_path: string;
  operation: string;
}

describe("/api/v1 caller attribution (HTTP boundary)", () => {
  let server: SpawnedServer | null = null;
  let admin: SupabaseClient | null = null;
  /** null until probed; usage logging is opt-in via cerefox_config. */
  let usageTracked = false;
  const created: string[] = [];

  beforeAll(async () => {
    if (!LIVE_OK) return;
    server = await spawnWebServer();
    admin = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });
    // Usage logging is opt-in (`usage_tracking_enabled`). Read it rather than
    // set it: flipping an operator's config to make a test pass would leave
    // the environment changed, and the audit assertions carry the suite
    // regardless.
    try {
      const { data } = await admin.rpc("cerefox_get_config", {
        p_key: "usage_tracking_enabled",
      });
      usageTracked = String(data ?? "").toLowerCase() === "true";
    } catch {
      usageTracked = false;
    }
  });

  afterAll(async () => {
    if (admin) {
      for (const id of created) {
        try {
          await admin.rpc("cerefox_delete_document", {
            p_document_id: id,
            p_author: "web-attr-test",
            p_author_type: "user",
          });
          await admin.rpc("cerefox_purge_document", {
            p_document_id: id,
            p_author: "web-attr-test",
            p_author_type: "user",
          });
        } catch {
          /* swallow */
        }
      }
    }
    await server?.stop();
  });

  /** Ingest through the HTTP API with the given extra headers. */
  async function ingest(
    title: string,
    headers: Record<string, string> = {},
    extraBody: Record<string, unknown> = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const resp = await fetch(`${server!.base}/api/v1/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        title,
        content: `# ${title}\n\nAttribution fixture, run ${RUN_TAG}.\n`,
        ...extraBody,
      }),
    });
    const body = (await resp.json()) as Record<string, unknown>;
    if (typeof body.document_id === "string") created.push(body.document_id);
    return { status: resp.status, body };
  }

  async function auditFor(documentId: string): Promise<AuditRow[]> {
    const { data } = await admin!
      .from("cerefox_audit_log")
      .select("author, author_type, operation")
      .eq("document_id", documentId);
    return (data ?? []) as AuditRow[];
  }

  async function usageFor(documentId: string): Promise<UsageRow[]> {
    const { data } = await admin!
      .from("cerefox_usage_log")
      .select("requestor, access_path, operation")
      .eq("document_id", documentId);
    return (data ?? []) as UsageRow[];
  }

  test.skipIf(!LIVE_OK)(
    "no identity supplied writes exactly the pre-#226 row",
    async () => {
      if (!server) return;
      const title = `${TITLE_PREFIX} default ${RUN_TAG}`;
      const { status, body } = await ingest(title);
      expect(status).toBe(200);
      const id = body.document_id as string;
      expect(id).toBeTruthy();

      const audit = await auditFor(id);
      expect(audit.length).toBeGreaterThan(0);
      // The compatibility promise, asserted on what was stored.
      for (const row of audit) {
        expect(row.author).toBe("web-ui");
        expect(row.author_type).toBe("user");
      }

      // author_type "user" means the document is approved, not queued.
      const { data: doc } = await admin!
        .from("cerefox_documents")
        .select("review_status")
        .eq("id", id)
        .maybeSingle();
      expect((doc as { review_status: string } | null)?.review_status).toBe("approved");

      if (usageTracked) {
        const usage = await usageFor(id);
        expect(usage.length).toBeGreaterThan(0);
        for (const row of usage) {
          expect(row.access_path).toBe("webapp");
          expect(row.requestor).toBe("web-ui");
        }
      }
    },
  );

  test.skipIf(!LIVE_OK)(
    "a named caller is recorded as itself, on the api path",
    async () => {
      if (!server) return;
      const title = `${TITLE_PREFIX} named ${RUN_TAG}`;
      const { status, body } = await ingest(title, {
        "X-Cerefox-Author": "e2e-attr-bot",
        "X-Cerefox-Author-Type": "agent",
      });
      expect(status).toBe(200);
      const id = body.document_id as string;

      const audit = await auditFor(id);
      expect(audit.length).toBeGreaterThan(0);
      for (const row of audit) {
        expect(row.author).toBe("e2e-attr-bot");
        expect(row.author_type).toBe("agent");
      }

      // The documented consequence of author_type=agent, identical to MCP:
      // an agent-authored ingest lands in pending_review rather than approved.
      // Asserted because it is the behaviour most likely to surprise someone,
      // and because it is the proof that "matches MCP semantics" is real
      // rather than aspirational.
      const { data: doc } = await admin!
        .from("cerefox_documents")
        .select("review_status")
        .eq("id", id)
        .maybeSingle();
      expect((doc as { review_status: string } | null)?.review_status).toBe(
        "pending_review",
      );

      if (usageTracked) {
        const usage = await usageFor(id);
        expect(usage.length).toBeGreaterThan(0);
        for (const row of usage) {
          expect(row.access_path).toBe("api");
          expect(row.requestor).toBe("e2e-attr-bot");
        }
      }
    },
  );

  test.skipIf(!LIVE_OK)("identity can also travel in the JSON body", async () => {
    if (!server) return;
    const title = `${TITLE_PREFIX} body ${RUN_TAG}`;
    const { status, body } = await ingest(title, {}, { author: "e2e-body-bot" });
    expect(status).toBe(200);
    const audit = await auditFor(body.document_id as string);
    expect(audit.length).toBeGreaterThan(0);
    for (const row of audit) expect(row.author).toBe("e2e-body-bot");
  });

  test.skipIf(!LIVE_OK)("an invalid author_type is a 400, not a 500", async () => {
    if (!server) return;
    // Without boundary validation this reaches the cerefox_audit_log CHECK and
    // surfaces as a raw Postgres error, i.e. a 500 for a caller mistake.
    const resp = await fetch(`${server.base}/api/v1/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cerefox-Author": "e2e-attr-bot",
        "X-Cerefox-Author-Type": "robot",
      },
      body: JSON.stringify({
        title: `${TITLE_PREFIX} invalid ${RUN_TAG}`,
        content: "should never be stored",
      }),
    });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { detail?: string };
    expect(body.detail).toContain("author_type");
  });

  test.skipIf(!LIVE_OK)(
    "an identified caller must present the hash to delete",
    async () => {
      if (!server) return;
      const { body } = await ingest(`${TITLE_PREFIX} del ${RUN_TAG}`);
      const id = body.document_id as string;

      // Named caller, no hash: refused, the same rule MCP enforces.
      const refused = await fetch(`${server.base}/api/v1/documents/${id}`, {
        method: "DELETE",
        headers: { "X-Cerefox-Author": "e2e-attr-bot" },
      });
      expect(refused.status).toBe(400);
      const refusedBody = (await refused.json()) as { detail?: string };
      expect(refusedBody.detail ?? "").toContain("CEREFOX_TOKEN_REQUIRED");

      // Still there.
      const { data: alive } = await admin!
        .from("cerefox_documents")
        .select("deleted_at")
        .eq("id", id)
        .maybeSingle();
      expect((alive as { deleted_at: string | null } | null)?.deleted_at).toBeNull();

      // With the hash it goes through.
      const read = (await (
        await fetch(`${server.base}/api/v1/documents/${id}`)
      ).json()) as { content_hash: string };
      const ok = await fetch(`${server.base}/api/v1/documents/${id}`, {
        method: "DELETE",
        headers: {
          "X-Cerefox-Author": "e2e-attr-bot",
          "X-Cerefox-Expected-Content-Hash": read.content_hash,
        },
      });
      expect(ok.status).toBe(200);
    },
    30_000,
  );

  test.skipIf(!LIVE_OK)(
    "an anonymous delete still works exactly as before",
    async () => {
      if (!server) return;
      // The bundled web UI sends no identity and no hash; it confirms in a
      // dialog instead. That path must not have changed.
      const { body } = await ingest(`${TITLE_PREFIX} anondel ${RUN_TAG}`);
      const id = body.document_id as string;
      const resp = await fetch(`${server.base}/api/v1/documents/${id}`, {
        method: "DELETE",
      });
      expect(resp.status).toBe(200);
    },
    30_000,
  );

  test.skipIf(!LIVE_OK)("a read logs the requestor that asked for it", async () => {
    if (!server) return;
    if (!usageTracked) return; // nothing to assert with tracking off
    const title = `${TITLE_PREFIX} read ${RUN_TAG}`;
    const { body } = await ingest(title);
    const id = body.document_id as string;

    const before = (await usageFor(id)).length;
    const resp = await fetch(`${server.base}/api/v1/documents/${id}`, {
      headers: { "X-Cerefox-Requestor": "e2e-attr-reader" },
    });
    expect(resp.status).toBe(200);

    // Usage logging is fire-and-forget; give it a moment to land.
    let usage: UsageRow[] = [];
    for (let i = 0; i < 20 && usage.length <= before; i += 1) {
      await new Promise((r) => setTimeout(r, 150));
      usage = await usageFor(id);
    }
    const reads = usage.filter((r) => r.operation === "get-document");
    expect(reads.length).toBeGreaterThan(0);
    for (const row of reads) {
      expect(row.requestor).toBe("e2e-attr-reader");
      // A read is the case the old code could not express at all: it logged
      // `webapp`/`web-ui` for every caller.
      expect(row.access_path).toBe("api");
    }
  });
});
