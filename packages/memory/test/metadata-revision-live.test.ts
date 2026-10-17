/**
 * Live tests for the metadata concurrency token and history (#333, schema
 * 0.21.0), through the shared MCP tool handlers over the Data API.
 *
 * Every document it creates is `[E2E 333]`-prefixed and removed in afterAll,
 * including on failure. Data API only: ZERO Edge Function calls.
 *
 * Skips unless the target is on schema 0.21.0+ AND is a labeled (staging)
 * environment, so it can never write to production:
 *   CEREFOX_CONFIG_DIR=~/.cerefox/staging bun test test/metadata-revision-live.test.ts
 */

import { afterAll, beforeAll, describe, expect } from "bun:test";

import { LIVE_TEST_BUDGET_MS, liveTest } from "./_live-test.ts";

import { loadSettings } from "../../../_shared/config/index.ts";
import { createClient } from "../../../_shared/db-client/index.ts";
import { TOOLS_BY_NAME } from "../../../_shared/mcp-tools/index.ts";
import type { MCPSupabaseClient, ToolContext } from "../../../_shared/mcp-tools/types.ts";
import { mayWriteToLiveTarget } from "./_live-target-guard.ts";
import { probeSupabase } from "./_live-probe.ts";

const settings = loadSettings();
let supabase: MCPSupabaseClient;
let raw: ReturnType<typeof createClient>["raw"];
let ctx: ToolContext;
let reachable = false;
const created: string[] = [];

const ingest = TOOLS_BY_NAME["cerefox_ingest"];
const setMeta = TOOLS_BY_NAME["cerefox_set_document_metadata"];
const getDoc = TOOLS_BY_NAME["cerefox_get_document"];
const audit = TOOLS_BY_NAME["cerefox_get_audit_log"];

const RUN = Math.random().toString(36).slice(2, 10);
let seq = 0;

function idFrom(text: string): string {
  const m = text.match(/id: ([0-9a-f-]{36})/);
  if (!m) throw new Error(`No document id in response: ${text}`);
  return m[1];
}
function hashFrom(text: string): string {
  const m = text.match(/content_hash: ([0-9a-f]{64})/);
  if (!m) throw new Error(`No content_hash in response: ${text}`);
  return m[1];
}

async function seed(metadata: Record<string, unknown>): Promise<{ id: string; hash: string }> {
  const n = ++seq;
  const res = await ingest.handler(
    supabase,
    {
      title: `[E2E 333] doc ${RUN}-${n}`,
      content: `# Metadata token ${RUN}-${n}\n\nBody for run ${RUN}, document ${n}.\n`,
      metadata,
      author: "e2e-test",
    },
    ctx,
  );
  const id = idFrom(res);
  created.push(id);
  return { id, hash: hashFrom(res) };
}

/** The stored row: metadata and its revision, straight from the table. */
async function row(id: string): Promise<{ metadata: Record<string, unknown>; metadata_revision: number }> {
  const { data, error } = await raw
    .from("cerefox_documents")
    .select("metadata, metadata_revision")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data as { metadata: Record<string, unknown>; metadata_revision: number };
}

beforeAll(async () => {
  if (!settings.supabaseUrl || !settings.supabaseKey) return;
  if (!probeSupabase()) return;
  try {
    const client = createClient(settings);
    raw = client.raw;
    supabase = client.raw as unknown as MCPSupabaseClient;
    ctx = { accessPath: "local-mcp", openaiApiKey: settings.openaiApiKey ?? "" } as ToolContext;
    const version = (await client.rpc<string>("cerefox_schema_version")) ?? "0.0.0";
    const [maj, min] = String(version).split(".").map((n) => parseInt(n, 10) || 0);
    if (!(maj > 0 || min >= 21)) {
      console.log(`[metadata-revision-live] skipped: needs schema 0.21.0+, server reports ${version}.`);
      return;
    }
    reachable = mayWriteToLiveTarget();
  } catch {
    reachable = false;
  }
}, LIVE_TEST_BUDGET_MS);

afterAll(async () => {
  if (!reachable || created.length === 0) return;
  const r = supabase as unknown as {
    from: (t: string) => { delete: () => { in: (c: string, v: string[]) => Promise<unknown> } };
  };
  try {
    await r.from("cerefox_audit_log").delete().in("document_id", created);
    await r.from("cerefox_document_versions").delete().in("document_id", created);
    await r.from("cerefox_chunks").delete().in("document_id", created);
    await r.from("cerefox_documents").delete().in("id", created);
  } catch {
    // Best-effort: a leftover [E2E 333] document is noise, not a failure.
  }
}, 30_000);

const it = (name: string, fn: () => Promise<void>) =>
  liveTest(name, async () => {
    if (!reachable) return; // probe-and-skip
    await fn();
  });

