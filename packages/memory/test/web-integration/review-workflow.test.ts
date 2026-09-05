/**
 * The review-workflow toggle (#241), exercised from BOTH sides through the
 * web API — the other live suites read whatever the store happens to be set
 * to and branch on it; this one flips the flag itself so every run covers
 * the off contract AND the on contract, regardless of the target's setting.
 *
 * Off contract: `review_status` is absent from every read (document GET,
 * list, dashboard, metadata-search, trash); `?review_status=` on /search is a
 * 400; POST …/review-status is a 404. The write side is NOT affected: an
 * agent write made while off is still recorded `pending_review`, which the
 * ON test below checks by reading that same document back once the flag is
 * on (v1.13.1 — 1.13.0 stored `approved` for everyone while off, so a
 * stored `approved` meant two different things depending on when it was
 * written).
 * On contract: the agent write lands `pending_review`, the field is present
 * everywhere, the filter works, and the endpoint flips the status.
 *
 * Restores the flag to the value it found in afterAll, and purges its
 * fixtures. Write-bearing, so it carries the production guard.
 */

import { afterAll, beforeAll, describe, expect } from "bun:test";

import { liveTest } from "../_live-test.ts";
import { mayWriteToLiveTarget } from "../_live-target-guard.ts";

import { probeSupabase, spawnWebServer, type SpawnedServer } from "./_helpers.js";

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || process.env.CEREFOX_OPENAI_API_KEY || "";
const LIVE_OK = mayWriteToLiveTarget() && probeSupabase() && OPENAI_API_KEY.length > 0;

const FLAG = "review_workflow_enabled";
const TITLE_PREFIX = "[E2E review-workflow]";
const RUN_TAG = String(Date.now());

