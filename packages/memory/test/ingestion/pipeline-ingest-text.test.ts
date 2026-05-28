/**
 * Live integration tests for `IngestionPipeline.ingestText` (Part 25D).
 *
 * Probe-and-skip pattern: when Supabase + OpenAI aren't both reachable
 * the suite skips silently. Self-cleaning via `[E2E pipeline-ingest]`
 * title prefix and final purge.
 *
 * Covers the create + dedup branches; the update branches
 * (`documentId` / `updateExisting`) need `updateDocument` which lands
 * in Part 25E.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { IngestionPipeline } from "../../src/ingestion/pipeline.ts";
import { loadEnv } from "../../../../_shared/config/index.js";

loadEnv();

const SUPABASE_URL = process.env.CEREFOX_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.CEREFOX_SUPABASE_KEY ?? "";
const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || process.env.CEREFOX_OPENAI_API_KEY || "";

const LIVE_OK =
  SUPABASE_URL.length > 0 &&
  SUPABASE_KEY.length > 0 &&
  OPENAI_API_KEY.length > 0;

const TITLE_PREFIX = "[E2E pipeline-ingest]";
const RUN_TAG = String(Date.now());

describe("IngestionPipeline.ingestText (live)", () => {
  let supabase: SupabaseClient | null = null;
  let pipeline: IngestionPipeline | null = null;
  const created: string[] = []; // document IDs to purge in afterAll

  beforeAll(() => {
    if (!LIVE_OK) return;
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });
    pipeline = new IngestionPipeline({
      supabase,
      openAiApiKey: OPENAI_API_KEY,
    });
  });

  afterAll(async () => {
    if (!supabase) return;
    // Best-effort: soft-delete then purge each created doc.
    for (const id of created) {
      try {
        await supabase.rpc("cerefox_delete_document", {
          p_document_id: id,
          p_author: "pipeline-ingest-test",
          p_author_type: "user",
        });
        await supabase.rpc("cerefox_purge_document", {
          p_document_id: id,
          p_author: "pipeline-ingest-test",
          p_author_type: "user",
        });
      } catch {
        /* swallow */
      }
    }
  });

  test("setup: live probe succeeded", () => {
    if (!LIVE_OK) {
      console.log("(skipped: Supabase + OpenAI not both available)");
      return;
    }
    expect(pipeline).not.toBeNull();
  });

  test("ingestText creates a new doc (action='created')", async () => {
    if (!pipeline) return;
    const title = `${TITLE_PREFIX} create-${RUN_TAG}`;
    const result = await pipeline.ingestText({
      text:
        "# Hello pipeline\n\n" +
        "First paragraph — TS pipeline create path. " +
        "This text is unique enough to avoid colliding with any other " +
        "document in the corpus.\n",
      title,
      author: "pipeline-ingest-test",
      authorType: "user",
    });
    created.push(result.documentId);
    expect(result.action).toBe("created");
    expect(result.title).toBe(title);
    expect(result.chunkCount).toBe(1);
    expect(result.totalChars).toBeGreaterThan(0);
    expect(result.documentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(result.reindexed).toBe(false);
    expect(result.projectIds).toEqual([]);
    expect(result.note).toBe("");
  });

  test("ingestText skips on content-hash collision (action='skipped')", async () => {
    if (!pipeline || !supabase) return;
    const title1 = `${TITLE_PREFIX} dedup-a-${RUN_TAG}`;
    const title2 = `${TITLE_PREFIX} dedup-b-${RUN_TAG}`;
    const text =
      "# Dedup test\n\nUnique content for the dedup test. " +
      `Run tag: ${RUN_TAG}.\n`;

    const first = await pipeline.ingestText({ text, title: title1 });
    created.push(first.documentId);
    expect(first.action).toBe("created");

    const second = await pipeline.ingestText({ text, title: title2 });
    // Same content → returns the same doc with action=skipped.
    expect(second.action).toBe("skipped");
    expect(second.documentId).toBe(first.documentId);
    // The skipped result returns the EXISTING doc's title, not title2.
    expect(second.title).toBe(title1);
  });

  test("ingestText with projectName creates + assigns project", async () => {
    if (!pipeline || !supabase) return;
    const title = `${TITLE_PREFIX} with-project-${RUN_TAG}`;
    const projectName = `[E2E-pipeline-project] ${RUN_TAG}`;
    const result = await pipeline.ingestText({
      text:
        "# Project-tagged doc\n\nSingular projectName on create → " +
        "project gets created + assigned to the doc.\n",
      title,
      projectName,
    });
    created.push(result.documentId);
    expect(result.action).toBe("created");
    expect(result.projectIds.length).toBe(1);

    // Verify project actually exists with that name.
    const { data } = await supabase
      .from("cerefox_projects")
      .select("id, name")
      .eq("id", result.projectIds[0])
      .maybeSingle();
    expect(data?.name).toBe(projectName);

    // Cleanup the test project too (afterAll only handles docs).
    await supabase.from("cerefox_projects").delete().eq("id", result.projectIds[0]);
  });

  test("ingestText with projectNames list creates + assigns all", async () => {
    if (!pipeline || !supabase) return;
    const title = `${TITLE_PREFIX} with-project-list-${RUN_TAG}`;
    const projectNames = [
      `[E2E-pipeline-project-A] ${RUN_TAG}`,
      `[E2E-pipeline-project-B] ${RUN_TAG}`,
    ];
    const result = await pipeline.ingestText({
      text: "# Multi-project doc\n\nList-form projectNames → full-set assignment.\n",
      title,
      projectNames,
    });
    created.push(result.documentId);
    expect(result.action).toBe("created");
    expect(result.projectIds.length).toBe(2);

    // Verify by name lookup.
    const { data } = await supabase
      .from("cerefox_projects")
      .select("name")
      .in("id", result.projectIds);
    const names = (data ?? []).map((r) => r.name).sort();
    expect(names).toEqual(projectNames.slice().sort());

    // Cleanup the test projects.
    for (const pid of result.projectIds) {
      await supabase.from("cerefox_projects").delete().eq("id", pid);
    }
  });

  test("ingestText with authorType='agent' sets review_status='pending_review'", async () => {
    if (!pipeline || !supabase) return;
    const title = `${TITLE_PREFIX} agent-write-${RUN_TAG}`;
    const result = await pipeline.ingestText({
      text:
        "# Agent-authored doc\n\nauthorType='agent' → review_status='pending_review'.\n",
      title,
      author: "test-agent",
      authorType: "agent",
    });
    created.push(result.documentId);
    expect(result.action).toBe("created");

    const { data } = await supabase
      .from("cerefox_documents")
      .select("review_status")
      .eq("id", result.documentId)
      .maybeSingle();
    expect(data?.review_status).toBe("pending_review");
  });

  test("ingestText with authorType='user' sets review_status='approved'", async () => {
    if (!pipeline || !supabase) return;
    const title = `${TITLE_PREFIX} user-write-${RUN_TAG}`;
    const result = await pipeline.ingestText({
      text:
        "# User-authored doc\n\nauthorType='user' → review_status='approved'.\n",
      title,
      authorType: "user",
    });
    created.push(result.documentId);

    const { data } = await supabase
      .from("cerefox_documents")
      .select("review_status")
      .eq("id", result.documentId)
      .maybeSingle();
    expect(data?.review_status).toBe("approved");
  });
});
