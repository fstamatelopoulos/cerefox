/**
 * HTTP-boundary tests for the 5 destructive web endpoints.
 *
 * Filling the 24L gap: Part 24E shipped DELETE / restore / purge /
 * review-status / version-archive as code-review-only because the
 * locked decision said "Python pytest covers the /api/v1/* HTTP
 * boundary at the manual-test-plan walk." That framing turned out to
 * be wrong — `tests/e2e/test_api_e2e.py` calls `CerefoxClient` directly
 * and never exercises Hono routes. This test file fills the gap with
 * real curl-level coverage that runs on every `bun test`.
 *
 * Pattern: spawn the bin on a random port, ingest a test doc via the
 * deployed cerefox-ingest Edge Function (since v0.6's web /ingest is a
 * 503 stub), exercise the mutation endpoints in sequence, end with
 * /purge so cleanup is automatic. Probe-and-skip when Supabase isn't
 * reachable.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  ingestViaEdgeFunction,
  probeSupabase,
  spawnWebServer,
  type SpawnedServer,
} from "./_helpers.js";

const LIVE_OK = probeSupabase();

describe("destructive web endpoints (HTTP boundary)", () => {
  let server: SpawnedServer | null = null;
  let docId: string | null = null;

  beforeAll(async () => {
    if (!LIVE_OK) return;
    server = await spawnWebServer();
    docId = await ingestViaEdgeFunction({
      title: `[E2E web-destructive] iter-24L follow-up ${Date.now()}`,
      content:
        "# Destructive endpoint smoke\n\n" +
        "Created by the web-integration test suite to exercise the v0.6\n" +
        "mutation endpoints end-to-end. Purged automatically when the\n" +
        "test finishes.\n",
      author: "web-destructive-test",
    });
  });

  afterAll(async () => {
    // Best-effort cleanup: try purge directly; if the doc isn't
    // soft-deleted yet, soft-delete first then purge. Swallow errors
    // so afterAll never fails the suite.
    if (server && docId) {
      try {
        await fetch(`${server.base}/api/v1/documents/${docId}/purge`, {
          method: "DELETE",
        });
      } catch {
        /* ignore */
      }
      try {
        await fetch(`${server.base}/api/v1/documents/${docId}`, {
          method: "DELETE",
        });
        await fetch(`${server.base}/api/v1/documents/${docId}/purge`, {
          method: "DELETE",
        });
      } catch {
        /* ignore */
      }
    }
    if (server) await server.stop();
  });

  test("setup: live probe succeeded and a test doc exists", () => {
    if (!LIVE_OK) {
      console.log("(skipped: Supabase not reachable)");
      return;
    }
    expect(docId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  test("review-status flip: pending_review → approved → reflected in GET", async () => {
    if (!LIVE_OK || !server || !docId) return;
    // EF-authored docs land as pending_review (author_type=agent). Confirm.
    const baseline = await (
      await fetch(`${server.base}/api/v1/documents/${docId}`)
    ).json();
    expect(baseline.review_status).toBe("pending_review");

    // Flip to approved.
    const flip = await fetch(
      `${server.base}/api/v1/documents/${docId}/review-status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      },
    );
    expect(flip.ok).toBe(true);
    const flipBody = await flip.json();
    expect(flipBody.status).toBe("approved");

    // Verify the GET reflects it.
    const after = await (
      await fetch(`${server.base}/api/v1/documents/${docId}`)
    ).json();
    expect(after.review_status).toBe("approved");
  });

  test("soft-delete: DELETE moves doc to trash, restore brings it back", async () => {
    if (!LIVE_OK || !server || !docId) return;

    // DELETE → expect success body, doc in /documents/trash.
    const del = await fetch(`${server.base}/api/v1/documents/${docId}`, {
      method: "DELETE",
    });
    expect(del.ok).toBe(true);
    // 0.12.0: the route passes through the RPC's honesty signal.
    expect(await del.json()).toEqual({ success: true, already_deleted: false });

    const trashed = (await (
      await fetch(`${server.base}/api/v1/documents/trash?limit=20`)
    ).json()) as Array<{ id: string }>;
    expect(trashed.some((d) => d.id === docId)).toBe(true);

    // Dashboard recent_docs should NOT include it (it's soft-deleted).
    const dashAfterDelete = (await (
      await fetch(`${server.base}/api/v1/dashboard`)
    ).json()) as { recent_docs: Array<{ id: string }> };
    expect(dashAfterDelete.recent_docs.some((d) => d.id === docId)).toBe(false);

    // Restore → out of trash, back in recent_docs.
    const restore = await fetch(
      `${server.base}/api/v1/documents/${docId}/restore`,
      { method: "POST" },
    );
    expect(restore.ok).toBe(true);
    // 0.12.0: the route passes through the RPC's honesty signal.
    expect(await restore.json()).toEqual({ success: true, restored: true });

    const trashedAfter = (await (
      await fetch(`${server.base}/api/v1/documents/trash?limit=20`)
    ).json()) as Array<{ id: string }>;
    expect(trashedAfter.some((d) => d.id === docId)).toBe(false);

    const dashAfterRestore = (await (
      await fetch(`${server.base}/api/v1/dashboard`)
    ).json()) as { recent_docs: Array<{ id: string }> };
    expect(dashAfterRestore.recent_docs.some((d) => d.id === docId)).toBe(true);
  });

  test("hard delete: DELETE + purge → 404 on GET, gone from trash", async () => {
    if (!LIVE_OK || !server || !docId) return;

    // Soft-delete first (purge only works on already-soft-deleted docs).
    const del = await fetch(`${server.base}/api/v1/documents/${docId}`, {
      method: "DELETE",
    });
    expect(del.ok).toBe(true);

    // Purge.
    const purge = await fetch(
      `${server.base}/api/v1/documents/${docId}/purge`,
      { method: "DELETE" },
    );
    expect(purge.ok).toBe(true);
    expect(await purge.json()).toEqual({ success: true });

    // GET should now 404.
    const getResp = await fetch(`${server.base}/api/v1/documents/${docId}`);
    expect(getResp.status).toBe(404);

    // Trash should not include it.
    const trashed = (await (
      await fetch(`${server.base}/api/v1/documents/trash?limit=20`)
    ).json()) as Array<{ id: string }>;
    expect(trashed.some((d) => d.id === docId)).toBe(false);

    // Clear the cleanup target so afterAll doesn't double-purge.
    docId = null;
  });

  test("version archive flip: archive → reflected, unarchive → reverted", async () => {
    if (!LIVE_OK || !server) return;
    // Pick any document with at least one version. We can't reuse the
    // purged test doc; pull from /dashboard.recent_docs[0] and find one
    // whose versions list is non-empty.
    const dash = (await (
      await fetch(`${server.base}/api/v1/dashboard`)
    ).json()) as { recent_docs: Array<{ id: string }> };
    let targetDocId: string | null = null;
    let versionId: string | null = null;
    let originalArchived = false;
    for (const d of dash.recent_docs) {
      const versions = (await (
        await fetch(`${server.base}/api/v1/documents/${d.id}/versions`)
      ).json()) as Array<{ version_id: string; archived: boolean }>;
      if (versions.length > 0) {
        targetDocId = d.id;
        versionId = versions[0].version_id;
        originalArchived = versions[0].archived;
        break;
      }
    }
    if (!targetDocId || !versionId) {
      console.log("(skipped: no versions in any recent doc)");
      return;
    }

    const newState = !originalArchived;
    const flip = await fetch(
      `${server.base}/api/v1/documents/${targetDocId}/versions/${versionId}/archive`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: newState }),
      },
    );
    expect(flip.ok).toBe(true);
    expect(await flip.json()).toEqual({ archived: newState });

    // Verify.
    const versionsAfter = (await (
      await fetch(`${server.base}/api/v1/documents/${targetDocId}/versions`)
    ).json()) as Array<{ version_id: string; archived: boolean }>;
    const flipped = versionsAfter.find((v) => v.version_id === versionId);
    expect(flipped?.archived).toBe(newState);

    // Revert so the doc's state is unchanged from the test's perspective.
    await fetch(
      `${server.base}/api/v1/documents/${targetDocId}/versions/${versionId}/archive`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: originalArchived }),
      },
    );
  });
});
