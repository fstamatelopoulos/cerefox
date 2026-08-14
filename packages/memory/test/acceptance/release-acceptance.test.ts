/**
 * Release acceptance: the checks a release is validated against, run over BOTH
 * surfaces, committed rather than rewritten each session.
 *
 * v1.4.0 was validated over MCP and the Edge Functions and shipped a read mode
 * the CLI could not reach (#201) — not because a test failed, but because the
 * CLI was never in the pass. So every capability here is asserted on both, and
 * the two are compared to each other rather than each to a hand-written
 * expectation.
 *
 * Skips unless the target carries `CEREFOX_ENV_LABEL` (see
 * `_live-target-guard.ts`): these tests create real documents, and a bare
 * `bun test` on a maintainer's machine resolves to production.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

import { liveWriteSkipReason, mayWriteToLiveTarget } from "../_live-target-guard.ts";
import { Acceptance, BIN } from "./_harness.ts";

const RUNNABLE = mayWriteToLiveTarget() && existsSync(BIN);
const A = new Acceptance();

const DOC = [
  "# Acceptance",
  "",
  "intro",
  "",
  "## Parent",
  "",
  "parent body",
  "",
  "### Child",
  "",
  "child body",
  "",
  "## Leaf",
  "",
  "leaf body",
  "",
].join("\n");

describe("release acceptance (live)", () => {
  if (!RUNNABLE) {
    test.skip(
      existsSync(BIN) ? liveWriteSkipReason() : "run `bun run build` first",
      () => {},
    );
    return;
  }

  beforeAll(async () => {
    await A.startMcp();
  });

  // Teardown talks to the database once per fixture; the default hook timeout
  // is not sized for that.
  afterAll(async () => {
    const { purged, failed } = await A.teardown();
    // Surfaced rather than silent: a teardown that quietly fails is how
    // fixtures accumulate in someone's trash.
    if (failed.length) {
      console.warn(`[acceptance] purged ${purged}, FAILED to purge: ${failed.join(", ")}`);
    }
  }, 60_000);

  test("section read returns the same text on the CLI and over MCP (#201)", async () => {
    const { id } = await A.seed("parity", DOC);

    const viaMcp = JSON.parse((await A.mcp("cerefox_get_document", { document_id: id, section: "## Leaf" })).text);
    const viaCli = JSON.parse(A.cli(["document", "get", id, "--section", "## Leaf", "--json"]).out);

    // The claim is equality between surfaces, not equality with a literal —
    // a literal would drift the moment either renderer changed.
    expect(viaCli.text).toBe(viaMcp.text);
    expect(viaCli.heading).toBe(viaMcp.heading);
    expect(viaCli.chars).toBe(viaMcp.chars);
    expect(viaCli.content_hash).toBe(viaMcp.content_hash);
  });

  test("both surfaces refuse an ambiguous section identically (#198)", async () => {
    const { id } = await A.seed("ambiguity", DOC);

    const mcp = await A.mcp("cerefox_get_document", { document_id: id, section: "## Parent" });
    const cli = A.cli(["document", "get", id, "--section", "## Parent"]);

    expect(mcp.isError).toBe(true);
    expect(cli.code).not.toBe(0);
    for (const text of [mcp.text, cli.out]) {
      expect(text).toContain("own_body");
      expect(text).toContain("subtree");
      // A read never attempted a write, so it must not claim otherwise.
      expect(text).not.toContain("No write was performed");
    }
  });

  test("read-after-write: what you read is what a replace overwrites (#198)", async () => {
    const { id, hash } = await A.seed("equivalence", DOC);
    const SENTINEL = "SENTINEL-ACCEPTANCE";

    await A.mcp("cerefox_edit", {
      document_id: id,
      expected_content_hash: hash,
      author: "acceptance",
      operations: [{ op: "replace_section", anchor_heading: "## Leaf", text: SENTINEL }],
    });
    const after = JSON.parse((await A.mcp("cerefox_get_document", { document_id: id, section: "## Leaf" })).text);
    expect(after.text.trim()).toBe(SENTINEL);
  });

  test("rename_section keeps the body and the position (#197)", async () => {
    const { id, hash } = await A.seed("rename", DOC);

    const r = await A.mcp("cerefox_edit", {
      document_id: id,
      expected_content_hash: hash,
      author: "acceptance",
      operations: [{ op: "rename_section", anchor_heading: "## Leaf", new_heading: "## Leaf renamed" }],
    });
    expect(r.isError).toBe(false);

    const doc = (await A.mcp("cerefox_get_document", { document_id: id })).text;
    expect(doc).toContain("## Leaf renamed");
    expect(doc).toContain("leaf body");
    expect(doc.indexOf("## Parent")).toBeLessThan(doc.indexOf("## Leaf renamed"));
  });

  test("a level change is refused, on both surfaces (#197)", async () => {
    const { id, hash } = await A.seed("level", DOC);
    const ops = JSON.stringify([
      { op: "rename_section", anchor_heading: "## Leaf", new_heading: "### Leaf" },
    ]);

    const mcp = await A.mcp("cerefox_edit", {
      document_id: id,
      expected_content_hash: hash,
      author: "acceptance",
      operations: JSON.parse(ops),
    });
    const cli = A.cli(["document", "edit-parts", id, "-o", ops, "-e", hash]);

    expect(mcp.isError).toBe(true);
    expect(cli.code).not.toBe(0);
    expect(mcp.text.toLowerCase()).toContain("level");
    expect(cli.out.toLowerCase()).toContain("level");
  });

  test("an emoji document reports no phantom loss on an additive edit", async () => {
    // Guards the UTF-16-vs-code-point defect: cerefox_insert is annotated
    // destructiveHint: false precisely because it cannot lose content.
    const { id, hash } = await A.seed("emoji", "# Emoji\n\n## Body\n\nDeployed 🎉 shipped 📝\n");
    const r = await A.mcp("cerefox_insert", {
      document_id: id,
      expected_content_hash: hash,
      author: "acceptance",
      text: "an added line",
      position: "end_of_document",
    });
    expect(r.isError).toBe(false);
    expect(r.text).not.toMatch(/removed \d+ characters/);
  });

  test("clobbering the last section warns however small the ratio (#196)", async () => {
    const big = `# Big\n\n## Body\n\n${"filler line\n".repeat(200)}\n## Tail\n\ntail\n`;
    const { id, hash } = await A.seed("shrink", big);

    const ins = await A.mcp("cerefox_insert", {
      document_id: id,
      expected_content_hash: hash,
      author: "acceptance",
      text: "appended after the last heading",
      position: "end_of_document",
    });
    const h2 = /New content_hash: ([0-9a-f]{64})/.exec(ins.text)?.[1] ?? hash;

    const r = await A.mcp("cerefox_edit", {
      document_id: id,
      expected_content_hash: h2,
      author: "acceptance",
      operations: [{ op: "replace_section", anchor_heading: "## Tail", text: "replaced" }],
    });
    expect(r.text).toMatch(/removed \d+ characters/);
    expect(r.text).toContain("LAST section");
  });

  test("timestamps carry their zone (#199)", async () => {
    const { id } = await A.seed("timestamps", DOC);
    const versions = (await A.mcp("cerefox_list_versions", { document_id: id })).text;
    // A bare date is indistinguishable from a local one, which is how a day of
    // entries ended up in the future.
    if (/\d{4}-\d{2}-\d{2}/.test(versions)) {
      expect(versions).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
    }
  });

  test("delete requires the read-hash and a stale one is a conflict, not a delete (#208)", async () => {
    const { id, hash } = await A.seed("delete-guard", DOC);

    const noHash = await A.mcp("cerefox_delete_document", { document_id: id });
    expect(noHash.isError).toBe(true);
    expect(noHash.text).toContain("expected_content_hash");

    const stale = await A.mcp("cerefox_delete_document", {
      document_id: id,
      expected_content_hash: "0".repeat(64),
    });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("changed since you read it");

    // Neither attempt deleted anything: the document still reads back whole.
    const read = await A.mcp("cerefox_get_document", { document_id: id });
    expect(read.isError).toBe(false);
    expect(read.text).toContain(hash);
  });

  test("delete with the read-hash soft-deletes, records the reason, and re-delete is a no-op (#208)", async () => {
    const { id, hash } = await A.seed("delete-happy", DOC);

    const del = await A.mcp("cerefox_delete_document", {
      document_id: id,
      expected_content_hash: hash,
      reason: "acceptance fixture — should be visible in audit",
      author: "acceptance",
    });
    expect(del.isError).toBe(false);
    expect(del.text).toContain("Soft-deleted");
    expect(del.text).toContain("recoverable");

    // The reason is what the human reviewing the trash goes on.
    const audit = (await A.mcp("cerefox_get_audit_log", { document_id: id, operation: "delete" })).text;
    expect(audit).toContain("should be visible in audit");

    // Idempotent: the original deletion stands, no second audit entry.
    const again = await A.mcp("cerefox_delete_document", {
      document_id: id,
      expected_content_hash: hash,
    });
    expect(again.isError).toBe(false);
    expect(again.text).toContain("ALREADY soft-deleted");

    // The read-proof holds in the trash too: a garbage hash on an
    // already-deleted document is a conflict, not a comfortable no-op.
    const garbage = await A.mcp("cerefox_delete_document", {
      document_id: id,
      expected_content_hash: "0".repeat(64),
    });
    expect(garbage.isError).toBe(true);
    expect(garbage.text).toContain("changed since you read it");
    const auditAfter = (await A.mcp("cerefox_get_audit_log", { document_id: id, operation: "delete" })).text;
    expect((auditAfter.match(/Soft-deleted document/g) ?? []).length).toBe(1);

    // The path back (#210): MCP restore, the delete's audited inverse.
    const restored = await A.mcp("cerefox_restore_document", {
      document_id: id,
      reason: "acceptance roundtrip",
      author: "acceptance",
    });
    expect(restored.isError).toBe(false);
    expect(restored.text).toContain("Restored");
    const back = await A.mcp("cerefox_get_document", { document_id: id });
    expect(back.isError).toBe(false);

    // Restoring a live document is a reported no-op, and the CLI verb still
    // works as the human-surface equivalent.
    const again2 = await A.mcp("cerefox_restore_document", { document_id: id });
    expect(again2.isError).toBe(false);
    expect(again2.text).toContain("NOT deleted");
    const cliRestore = A.cli(["document", "restore", id, "--author", "acceptance"]);
    expect(cliRestore.code).toBe(0);

    // CLI delete with --reason: same RPC, reason recorded, exit clean.
    const cliDel = A.cli([
      "document", "delete", id, "--yes",
      "--reason", "acceptance cleanup",
      "--author", "acceptance", "--author-type", "agent",
    ]);
    expect(cliDel.code).toBe(0);
    expect(cliDel.out).toContain("recorded in the audit log");

    // Trashed documents refuse content updates on every resolution path —
    // this is what makes restore safe without a freshness token.
    const byId = await A.mcp("cerefox_ingest", {
      document_id: id,
      title: "whatever",
      content: "# New\n\nrewrite attempt",
      author: "acceptance",
    });
    expect(byId.isError).toBe(true);
    expect(byId.text).toContain("soft-deleted");
    expect(byId.text).toContain("restore");
  });

  test("unresolvable ](uuid) links reject the write; code formatting escapes (#214)", async () => {
    const { id: realId } = await A.seed("link-target", DOC);
    const bogus = "00000000-dead-beef-0000-000000000000";

    // A link to a REAL document passes.
    const ok = await A.mcp("cerefox_ingest", {
      title: `[E2E acceptance] linker ${Date.now() % 1e6}`,
      content: `# Linker\n\nSee [the target](${realId}) for details.\n`,
      author: "acceptance",
    });
    expect(ok.isError).toBe(false);
    const okId = ok.text.match(/id: ([0-9a-f-]{36})/)?.[1];
    // Every write returns the new hash (#189) — capture it here rather than
    // re-reading via outline, whose header format this regex once mismatched.
    const okHash = ok.text.match(/([0-9a-f]{64})/)?.[1];
    if (okId) A.track(okId);

    // A mangled id is rejected, naming the offender — the agent can
    // self-correct in the same turn.
    const bad = await A.mcp("cerefox_ingest", {
      title: `[E2E acceptance] bad linker ${Date.now() % 1e6}`,
      content: `# Bad\n\nSee [broken](${bogus}).\n`,
      author: "acceptance",
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain(bogus);
    expect(bad.text).toContain("mangled");

    // Code formatting is the escape: the same bogus id inside a fence and
    // inline code is an EXAMPLE, not a link, and passes.
    const escaped = await A.mcp("cerefox_ingest", {
      title: `[E2E acceptance] escaped linker ${Date.now() % 1e6}`,
      content:
        `# Escaped\n\nExample syntax: \`[Text](${bogus})\`.\n\n` +
        "```\n" + `[Also fine](${bogus})\n` + "```\n",
      author: "acceptance",
    });
    expect(escaped.isError).toBe(false);
    const escId = escaped.text.match(/id: ([0-9a-f-]{36})/)?.[1];
    if (escId) A.track(escId);

    // Partial edits go through the same guard: an edit that introduces a
    // dead link is rejected with the same self-correction loop.
    expect(okId).toBeDefined();
    expect(okHash).toBeDefined();
    const edit = await A.mcp("cerefox_insert", {
      document_id: okId!,
      position: "end_of_document",
      text: `\nAnd [a mangled one](${bogus}).\n`,
      expected_content_hash: okHash!,
      author: "acceptance",
    });
    expect(edit.isError).toBe(true);
    expect(edit.text).toContain(bogus);
  });
});
