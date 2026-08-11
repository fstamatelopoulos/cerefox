/**
 * Live end-to-end suite for partial document edits (iteration 34).
 *
 * Drives the real `_shared/mcp-tools` handlers against a real Supabase project:
 * real reads, real embeddings, the real `cerefox_ingest_document` RPC. This is
 * the suite that proves the contract in
 * `docs/specs/partial-document-edits-design.md` §3 — the pure-module tests
 * prove the string math, this proves the whole path.
 *
 * Probe-and-skip: silently skips when Supabase is unreachable, so a default
 * `bun test` on a laptop without credentials stays green. Self-cleaning: every
 * document it creates is `[E2E iter34] …`-prefixed and removed in afterAll,
 * including on failure.
 *
 * Data API only — ZERO Edge Function calls, so it does not consume free-tier
 * quota (see CLAUDE.md's note on conserving it).
 *
 * Requires a store on schema 0.11.0 or newer; skips with a message otherwise, so
 * it can never write to a server that lacks the feature. Point it at whichever
 * environment you deploy to for testing:
 *   CEREFOX_CONFIG_DIR=/path/to/that/env bun test test/partial-edits-live.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { loadSettings } from "../../../_shared/config/index.ts";
import { createClient } from "../../../_shared/db-client/index.ts";
import { TOOLS_BY_NAME } from "../../../_shared/mcp-tools/index.ts";
import type { MCPSupabaseClient, ToolContext } from "../../../_shared/mcp-tools/types.ts";
import { mayWriteToLiveTarget } from "./_live-target-guard.ts";

const settings = loadSettings();
let supabase: MCPSupabaseClient;
let ctx: ToolContext;
let reachable = false;
const created: string[] = [];

const insert = TOOLS_BY_NAME["cerefox_insert"];
const edit = TOOLS_BY_NAME["cerefox_edit"];
const getDoc = TOOLS_BY_NAME["cerefox_get_document"];
const ingest = TOOLS_BY_NAME["cerefox_ingest"];

const SEED = `# Daily log

## Intake

| time | item |
|------|------|
| 9:00 | coffee |

### Notes

Morning was quiet.

## Totals

Calories: 1200

## Remaining

To target: 800
`;

/** Pull the document_id out of an ingest response. */
function idFrom(text: string): string {
  const m = text.match(/id: ([0-9a-f-]{36})/);
  if (!m) throw new Error(`No document id in response: ${text}`);
  return m[1];
}
/** Pull the content_hash out of any write/read response. */
function hashFrom(text: string): string {
  const m = text.match(/content_hash: ([0-9a-f]{64})/);
  if (!m) throw new Error(`No content_hash in response: ${text}`);
  return m[1];
}

let seq = 0;
// content_hash carries a UNIQUE constraint across the whole store, so seed text
// must be unique per document AND per run — otherwise a re-run collides with
// documents an interrupted earlier run left behind, and the failure surfaces as
// an opaque duplicate-key error rather than anything about this feature.
const RUN = Math.random().toString(36).slice(2, 10);
async function seedDoc(title: string): Promise<{ id: string; hash: string }> {
  const content = SEED.replace("# Daily log", `# Daily log ${RUN}-${++seq}`);
  const res = await ingest.handler(
    supabase,
    { title, content, source: "test", author: "e2e-test" },
    ctx,
  );
  const id = idFrom(res);
  created.push(id);
  // #189: create returns the hash, so no read is needed to start editing.
  return { id, hash: hashFrom(res) };
}

async function fullText(id: string): Promise<string> {
  return await getDoc.handler(supabase, { document_id: id, requestor: "e2e-test" }, ctx);
}