describe("review workflow toggle (HTTP boundary, #241)", () => {
  let server: SpawnedServer | null = null;
  let originalFlag: string | null = null;
  const created: string[] = [];
  /** The document written while the flag was OFF; read back once it is ON. */
  let offDocId = "";

  const json = async (path: string, init?: RequestInit) => {
    const resp = await fetch(`${server!.base}${path}`, init);
    return { status: resp.status, body: (await resp.json()) as Record<string, unknown> };
  };
  const post = (path: string, body: unknown, method = "POST") =>
    json(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const setFlag = async (value: "true" | "false") => {
    const { status } = await post(`/api/v1/config/${FLAG}`, { value }, "PUT");
    expect(status).toBe(200);
  };
  const ingestAsAgent = async (label: string): Promise<string> => {
    const { status, body } = await post("/api/v1/ingest", {
      title: `${TITLE_PREFIX} ${label} ${RUN_TAG}`,
      content:
        `# Review workflow ${label}\n\nFixture for the #241 toggle suite. ` +
        `Purged when the run ends. Tag ${RUN_TAG}.\n`,
      author: "review-workflow-test",
      author_type: "agent",
      metadata: { e2e_run: RUN_TAG },
    });
    expect(status).toBe(200);
    const id = String(body.document_id ?? "");
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    created.push(id);
    return id;
  };

  beforeAll(async () => {
    if (!LIVE_OK) return;
    server = await spawnWebServer();
    if (!server) return;
    const { body } = await json(`/api/v1/config/${FLAG}`);
    originalFlag = body.value == null ? null : String(body.value);
  });

  afterAll(async () => {
    if (server) {
      for (const id of created) {
        try {
          await fetch(`${server.base}/api/v1/documents/${id}`, { method: "DELETE" });
          await fetch(`${server.base}/api/v1/documents/${id}/purge`, { method: "DELETE" });
        } catch {
          /* best effort */
        }
      }
      // Leave the store as we found it. A missing row (pre-0031 schema) can't
      // be restored to "absent"; the closest is the fresh-install default.
      try {
        await setFlag(originalFlag === "true" ? "true" : "false");
      } catch {
        /* best effort */
      }
      await server.stop();
    }
  });

  liveTest("OFF: review_status is absent everywhere (write still recorded)", async () => {
    if (!LIVE_OK || !server) return;
    await setFlag("false");
    const id = await ingestAsAgent("off");
    offDocId = id;

    const doc = await json(`/api/v1/documents/${id}`);
    expect(doc.status).toBe(200);
    expect("review_status" in doc.body).toBe(false);

    const recent = await json("/api/v1/dashboard/recent-docs");
    expect(recent.status).toBe(200);
    const recentRows = recent.body.recent_docs as Array<Record<string, unknown>>;
    expect(recentRows.some((r) => r.id === id)).toBe(true);
    for (const r of recentRows) expect("review_status" in r).toBe(false);

    const ms = await post("/api/v1/documents/metadata-search", {
      metadata_filter: { e2e_run: RUN_TAG },
      limit: 10,
    });
    expect(ms.status).toBe(200);
    const msRows = ms.body as unknown as Array<Record<string, unknown>>;
    expect(msRows.some((r) => r.document_id === id)).toBe(true);
    for (const r of msRows) expect("review_status" in r).toBe(false);

    const filtered = await json(`/api/v1/search?q=review&review_status=approved`);
    expect(filtered.status).toBe(400);
    expect(String(filtered.body.detail)).toContain("review workflow is off");

    const flip = await post(`/api/v1/documents/${id}/review-status`, { status: "approved" });
    expect(flip.status).toBe(404);

    // Trash listing strips the field too.
    await fetch(`${server.base}/api/v1/documents/${id}`, { method: "DELETE" });
    const trash = await json("/api/v1/documents/trash");
    const trashRows = (trash.body as unknown as Array<Record<string, unknown>>);
    const trashed = Array.isArray(trashRows) ? trashRows.find((r) => r.id === id) : undefined;
    expect(trashed).toBeDefined();
    expect("review_status" in trashed!).toBe(false);
  });

  liveTest("ON: agent write lands pending_review; filter + endpoint work", async () => {
    if (!LIVE_OK || !server) return;
    await setFlag("true");

    // The flag hides, it never rewrites: the agent write made while OFF above
    // was recorded pending_review all along and surfaces as such now. (It is
    // in the trash since the OFF test's last step; the trash listing carries
    // the field while the workflow is on.)
    if (offDocId) {
      const trash = await json("/api/v1/documents/trash");
      const rows = trash.body as unknown as Array<Record<string, unknown>>;
      const offDoc = Array.isArray(rows) ? rows.find((r) => r.id === offDocId) : undefined;
      expect(offDoc).toBeDefined();
      expect(offDoc!.review_status).toBe("pending_review");
    }

    const id = await ingestAsAgent("on");

    const doc = await json(`/api/v1/documents/${id}`);
    expect(doc.status).toBe(200);
    expect(doc.body.review_status).toBe("pending_review");

    const ms = await post("/api/v1/documents/metadata-search", {
      metadata_filter: { e2e_run: RUN_TAG },
      limit: 10,
    });
    const msRow = (ms.body as unknown as Array<Record<string, unknown>>).find((r) => r.document_id === id);
    expect(msRow?.review_status).toBe("pending_review");

    // #240: the filter is applied server-side, so the pending doc comes back
    // under its own status and not under the other one.
    const pending = await json(
      `/api/v1/search?q=${encodeURIComponent(`review workflow on ${RUN_TAG}`)}&review_status=pending_review&count=50`,
    );
    expect(pending.status).toBe(200);
    const pendingIds = (pending.body.results as Array<Record<string, unknown>>).map((r) => r.document_id);
    expect(pendingIds).toContain(id);
    const approvedOnly = await json(
      `/api/v1/search?q=${encodeURIComponent(`review workflow on ${RUN_TAG}`)}&review_status=approved&count=50`,
    );
    expect(approvedOnly.status).toBe(200);
    expect((approvedOnly.body.results as Array<Record<string, unknown>>).map((r) => r.document_id)).not.toContain(id);

    const bad = await json(`/api/v1/search?q=review&review_status=bogus`);
    expect(bad.status).toBe(400);

    const flip = await post(`/api/v1/documents/${id}/review-status`, { status: "approved" });
    expect(flip.status).toBe(200);
    expect(flip.body.status).toBe("approved");
    const after = await json(`/api/v1/documents/${id}`);
    expect(after.body.review_status).toBe("approved");
  });

  liveTest("a flip takes effect on the next request (no TTL wait)", async () => {
    if (!LIVE_OK || !server || created.length === 0) return;
    // Doc created under ON above is still approved; flipping OFF must hide
    // the field immediately — the config PUT busts the reader's cache.
    const id = created[created.length - 1]!;
    await setFlag("false");
    const off = await json(`/api/v1/documents/${id}`);
    expect("review_status" in off.body).toBe(false);
    await setFlag("true");
    const on = await json(`/api/v1/documents/${id}`);
    expect(on.body.review_status).toBe("approved");
  });
});
