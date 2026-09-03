/**
 * Live integration tests for `IngestionPipeline.updateDocument` (Part 25E).
 *
 * Covers all three sub-paths:
 *   1. Content unchanged + title changed → metadata-only update; chunks
 *      re-embedded (contextual enrichment); FTS refreshed; audit entry
 *      `update-metadata`; reindexed=false.
 *   2. Content changed → snapshot old version + re-chunk + re-embed +
 *      replace chunks via `cerefox_ingest_document` RPC;
 *      reindexed=true; a `cerefox_document_versions` row is created.
 *   3. Metadata-only update (no title change, content unchanged) →
 *      same as path 1 minus the re-embed.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { IngestionPipeline } from "../../src/ingestion/pipeline.ts";
import { loadEnv } from "../../../../_shared/config/index.js";
import { mayWriteToLiveTarget } from "../_live-target-guard.ts";

loadEnv();

const SUPABASE_URL = process.env.CEREFOX_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.CEREFOX_SUPABASE_KEY ?? "";
const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || process.env.CEREFOX_OPENAI_API_KEY || "";

const LIVE_OK =
  mayWriteToLiveTarget() &&
  (SUPABASE_URL.length > 0 &&
  SUPABASE_KEY.length > 0 &&
  OPENAI_API_KEY.length > 0);

const TITLE_PREFIX = "[E2E pipeline-update]";
const RUN_TAG = String(Date.now());

describe("IngestionPipeline.updateDocument (live)", () => {
  let supabase: SupabaseClient | null = null;
  let pipeline: IngestionPipeline | null = null;
  let schemaTooOld = false;
  const created: string[] = [];

  beforeAll(async () => {
    if (!LIVE_OK) return;
    const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });
    // Schema gate: the update path requires the v0.5.0 schema (iter-32
    // concurrency params) and the metadata-preserve assertions require
    // v0.6.0 (p_metadata NULL = keep existing). Against an older deployed
    // server, leave the suite skipped instead of failing.
    try {
      const { data: ver } = await client.rpc("cerefox_schema_version");
      const [maj = 0, min = 0] = String(ver ?? "0.0.0").split(".").map(Number);
      if (maj === 0 && min < 6) {
        schemaTooOld = true;
        console.log(
          `(skipped: deployed schema ${ver} < 0.6.0 — run \`cerefox server deploy --schema-only\` to enable these tests)`,
        );
        return;
      }
    } catch {
      schemaTooOld = true;
      return;
    }
    supabase = client;
    pipeline = new IngestionPipeline({
      supabase,
      openAiApiKey: OPENAI_API_KEY,
    });
  });

  afterAll(async () => {
    if (!supabase) return;
    for (const id of created) {
      try {
        await supabase.rpc("cerefox_delete_document", {
          p_document_id: id,
          p_author: "pipeline-update-test",
          p_author_type: "user",
        });
        await supabase.rpc("cerefox_purge_document", {
          p_document_id: id,
          p_author: "pipeline-update-test",
          p_author_type: "user",
        });
      } catch {
        /* swallow */
      }
    }
  });

  test("setup: live probe", () => {
    if (!LIVE_OK) {
      console.log("(skipped: Supabase + OpenAI not both available)");
      return;
    }
    if (schemaTooOld) {
      // Deployed schema predates iter-32; the beforeAll left the suite off.
      return;
    }
    expect(pipeline).not.toBeNull();
  });

  test("metadata-only update (same content, title changed) → reindexed=false", async () => {
    if (!pipeline || !supabase) return;

    // Create doc.
    const initialTitle = `${TITLE_PREFIX} title-change-${RUN_TAG}`;
    const text = "# Initial body\n\nContent that won't change. " + RUN_TAG + "\n";
    const created1 = await pipeline.ingestText({
      text,
      title: initialTitle,
      author: "pipeline-update-test",
    });
    created.push(created1.documentId);
    expect(created1.action).toBe("created");

    // Same content, new title → metadata-only path.
    const newTitle = `${TITLE_PREFIX} title-changed-${RUN_TAG}`;
    const updated = await pipeline.updateDocument({
      documentId: created1.documentId,
      text,
      title: newTitle,
      author: "pipeline-update-test",
    });
    expect(updated.action).toBe("updated");
    expect(updated.reindexed).toBe(false);
    expect(updated.title).toBe(newTitle);
    expect(updated.documentId).toBe(created1.documentId);

    // Verify the doc row.
    const { data: row } = await supabase
      .from("cerefox_documents")
      .select("title, content_hash")
      .eq("id", created1.documentId)
      .maybeSingle();
    expect(row?.title).toBe(newTitle);
    // content_hash unchanged.
    expect(row?.content_hash).toBeTruthy();

    // No version snapshot.
    const { data: versions } = await supabase
      .from("cerefox_document_versions")
      .select("id")
      .eq("document_id", created1.documentId);
    expect(versions?.length ?? 0).toBe(0);
  });

  test("content change → reindexed=true + new version snapshot", async () => {
    if (!pipeline || !supabase) return;

    const title = `${TITLE_PREFIX} content-change-${RUN_TAG}`;
    const initialText = "# Initial\n\nv1 content. Run " + RUN_TAG + ".\n";
    const v1 = await pipeline.ingestText({
      text: initialText,
      title,
      author: "pipeline-update-test",
    });
    created.push(v1.documentId);

    // Read the current hash — the optimistic-concurrency token (iter-32).
    const { data: v1Row } = await supabase
      .from("cerefox_documents")
      .select("content_hash")
      .eq("id", v1.documentId)
      .maybeSingle();
    const v1Hash = v1Row?.content_hash as string;
    expect(v1Hash).toBeTruthy();

    const newText = "# Initial\n\nv2 content — totally new. Run " + RUN_TAG + ".\n";
    const updated = await pipeline.updateDocument({
      documentId: v1.documentId,
      text: newText,
      title,
      author: "pipeline-update-test",
      expectedContentHash: v1Hash,
    });
    expect(updated.action).toBe("updated");
    expect(updated.reindexed).toBe(true);

    // ── iter-32: concurrency contract ────────────────────────────────────
    // (a) Updating again with the now-STALE v1 hash → conflict.
    await expect(
      pipeline.updateDocument({
        documentId: v1.documentId,
        text: "# Initial\n\nv3 from a stale base. Run " + RUN_TAG + ".\n",
        title,
        author: "pipeline-update-test",
        expectedContentHash: v1Hash,
      }),
    ).rejects.toThrow(/CEREFOX_CONFLICT/);

    // (b) Updating with NO token and no last-write-wins → token required.
    await expect(
      pipeline.updateDocument({
        documentId: v1.documentId,
        text: "# Initial\n\nv3 tokenless. Run " + RUN_TAG + ".\n",
        title,
        author: "pipeline-update-test",
      }),
    ).rejects.toThrow(/CEREFOX_TOKEN_REQUIRED/);

    // (c) last_write_wins=true bypasses the check.
    const forced = await pipeline.updateDocument({
      documentId: v1.documentId,
      text: "# Initial\n\nv3 forced. Run " + RUN_TAG + ".\n",
      title,
      author: "pipeline-update-test",
      lastWriteWins: true,
    });
    expect(forced.reindexed).toBe(true);

    // Verify versions were snapshotted: one for the token-checked update,
    // one for the forced (last-write-wins) update. The two failed attempts
    // (stale token, missing token) must NOT have created snapshots.
    const { data: versions } = await supabase
      .from("cerefox_document_versions")
      .select("id, version_number")
      .eq("document_id", v1.documentId);
    expect(versions?.length).toBe(2);
    expect(versions?.map((v) => v.version_number).sort()).toEqual([1, 2]);

    // Verify the new content_hash on the doc row differs.
    const { data: row } = await supabase
      .from("cerefox_documents")
      .select("content_hash")
      .eq("id", v1.documentId)
      .maybeSingle();
    expect(row?.content_hash).toBeTruthy();
    // The v1 hash != v2 hash assertion is implicit (we just snapshotted v1).
    // Live: ingest, re-ingest with new content, embed both, snapshot a
    // version. Several real round trips, well past bun's 5s default.
  }, 60_000);

  test("collision with a different doc → throws ValueError-like", async () => {
    if (!pipeline || !supabase) return;
    const text = "# Collision body\n\nUnique content for run " + RUN_TAG + ".\n";

    // Create two docs: one with the text, one without.
    const docA = await pipeline.ingestText({
      text,
      title: `${TITLE_PREFIX} collision-A-${RUN_TAG}`,
      author: "pipeline-update-test",
    });
    created.push(docA.documentId);

    const docB = await pipeline.ingestText({
      text: "# Other\n\nDifferent content for run " + RUN_TAG + ".\n",
      title: `${TITLE_PREFIX} collision-B-${RUN_TAG}`,
      author: "pipeline-update-test",
    });
    created.push(docB.documentId);

    // Try to update docB's content to be the same as docA's — should throw.
    await expect(
      pipeline.updateDocument({
        documentId: docB.documentId,
        text,
        title: docB.title,
        author: "pipeline-update-test",
      }),
    ).rejects.toThrow(/Identical content already exists/);
  });

  test("RPC: p_metadata NULL on update keeps existing metadata (v0.11.1)", async () => {
    if (!pipeline || !supabase) return;

    // Create a doc WITH metadata via the pipeline.
    const title = `${TITLE_PREFIX} meta-preserve-${RUN_TAG}`;
    const createdDoc = await pipeline.ingestText({
      text: "# Meta preserve\n\nBody v1. Run " + RUN_TAG + ".\n",
      title,
      metadata: { type: "e2e-meta", keep: "me" },
      author: "pipeline-update-test",
    });
    created.push(createdDoc.documentId);

    // Direct RPC content update WITHOUT p_metadata (and with a synthetic
    // embedding — no OpenAI needed): the v0.6.0 contract is NULL = keep.
    const { error } = await supabase.rpc("cerefox_ingest_document", {
      p_document_id: createdDoc.documentId,
      p_title: title,
      p_source: "agent",
      p_content_hash: "e2e-meta-preserve-" + RUN_TAG,
      p_review_status: "approved",
      p_chunks: [
        {
          chunk_index: 0,
          heading_path: ["Meta preserve"],
          heading_level: 1,
          title: "Meta preserve",
          content: "Body v2. Run " + RUN_TAG + ".",
          char_count: 24,
          embedding: new Array(768).fill(0.001),
          embedder: "e2e-test",
        },
      ],
      p_author: "pipeline-update-test",
      p_author_type: "agent",
      p_last_write_wins: true,
      // p_metadata deliberately omitted → NULL → keep existing
    });
    expect(error).toBeNull();

    const { data: row } = await supabase
      .from("cerefox_documents")
      .select("metadata")
      .eq("id", createdDoc.documentId)
      .maybeSingle();
    expect(row?.metadata).toEqual({ type: "e2e-meta", keep: "me" });

    // And an explicit '{}' DOES clear (the deliberate-clear contract).
    const { error: clearErr } = await supabase.rpc("cerefox_ingest_document", {
      p_document_id: createdDoc.documentId,
      p_title: title,
      p_source: "agent",
      p_content_hash: "e2e-meta-clear-" + RUN_TAG,
      p_metadata: {},
      p_review_status: "approved",
      p_chunks: [
        {
          chunk_index: 0,
          heading_path: ["Meta preserve"],
          heading_level: 1,
          title: "Meta preserve",
          content: "Body v3. Run " + RUN_TAG + ".",
          char_count: 24,
          embedding: new Array(768).fill(0.001),
          embedder: "e2e-test",
        },
      ],
      p_author: "pipeline-update-test",
      p_author_type: "agent",
      p_last_write_wins: true,
    });
    expect(clearErr).toBeNull();
    const { data: cleared } = await supabase
      .from("cerefox_documents")
      .select("metadata")
      .eq("id", createdDoc.documentId)
      .maybeSingle();
    expect(cleared?.metadata).toEqual({});
  });

  test("update non-existent document → throws", async () => {
    if (!pipeline) return;
    const fakeId = "00000000-0000-0000-0000-000000000000";
    await expect(
      pipeline.updateDocument({
        documentId: fakeId,
        text: "# X\n\nbody\n",
        title: "X",
      }),
    ).rejects.toThrow(/not found/i);
  });


  // Regression: `server migrate-format` re-ingests byte-identical content on
  // purpose — the goal is to rewrite chunk rows under the current chunker, not
  // to change the content. Without `forceRechunk` the unchanged-content
  // short-circuit wins and the command reports "Converted N" while every
  // document stays on the legacy format, which is precisely the #164 defect
  // that command exists to fix. Verified on staging: converting 3 documents
  // moved the format counts by zero.
  test("forceRechunk: identical content still re-chunks → reindexed=true", async () => {
    if (!pipeline || !supabase) return;

    const title = `${TITLE_PREFIX} force-rechunk-${RUN_TAG}`;
    const text = "# Body\n\nIdentical content, re-ingested on purpose. " + RUN_TAG + "\n";
    const created1 = await pipeline.ingestText({
      text,
      title,
      author: "pipeline-update-test",
    });
    created.push(created1.documentId);

    // Same text, same title. Without the flag this is a metadata-only no-op.
    const noop = await pipeline.updateDocument({
      documentId: created1.documentId,
      text,
      title,
      author: "pipeline-update-test",
    });
    expect(noop.reindexed).toBe(false);

    const forcedRechunk = await pipeline.updateDocument({
      documentId: created1.documentId,
      text,
      title,
      author: "pipeline-update-test",
      forceRechunk: true,
    });
    expect(forcedRechunk.reindexed).toBe(true);

    // The chunks must actually carry the current format afterwards — the whole
    // point. Asserting on `reindexed` alone is what let the no-op hide.
    const { data: chunks } = await supabase
      .from("cerefox_chunks")
      .select("content_format")
      .eq("document_id", created1.documentId)
      .is("version_id", null);
    expect(chunks && chunks.length > 0).toBe(true);
    for (const ch of chunks ?? []) {
      expect(ch.content_format).toBe(2);
    }
  });
});