describe("metadata_revision — live (#333)", () => {
  it("a new document starts at revision 1, and reads return it", async () => {
    const { id } = await seed({ type: "e2e" });
    expect((await row(id)).metadata_revision).toBe(1);
    const text = await getDoc.handler(supabase, { document_id: id, author: "e2e-test" }, ctx);
    expect(text).toContain("metadata_revision: 1");
    const outline = JSON.parse(
      await getDoc.handler(supabase, { document_id: id, outline: true, author: "e2e-test" }, ctx),
    );
    expect(outline.metadata_revision).toBe(1);
    expect(outline.metadata).toEqual({ type: "e2e" });
  });

  it("two token-less merges of different keys both land; each bumps the revision once", async () => {
    const { id } = await seed({ type: "e2e" });
    await setMeta.handler(supabase, { document_id: id, metadata: { a: "1" }, author: "e2e-test" }, ctx);
    await setMeta.handler(supabase, { document_id: id, metadata: { b: "2" }, author: "e2e-test" }, ctx);
    const r = await row(id);
    expect(r.metadata).toEqual({ type: "e2e", a: "1", b: "2" });
    expect(r.metadata_revision).toBe(3);
  });

  it("a write that changes nothing does not bump the revision", async () => {
    const { id } = await seed({ type: "e2e" });
    await setMeta.handler(supabase, { document_id: id, metadata: { type: "e2e" }, author: "e2e-test" }, ctx);
    expect((await row(id)).metadata_revision).toBe(1);
  });

  it("a merge with a stale token is refused and writes nothing", async () => {
    const { id } = await seed({ type: "e2e" });
    await setMeta.handler(supabase, { document_id: id, metadata: { a: "1" }, author: "e2e-test" }, ctx);
    await expect(
      setMeta.handler(
        supabase,
        { document_id: id, metadata: { a: "mine" }, expected_metadata_revision: 1, author: "e2e-test" },
        ctx,
      ),
    ).rejects.toThrow(/Metadata conflict/);
    expect((await row(id)).metadata).toEqual({ type: "e2e", a: "1" });
  });

  it("replace needs a token: absent → refused, stale → conflict, current → ok, last_write_wins → ok", async () => {
    const { id } = await seed({ type: "e2e", keep: "x" });
    await expect(
      setMeta.handler(supabase, { document_id: id, metadata: { only: "1" }, replace: true, author: "e2e-test" }, ctx),
    ).rejects.toThrow(/needs\s+expected_metadata_revision/);
    await expect(
      setMeta.handler(
        supabase,
        { document_id: id, metadata: { only: "1" }, replace: true, expected_metadata_revision: 7, author: "e2e-test" },
        ctx,
      ),
    ).rejects.toThrow(/Metadata conflict/);
    expect((await row(id)).metadata).toEqual({ type: "e2e", keep: "x" });

    await setMeta.handler(
      supabase,
      { document_id: id, metadata: { only: "1" }, replace: true, expected_metadata_revision: 1, author: "e2e-test" },
      ctx,
    );
    expect(await row(id)).toEqual({ metadata: { only: "1" }, metadata_revision: 2 });

    await setMeta.handler(
      supabase,
      { document_id: id, metadata: { only: "2" }, replace: true, last_write_wins: true, author: "e2e-test" },
      ctx,
    );
    expect((await row(id)).metadata).toEqual({ only: "2" });
  });

  it("a content update with metadata MERGES, keeping another writer's keys", async () => {
    const { id, hash } = await seed({ type: "e2e" });
    // Another writer tags the document after our read.
    await setMeta.handler(supabase, { document_id: id, metadata: { owner: "other" }, author: "e2e-test" }, ctx);
    // Our content update still holds a valid content_hash and carries metadata.
    await ingest.handler(
      supabase,
      {
        document_id: id,
        title: `[E2E 333] merged ${RUN}`,
        content: `# Metadata token merged ${RUN}\n\nNew body.\n`,
        metadata: { status: "done", type: null },
        expected_content_hash: hash,
        author: "e2e-test",
      },
      ctx,
    );
    // owner survives; type removed by the null; status added.
    expect((await row(id)).metadata).toEqual({ owner: "other", status: "done" });
  });

  it("a content update with a stale metadata token is refused before anything is written", async () => {
    const { id, hash } = await seed({ type: "e2e" });
    await setMeta.handler(supabase, { document_id: id, metadata: { owner: "other" }, author: "e2e-test" }, ctx);
    await expect(
      ingest.handler(
        supabase,
        {
          document_id: id,
          title: `[E2E 333] stale ${RUN}`,
          content: `# Metadata token stale ${RUN}\n\nNew body.\n`,
          metadata: { status: "done" },
          expected_content_hash: hash,
          expected_metadata_revision: 1,
          author: "e2e-test",
        },
        ctx,
      ),
    ).rejects.toThrow(/Metadata conflict/);
    const { data } = await raw.from("cerefox_documents").select("content_hash").eq("id", id).single();
    expect((data as { content_hash: string }).content_hash).toBe(hash);
  });

  it("an empty metadata object on a content update changes no metadata", async () => {
    const { id, hash } = await seed({ type: "e2e" });
    await ingest.handler(
      supabase,
      {
        document_id: id,
        title: `[E2E 333] empty ${RUN}`,
        content: `# Metadata token empty ${RUN}\n\nNew body.\n`,
        metadata: {},
        expected_content_hash: hash,
        author: "e2e-test",
      },
      ctx,
    );
    expect(await row(id)).toEqual({ metadata: { type: "e2e" }, metadata_revision: 1 });
  });

  it("a direct table write bumps the revision too (trigger), and cannot set it", async () => {
    const { id } = await seed({ type: "e2e" });
    await raw.from("cerefox_documents").update({ metadata: { type: "direct" }, metadata_revision: 99 }).eq("id", id);
    expect(await row(id)).toEqual({ metadata: { type: "direct" }, metadata_revision: 2 });
  });

  it("the audit trail records before and after, and the MCP log shows the change", async () => {
    const { id } = await seed({ type: "e2e", stale: "y" });
    await setMeta.handler(
      supabase,
      { document_id: id, metadata: { status: "done", stale: null }, author: "e2e-test" },
      ctx,
    );
    const { data } = await raw
      .from("cerefox_audit_log")
      .select("metadata_before, metadata_after")
      .eq("document_id", id)
      .eq("operation", "update-metadata");
    expect(data).toEqual([
      { metadata_before: { type: "e2e", stale: "y" }, metadata_after: { type: "e2e", status: "done" } },
    ]);
    const log = await audit.handler(supabase, { document_id: id, author: "e2e-test" }, ctx);
    expect(log).toContain("set status=done; removed stale");
  });
});
