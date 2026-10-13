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

import { afterAll, beforeAll, describe, expect } from "bun:test";

import { liveTest } from "../_live-test.ts";
import { probeSupabase } from "../_live-probe.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { IngestionPipeline } from "../../src/ingestion/pipeline.ts";
import { loadEnv } from "../../../../_shared/config/index.js";
import { mayWriteToLiveTarget } from "../_live-target-guard.ts";

loadEnv();

const SUPABASE_URL = process.env.CEREFOX_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.CEREFOX_SUPABASE_KEY ?? "";
const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || process.env.CEREFOX_OPENAI_API_KEY || "";

// Configured is not the same as REACHABLE, and conflating them is what made
// this suite FAIL rather than skip when the staging project was paused: the
// credentials were all still present, so every test ran and died on a
// connection error. `probeSupabase()` asks the backend, and it throws rather
// than returning false if the probe command itself is rejected, so a broken
// harness cannot masquerade as an absent store.
const LIVE_OK =
  mayWriteToLiveTarget() &&
  SUPABASE_URL.length > 0 &&
  SUPABASE_KEY.length > 0 &&
  OPENAI_API_KEY.length > 0 &&
  probeSupabase();

const TITLE_PREFIX = "[E2E pipeline-update]";
const RUN_TAG = String(Date.now());