beforeAll(async () => {
  if (!settings.supabaseUrl || !settings.supabaseKey) return;
  try {
    const client = createClient(settings);
    supabase = client.raw as unknown as MCPSupabaseClient;
    ctx = {
      accessPath: "local-mcp",
      openaiApiKey: settings.openaiApiKey ?? "",
    } as ToolContext;
    const { error } = await client.raw.from("cerefox_documents").select("id").limit(1);
    if (error) return;

    // Refuse to run against a server that lacks the feature — which, until the
    // rollout completes, means production. Without this the suite would seed
    // documents and only then fail on the unknown RPC signature, writing to a
    // store it was never meant to touch. Checking the schema costs one call and
    // makes the blast radius zero.
    const version = (await client.rpc<string>("cerefox_schema_version")) ?? "0.0.0";
    const [maj, min, patch] = String(version).split(".").map((n) => parseInt(n, 10) || 0);
    const supported = maj > 0 || min > 11 || (min === 11 && patch >= 0);
    if (!supported) {
      console.log(
        `[partial-edits-live] skipped: partial edits need schema 0.11.0 or newer; ` +
          `this server reports ${version}. Run \`cerefox server deploy\` against the ` +
          `store you want to test, or point CEREFOX_CONFIG_DIR at one already on 0.11.0.`,
      );
      return;
    }
    // Reachability is not permission: production is the most reachable
    // target there is. Writing suites gate on the environment LABEL.
    reachable = mayWriteToLiveTarget();
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (!reachable || created.length === 0) return;
  // Four batched deletes, not four per document: a dozen fixtures at four
  // round trips each overran the default hook timeout.
  const raw = supabase as unknown as {
    from: (t: string) => { delete: () => { in: (c: string, v: string[]) => Promise<unknown> } };
  };
  try {
    // Remove this suite's audit rows FIRST, while document_id still points at
    // them. Purging afterwards would leave those rows with a null document_id
    // (the FK is ON DELETE SET NULL) — correct for a real purge, whose record
    // is meant to outlive the document, but pure litter when the "document"
    // was a fixture that existed for four seconds.
    await raw.from("cerefox_audit_log").delete().in("document_id", created);
    await raw.from("cerefox_document_versions").delete().in("document_id", created);
    await raw.from("cerefox_chunks").delete().in("document_id", created);
    await raw.from("cerefox_documents").delete().in("id", created);
  } catch {
    // Best-effort: a leftover [E2E iter34] document is noise, not a failure.
  }
}, 30_000);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, async () => {
    if (!reachable) return; // probe-and-skip
    await fn();
  });

