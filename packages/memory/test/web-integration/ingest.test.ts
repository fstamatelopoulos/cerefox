/**
 * HTTP-boundary tests for the 3 ingest endpoints (Part 25F).
 *
 * v0.6 shipped these as 503 stubs. v0.7 (this Part) wires them to the
 * in-process `IngestionPipeline`. This file is the equivalent of v0.6's
 * `destructive.test.ts` — proves the endpoint shape end-to-end, not
 * just the pipeline code in isolation.
 *
 * Probe-and-skip when Supabase + OpenAI aren't both reachable.
 * Self-cleaning via `[E2E web-ingest]` title prefix + final purge.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  probeSupabase,
  spawnWebServer,
  type SpawnedServer,
} from "./_helpers.js";
import { loadEnv } from "../../../../_shared/config/index.js";
import { mayWriteToLiveTarget } from "../_live-target-guard.ts";

loadEnv();

const SUPABASE_URL = process.env.CEREFOX_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.CEREFOX_SUPABASE_KEY ?? "";
const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || process.env.CEREFOX_OPENAI_API_KEY || "";

const LIVE_OK =
  mayWriteToLiveTarget() &&
  (probeSupabase() &&
  SUPABASE_URL.length > 0 &&
  SUPABASE_KEY.length > 0 &&
  OPENAI_API_KEY.length > 0);

const TITLE_PREFIX = "[E2E web-ingest]";
const RUN_TAG = String(Date.now());

describe("web ingest endpoints (HTTP boundary)", () => {
  let server: SpawnedServer | null = null;
  let admin: SupabaseClient | null = null;
  const created: string[] = [];

  beforeAll(async () => {
    if (!LIVE_OK) return;
    server = await spawnWebServer();
    admin = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });
  });

  afterAll(async () => {
    if (admin) {
      for (const id of created) {
        try {
          await admin.rpc("cerefox_delete_document", {
            p_document_id: id,
            p_author: "web-ingest-test",
            p_author_type: "user",
          });
          await admin.rpc("cerefox_purge_document", {
            p_document_id: id,
            p_author: "web-ingest-test",
            p_author_type: "user",
          });
        } catch {
          /* swallow */
        }
      }
    }
    if (server) await server.stop();
  });

  test("setup", () => {
    if (!LIVE_OK) {
      console.log("(skipped: Supabase + OpenAI not both available)");
      return;
    }
    expect(server).not.toBeNull();
  });

  test("POST /api/v1/ingest (paste) creates a new doc", async () => {
    if (!server) return;
    const title = `${TITLE_PREFIX} paste-${RUN_TAG}`;
    const text =
      "# Web paste\n\nA web-paste ingestion via the in-process pipeline. " +
      RUN_TAG;
    const resp = await fetch(`${server.base}/api/v1/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "paste",
        title,
        content: text,
        project_ids: [],
        metadata: {},
      }),
    });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      success: boolean;
      document_id: string;
      title: string;
      skipped: boolean;
    };
    expect(body.success).toBe(true);
    expect(body.skipped).toBe(false);
    expect(body.title).toBe(title);
    expect(body.document_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    created.push(body.document_id);
  });

  test("POST /api/v1/ingest with same content returns success+skipped", async () => {
    if (!server) return;
    const text = `# Dedup-web\n\nWeb-ingest dedup test ${RUN_TAG}.\n`;
    const titleA = `${TITLE_PREFIX} dedup-A-${RUN_TAG}`;
    const titleB = `${TITLE_PREFIX} dedup-B-${RUN_TAG}`;
    const first = await fetch(`${server.base}/api/v1/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "paste", title: titleA, content: text }),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      success: boolean;
      document_id: string;
    };
    expect(firstBody.success).toBe(true);
    created.push(firstBody.document_id);

    const second = await fetch(`${server.base}/api/v1/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "paste", title: titleB, content: text }),
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      success: boolean;
      document_id: string;
      skipped: boolean;
    };
    expect(secondBody.skipped).toBe(true);
    expect(secondBody.success).toBe(false); // Python contract: success = !skipped
    expect(secondBody.document_id).toBe(firstBody.document_id);
  });

  test("POST /api/v1/ingest/file (multipart) creates a new doc", async () => {
    if (!server) return;
    const text = `# File ingest\n\nMultipart upload test ${RUN_TAG}.\n`;
    const filename = `web-ingest-file-${RUN_TAG}.md`;

    const form = new FormData();
    form.append("file", new Blob([text], { type: "text/markdown" }), filename);
    form.append("title", `${TITLE_PREFIX} file-${RUN_TAG}`);

    const resp = await fetch(`${server.base}/api/v1/ingest/file`, {
      method: "POST",
      body: form,
    });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      success: boolean;
      document_id: string;
    };
    expect(body.success).toBe(true);
    expect(body.document_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    created.push(body.document_id);
  });

  test("POST /documents/{id}/upload (replace) updates content", async () => {
    if (!server) return;
    // First create a doc.
    const title = `${TITLE_PREFIX} upload-replace-${RUN_TAG}`;
    const initial = await fetch(`${server.base}/api/v1/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "paste",
        title,
        content: `# v1\n\nInitial content ${RUN_TAG}.\n`,
      }),
    });
    const initialBody = (await initial.json()) as { document_id: string };
    created.push(initialBody.document_id);

    // #228: this route takes the same concurrency contract as every other
    // content update. Read the hash first, exactly as a real client would.
    const read = (await (
      await fetch(`${server.base}/api/v1/documents/${initialBody.document_id}`)
    ).json()) as { content_hash: string };
    expect(read.content_hash).toBeTruthy();

    // Omitting the token is refused, not silently applied. Asserted before the
    // happy path because the endpoint spent eleven releases in a state where
    // NOTHING worked, and a fix that made everything work would have been just
    // as wrong in the other direction.
    const noToken = new FormData();
    noToken.append(
      "file",
      new Blob(["# nope\n"], { type: "text/markdown" }),
      `no-token-${RUN_TAG}.md`,
    );
    const refused = await fetch(
      `${server.base}/api/v1/documents/${initialBody.document_id}/upload`,
      { method: "POST", body: noToken },
    );
    const refusedBody = (await refused.json()) as { success: boolean; error?: string };
    expect(refusedBody.success).toBe(false);
    expect(refusedBody.error ?? "").toContain("CEREFOX_TOKEN_REQUIRED");

    // Now upload-replace, with the token.
    const newText = `# v2\n\nReplacement content ${RUN_TAG}.\n`;
    const form = new FormData();
    form.append(
      "file",
      new Blob([newText], { type: "text/markdown" }),
      `replacement-${RUN_TAG}.md`,
    );
    form.append("expected_content_hash", read.content_hash);
    const resp = await fetch(
      `${server.base}/api/v1/documents/${initialBody.document_id}/upload`,
      { method: "POST", body: form },
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      success: boolean;
      document_id: string;
      updated: boolean;
    };
    expect(body.success).toBe(true);
    expect(body.document_id).toBe(initialBody.document_id);
    expect(body.updated).toBe(true);
    // Four round-trips (ingest, read, refused upload, upload), each embedding
    // real content, so the default 5s is not enough.
  }, 30_000);
});