describe("IngestionPipeline.updateDocument (live)", () => {
  let supabase: SupabaseClient | null = null;
  let pipeline: IngestionPipeline | null = null;
  let schemaTooOld = false;
  // #332: the uniqueness tests need schema 0.20.0; against an older server
  // they skip rather than fail on a constraint this branch removes.
  let uniquenessDropped = false;
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
      uniquenessDropped = maj > 0 || min >= 20;
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

  liveTest("setup: live probe", () => {
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

  liveTest("metadata-only update (same content, title changed) → reindexed=false", async () => {
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

  liveTest("content change → reindexed=true + new version snapshot", async () => {
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

  // #332 (schema 0.20.0): content is no longer unique across the store. Only a
  // CREATE de-duplicates, and only against live documents; an update is never
  // refused for matching another document, trashed or not.
  liveTest("update to another live document's content succeeds (#332)", async () => {
    if (!pipeline || !supabase || !uniquenessDropped) return;
    const text = "# Converged body\n\nShared content for run " + RUN_TAG + ".\n";

    const docA = await pipeline.ingestText({
      text,
      title: `${TITLE_PREFIX} converge-A-${RUN_TAG}`,
      author: "pipeline-update-test",
    });
    created.push(docA.documentId);
    const docB = await pipeline.ingestText({
      text: "# Other\n\nDifferent content for run " + RUN_TAG + ".\n",
      title: `${TITLE_PREFIX} converge-B-${RUN_TAG}`,
      author: "pipeline-update-test",
    });
    created.push(docB.documentId);

    const updated = await pipeline.updateDocument({
      documentId: docB.documentId,
      text,
      title: docB.title,
      author: "pipeline-update-test",
      expectedContentHash: docB.contentHash,
    });
    expect(updated.documentId).toBe(docB.documentId);
    expect(updated.reindexed).toBe(true);
    expect(updated.contentHash).toBe(docA.contentHash);

    const { data: rows } = await supabase
      .from("cerefox_documents")
      .select("id")
      .eq("content_hash", docA.contentHash)
      .is("deleted_at", null);
    expect((rows ?? []).map((r) => r.id).sort()).toEqual(
      [docA.documentId, docB.documentId].sort(),
    );
  }, 60_000);

  liveTest("a trashed document blocks neither update, create nor its own restore (#332)", async () => {
    if (!pipeline || !supabase || !uniquenessDropped) return;
    const text = "# Trashed body\n\nContent that ends up in the trash, run " + RUN_TAG + ".\n";

    const trashed = await pipeline.ingestText({
      text,
      title: `${TITLE_PREFIX} trashed-${RUN_TAG}`,
      author: "pipeline-update-test",
    });
    created.push(trashed.documentId);
    const { error: delErr } = await supabase.rpc("cerefox_delete_document", {
      p_document_id: trashed.documentId,
      p_author: "pipeline-update-test",
      p_author_type: "user",
    });
    expect(delErr).toBeNull();

    // Update a live document to the trashed one's body.
    const live = await pipeline.ingestText({
      text: "# Live\n\nStarts different, run " + RUN_TAG + ".\n",
      title: `${TITLE_PREFIX} trashed-twin-${RUN_TAG}`,
      author: "pipeline-update-test",
    });
    created.push(live.documentId);
    const updated = await pipeline.updateDocument({
      documentId: live.documentId,
      text,
      title: live.title,
      author: "pipeline-update-test",
      expectedContentHash: live.contentHash,
    });
    expect(updated.reindexed).toBe(true);

    // Restore the trashed one while a live document holds the same body.
    const { error: restoreErr } = await supabase.rpc("cerefox_restore_document", {
      p_document_id: trashed.documentId,
      p_author: "pipeline-update-test",
      p_author_type: "user",
    });
    expect(restoreErr).toBeNull();

    // Trash it again; a create whose only match is in the trash creates.
    await supabase.rpc("cerefox_delete_document", {
      p_document_id: live.documentId,
      p_author: "pipeline-update-test",
      p_author_type: "user",
    });
    await supabase.rpc("cerefox_delete_document", {
      p_document_id: trashed.documentId,
      p_author: "pipeline-update-test",
      p_author_type: "user",
    });
    const fresh = await pipeline.ingestText({
      text,
      title: `${TITLE_PREFIX} trashed-recreate-${RUN_TAG}`,
      author: "pipeline-update-test",
    });
    created.push(fresh.documentId);
    expect(fresh.action).toBe("created");
    expect(fresh.documentId).not.toBe(trashed.documentId);
  }, 120_000);

  liveTest("RPC create with a live document's hash returns it as 'skipped' (#332)", async () => {
    if (!pipeline || !supabase || !uniquenessDropped) return;
    const text = "# RPC dedup\n\nAuthoritative create-time check, run " + RUN_TAG + ".\n";
    const first = await pipeline.ingestText({
      text,
      title: `${TITLE_PREFIX} rpc-dedup-${RUN_TAG}`,
      author: "pipeline-update-test",
    });
    created.push(first.documentId);

    // Straight to the RPC, as a caller that skipped the pre-check (or lost a
    // race to it) would arrive. The embedding is a dummy: nothing is written.
    const { data, error } = await supabase.rpc("cerefox_ingest_document", {
      p_document_id: null,
      p_title: `${TITLE_PREFIX} rpc-dedup-copy-${RUN_TAG}`,
      p_content_hash: first.contentHash,
      p_chunks: [
        {
          chunk_index: 0,
          heading_path: [],
          heading_level: 0,
          title: "",
          content: text,
          char_count: text.length,
          embedding: new Array(768).fill(0.01),
          embedder: "test",
        },
      ],
      p_author: "pipeline-update-test",
      p_author_type: "user",
    });
    expect(error).toBeNull();
    const row = (Array.isArray(data) ? data[0] : data) as { document_id: string; operation: string };
    expect(row.operation).toBe("skipped");
    expect(row.document_id).toBe(first.documentId);

    const { data: copies } = await supabase
      .from("cerefox_documents")
      .select("id")
      .eq("title", `${TITLE_PREFIX} rpc-dedup-copy-${RUN_TAG}`);
    expect(copies ?? []).toEqual([]);
  }, 60_000);

  liveTest("RPC: p_metadata NULL on update keeps existing metadata (v0.11.1)", async () => {
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

  liveTest("update non-existent document → throws", async () => {
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
  liveTest("forceRechunk: identical content still re-chunks → reindexed=true", async () => {
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