describe("partial edits — live (§3)", () => {
  it("#189: create returns a usable content_hash, so no read is needed first", async () => {
    const { id, hash } = await seedDoc("[E2E iter34] hash on create");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // The token works immediately: an edit based on it must be accepted.
    const res = await insert.handler(
      supabase,
      {
        document_id: id,
        text: "Created and edited without an intervening read.",
        position: "end_of_document",
        expected_content_hash: hash,
        requestor: "e2e-test",
      },
      ctx,
    );
    expect(res).toContain("Applied 1 operation");
  });

  it("insert at end_of_document appends and preserves everything (§1 guarantee)", async () => {
    const { id, hash } = await seedDoc("[E2E iter34] append");
    await insert.handler(
      supabase,
      { document_id: id, text: "## Day 2\n\nSecond entry.", position: "end_of_document", expected_content_hash: hash, requestor: "e2e-test" },
      ctx,
    );
    const after = await fullText(id);
    expect(after).toContain("Second entry.");
    for (const line of SEED.split("\n").filter((l) => l.trim())) {
      expect(after).toContain(line);
    }
  });

  it("insert at end_of_section lands inside the right section", async () => {
    const { id, hash } = await seedDoc("[E2E iter34] section insert");
    await insert.handler(
      supabase,
      { document_id: id, text: "To target: 550", position: "end_of_section", anchor_heading: "## Remaining", expected_content_hash: hash, requestor: "e2e-test" },
      ctx,
    );
    const after = await fullText(id);
    expect(after.indexOf("To target: 550")).toBeGreaterThan(after.indexOf("## Remaining"));
  });

  it("a nested section refuses to guess and names both options (§3.3)", async () => {
    const { id, hash } = await seedDoc("[E2E iter34] ambiguity");
    await expect(
      insert.handler(
        supabase,
        { document_id: id, text: "| 12:00 | lunch |", position: "end_of_section", anchor_heading: "## Intake", expected_content_hash: hash, requestor: "e2e-test" },
        ctx,
      ),
    ).rejects.toThrow(/own_body[\s\S]*subtree/);
    // And the document is untouched.
    expect(await fullText(id)).not.toContain("lunch");
  });

  it("section_part resolves it and writes to the chosen place", async () => {
    const { id, hash } = await seedDoc("[E2E iter34] section_part");
    await insert.handler(
      supabase,
      { document_id: id, text: "| 12:00 | lunch |", position: "end_of_section", anchor_heading: "## Intake", section_part: "own_body", expected_content_hash: hash, requestor: "e2e-test" },
      ctx,
    );
    const after = await fullText(id);
    expect(after.indexOf("lunch")).toBeLessThan(after.indexOf("### Notes"));
  });

  it("session 4's shape: three coordinated changes in ONE atomic write (§3.4)", async () => {
    const { id, hash } = await seedDoc("[E2E iter34] atomic batch");
    const res = await edit.handler(
      supabase,
      {
        document_id: id,
        expected_content_hash: hash,
        requestor: "e2e-test",
        operations: [
          { op: "insert", position: "end_of_section", anchor_heading: "## Intake", section_part: "own_body", text: "| 14:20 | snack |" },
          { op: "replace_section", anchor_heading: "## Totals", text: "Calories: 1450" },
          { op: "replace_section", anchor_heading: "## Remaining", text: "To target: 550" },
        ],
      },
      ctx,
    );
    expect(res).toContain("Applied 3 operation");
    const after = await fullText(id);
    // The row and the totals it feeds agree — the point of atomicity.
    expect(after).toContain("| 14:20 | snack |");
    expect(after).toContain("Calories: 1450");
    expect(after).toContain("To target: 550");
    expect(after).not.toContain("Calories: 1200");
    expect(after).toContain("Morning was quiet."); // untouched section survived
  });

  it("a failing operation writes NOTHING (all-or-nothing)", async () => {
    const { id, hash } = await seedDoc("[E2E iter34] all or nothing");
    await expect(
      edit.handler(
        supabase,
        {
          document_id: id,
          expected_content_hash: hash,
          requestor: "e2e-test",
          operations: [
            { op: "replace_section", anchor_heading: "## Totals", text: "Calories: 9999" },
            { op: "replace_section", anchor_heading: "## Does Not Exist", text: "x" },
          ],
        },
        ctx,
      ),
    ).rejects.toThrow(/Operation 2 of 2/);
    const after = await fullText(id);
    expect(after).toContain("Calories: 1200"); // first op did not land
    expect(after).not.toContain("9999");
  });

  it("delete_section honours scope", async () => {
    const { id, hash } = await seedDoc("[E2E iter34] delete scopes");
    const r1 = await edit.handler(
      supabase,
      { document_id: id, expected_content_hash: hash, requestor: "e2e-test", operations: [{ op: "delete_section", anchor_heading: "## Totals" }] },
      ctx,
    );
    let after = await fullText(id);
    expect(after).toContain("## Totals"); // body_only keeps the heading
    expect(after).not.toContain("Calories: 1200");

    await edit.handler(
      supabase,
      { document_id: id, expected_content_hash: hashFrom(r1), requestor: "e2e-test", operations: [{ op: "delete_section", anchor_heading: "## Totals", scope: "heading_and_body" }] },
      ctx,
    );
    after = await fullText(id);
    expect(after).not.toContain("## Totals");
    expect(after).toContain("## Remaining");
  });

  it("a stale token is refused by the RPC's compare-and-swap (§5)", async () => {
    const { id, hash } = await seedDoc("[E2E iter34] conflict");
    await insert.handler(
      supabase,
      { document_id: id, text: "First writer.", position: "end_of_document", expected_content_hash: hash, requestor: "e2e-test" },
      ctx,
    );
    // Second writer still holds the original hash.
    await expect(
      insert.handler(
        supabase,
        { document_id: id, text: "Second writer.", position: "end_of_document", expected_content_hash: hash, requestor: "e2e-test" },
        ctx,
      ),
    ).rejects.toThrow(/Conflict/);
    const after = await fullText(id);
    expect(after).toContain("First writer.");
    expect(after).not.toContain("Second writer."); // the other writer's work survived
  });

  it("outline mode returns anchors and hash without the body (§3.7)", async () => {
    const { id } = await seedDoc("[E2E iter34] outline");
    const out = await getDoc.handler(supabase, { document_id: id, outline: true, requestor: "e2e-test" }, ctx);
    const parsed = JSON.parse(out);
    expect(parsed.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.outline.length).toBeGreaterThan(3);
    expect(out).not.toContain("Calories: 1200");

    // Round-trip: a returned path is directly usable as an anchor.
    const notes = parsed.outline.find((n: { path: string }) => n.path.endsWith("### Notes")).path;
    const res = await insert.handler(
      supabase,
      { document_id: id, text: "Added via an outline path.", position: "end_of_section", anchor_heading: notes, expected_content_hash: parsed.content_hash, requestor: "e2e-test" },
      ctx,
    );
    expect(res).toContain("Applied 1 operation");
    expect(await fullText(id)).toContain("Added via an outline path.");
  });

  it("the audit trail records one entry per operation, in order (§6.1)", async () => {
    const { id, hash } = await seedDoc("[E2E iter34] audit");
    await edit.handler(
      supabase,
      {
        document_id: id,
        expected_content_hash: hash,
        requestor: "e2e-test",
        operations: [
          { op: "insert", position: "end_of_document", text: "## Extra\n\nx" },
          { op: "replace_section", anchor_heading: "## Totals", text: "Calories: 1450" },
          { op: "delete_section", anchor_heading: "## Remaining", scope: "heading_and_body" },
        ],
      },
      ctx,
    );
    const raw = supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => { order: (c: string) => Promise<{ data: { operation: string }[] }> };
        };
      };
    };
    const { data } = await raw.from("cerefox_audit_log").select("operation").eq("document_id", id).order("created_at");
    const ops = (data ?? []).map((r) => r.operation);
    expect(ops).toContain("insert");
    expect(ops).toContain("replace-section");
    expect(ops).toContain("delete-section");
    // Order within the batch is recoverable — the reason audit entries are
    // stamped with clock_timestamp() rather than the transaction's NOW().
    expect(ops.indexOf("insert")).toBeLessThan(ops.indexOf("replace-section"));
    expect(ops.indexOf("replace-section")).toBeLessThan(ops.indexOf("delete-section"));
  });

  it("purge requires a prior soft delete, and records itself (web-UI-only path)", async () => {
    const { id } = await seedDoc("[E2E iter34] purge");
    const raw = supabase as unknown as {
      rpc: (n: string, a: Record<string, unknown>) => Promise<{ error: unknown }>;
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => Promise<{ data: { deleted_at: string | null }[] }>;
        };
      };
    };

    // Purge refuses a live document: the recovery window cannot be skipped.
    await raw.rpc("cerefox_purge_document", { p_document_id: id, p_author: "e2e-test" });
    const stillThere = await raw.from("cerefox_documents").select("deleted_at").eq("id", id);
    expect(stillThere.data?.length).toBe(1);
    expect(stillThere.data?.[0].deleted_at).toBeNull();

    // Soft delete first — the recoverable state an agent's mistake lands in.
    await raw.rpc("cerefox_delete_document", { p_document_id: id, p_author: "e2e-test" });
    const trashed = await raw.from("cerefox_documents").select("deleted_at").eq("id", id);
    expect(trashed.data?.[0].deleted_at).not.toBeNull();

    // Now purge succeeds and leaves a record of itself.
    await raw.rpc("cerefox_purge_document", { p_document_id: id, p_author: "e2e-test" });
    const gone = await raw.from("cerefox_documents").select("deleted_at").eq("id", id);
    expect(gone.data?.length ?? 0).toBe(0);

    const auditRaw = supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => {
            like: (c: string, v: string) => Promise<{ data: { operation: string; description: string }[] }>;
          };
        };
      };
    };
    const { data } = await auditRaw
      .from("cerefox_audit_log")
      .select("operation, description")
      .eq("author", "e2e-test")
      .like("description", "%[E2E iter34] purge%");
    const descriptions = (data ?? []).map((r) => r.description);
    expect(descriptions.some((d) => d.includes("Soft-deleted"))).toBe(true);
    expect(descriptions.some((d) => d.includes("Permanently deleted"))).toBe(true);

    // Clean up this test's own trail: the purge record legitimately outlives
    // the document, but it described a fixture.
    const del = supabase as unknown as {
      from: (t: string) => { delete: () => { like: (c: string, v: string) => Promise<unknown> } };
    };
    await del.from("cerefox_audit_log").delete().like("description", "%[E2E iter34] purge%");
    created.splice(created.indexOf(id), 1); // already gone
  });

  it("an edit that changes nothing is reported, not written", async () => {
    const { id, hash } = await seedDoc("[E2E iter34] no-op");
    const res = await edit.handler(
      supabase,
      { document_id: id, expected_content_hash: hash, requestor: "e2e-test", operations: [{ op: "replace_section", anchor_heading: "## Totals", text: "Calories: 1200" }] },
      ctx,
    );
    expect(res).toContain("No change");
  });
});
