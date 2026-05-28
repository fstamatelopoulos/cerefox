/**
 * Document write endpoints (Part 24E — 6 endpoints):
 *
 *   POST   /api/v1/documents/{document_id}/edit
 *   DELETE /api/v1/documents/{document_id}
 *   POST   /api/v1/documents/{document_id}/restore
 *   DELETE /api/v1/documents/{document_id}/purge
 *   POST   /api/v1/documents/{document_id}/review-status
 *   POST   /api/v1/documents/{document_id}/versions/{version_id}/archive
 *
 * Python source: `src/cerefox/api/routes_api.py` lines 924-991, 1282-1312.
 *
 * Soft-delete / restore / purge / review-status / version-archive call
 * the dedicated Postgres RPCs (cerefox_delete_document /
 * cerefox_restore_document / cerefox_purge_document) or perform direct
 * UPDATEs + cerefox_create_audit_entry. Audit-log parity with Python is
 * preserved by routing every state change through the same RPCs / audit
 * helper the Python client uses.
 *
 * /edit is the only handler that needs the v0.7 ingestion pipeline
 * for content changes. v0.6's /edit detects content-only changes by
 * comparing SHA-256(normalised content) against the document's stored
 * content_hash:
 *   - hash matches (or content empty) → metadata-only path: title /
 *     metadata / project memberships updated directly, audit entry
 *     "update-metadata", success.
 *   - hash differs → 503 with the v0.7 deferral body the frontend
 *     handles via the same toast as the ingestion stubs (Part 24H).
 * The Python /edit always went through IngestionPipeline.update_document
 * which performs the same hash short-circuit internally before doing the
 * expensive re-chunk + re-embed. We surface the same behaviour without
 * the pipeline.
 */

import { Hono } from "hono";

import { contentHash } from "../../../../../_shared/ingest/index.ts";
import type { WebContext } from "../context.ts";

const V07_MIGRATION_URL =
  "https://github.com/fstamatelopoulos/cerefox/blob/main/docs/guides/migration-v0.5.md#v06";

// `normaliseForHash` + `contentHash` promoted to `_shared/ingest/pipeline-
// helpers.ts` in iter-25 Part 25C so the TS ingestion pipeline (v0.7) and
// the v0.6 /edit content-hash short-circuit share one implementation.
// Drift = dedup breaks across the CLI / web / Python paths.

async function createAuditEntry(
  ctx: WebContext,
  args: {
    operation: string;
    author: string;
    authorType?: string;
    documentId?: string | null;
    versionId?: string | null;
    sizeBefore?: number | null;
    sizeAfter?: number | null;
    description?: string;
  },
): Promise<void> {
  try {
    await ctx.supabase.rpc("cerefox_create_audit_entry", {
      p_document_id: args.documentId ?? null,
      p_version_id: args.versionId ?? null,
      p_operation: args.operation,
      p_author: args.author,
      p_author_type: args.authorType ?? "user",
      p_size_before: args.sizeBefore ?? null,
      p_size_after: args.sizeAfter ?? null,
      p_description: args.description ?? "",
    });
  } catch {
    // Audit failures don't block the user-visible operation — same as Python.
  }
}

async function assignDocumentProjects(
  ctx: WebContext,
  documentId: string,
  projectIds: string[],
): Promise<void> {
  // Destructive replace (Python's assign_document_projects).
  await ctx.supabase
    .from("cerefox_document_projects")
    .delete()
    .eq("document_id", documentId);
  if (projectIds.length > 0) {
    const rows = projectIds.map((pid) => ({
      document_id: documentId,
      project_id: pid,
    }));
    await ctx.supabase.from("cerefox_document_projects").insert(rows);
  }
}

async function getCurrentDoc(
  ctx: WebContext,
  documentId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await ctx.supabase
    .from("cerefox_documents")
    .select("*")
    .eq("id", documentId)
    .maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

export function registerDocumentWriteRoutes(app: Hono, ctx: WebContext): void {
  // ── POST /documents/{id}/edit ──────────────────────────────────────────────
  app.post("/api/v1/documents/:document_id/edit", async (c) => {
    const documentId = c.req.param("document_id");
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }
    const title = String(body.title ?? "").trim();
    const content = String(body.content ?? "");
    const projectIds = Array.isArray(body.project_ids)
      ? (body.project_ids as string[])
      : [];
    const metadata = (body.metadata as Record<string, string> | undefined) ?? {};

    const doc = await getCurrentDoc(ctx, documentId);
    if (!doc) {
      return c.json({ success: false, error: "Document not found" }, 404);
    }

    const currentHash = doc.content_hash as string | null;
    const proposedHash = content.trim() ? contentHash(content) : null;
    const contentChanged =
      proposedHash !== null && currentHash !== null && proposedHash !== currentHash;

    if (contentChanged) {
      return c.json(
        {
          success: false,
          error: "Ingestion lands in v0.7",
          see: V07_MIGRATION_URL,
          note:
            "Content edits require the in-process ingestion pipeline (chunking + embedding + version snapshot) that ships in v0.7. " +
            "For now, re-ingest from the CLI: `cerefox ingest <file>`. Title / metadata / project changes work in this UI.",
        },
        503,
      );
    }

    // Metadata-only update path. Mirrors the no-content-change branch of
    // Python's IngestionPipeline.update_document.
    const updates: Record<string, unknown> = {};
    if (title && title !== (doc.title as string)) {
      updates.title = title;
    }
    if (Object.keys(metadata).length > 0) {
      updates.metadata = metadata;
    }
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error } = await ctx.supabase
        .from("cerefox_documents")
        .update(updates)
        .eq("id", documentId);
      if (error) return c.json({ success: false, error: error.message }, 500);
    }
    const projectsTouched = Array.isArray(body.project_ids);
    if (projectsTouched) {
      await assignDocumentProjects(ctx, documentId, projectIds);
    }

    const anythingChanged =
      "title" in updates || "metadata" in updates || projectsTouched;
    if (anythingChanged) {
      await createAuditEntry(ctx, {
        operation: "update-metadata",
        author: "web-ui",
        documentId,
        description: `Updated via web UI (title=${
          "title" in updates
        }, metadata=${"metadata" in updates}, projects=${projectsTouched})`,
      });
    }

    return c.json({ success: true, reindexed: false });
  });

  // ── DELETE /documents/{id} ─────────────────────────────────────────────────
  app.delete("/api/v1/documents/:document_id", async (c) => {
    const documentId = c.req.param("document_id");
    const { error } = await ctx.supabase.rpc("cerefox_delete_document", {
      p_document_id: documentId,
      p_author: "web-ui",
      p_author_type: "user",
    });
    if (error) return c.json({ detail: error.message }, 500);
    return c.json({ success: true });
  });

  // ── POST /documents/{id}/restore ───────────────────────────────────────────
  app.post("/api/v1/documents/:document_id/restore", async (c) => {
    const documentId = c.req.param("document_id");
    const { error } = await ctx.supabase.rpc("cerefox_restore_document", {
      p_document_id: documentId,
      p_author: "web-ui",
      p_author_type: "user",
    });
    if (error) return c.json({ detail: error.message }, 500);
    return c.json({ success: true });
  });

  // ── DELETE /documents/{id}/purge ───────────────────────────────────────────
  app.delete("/api/v1/documents/:document_id/purge", async (c) => {
    const documentId = c.req.param("document_id");
    const { error } = await ctx.supabase.rpc("cerefox_purge_document", {
      p_document_id: documentId,
      p_author: "web-ui",
      p_author_type: "user",
    });
    if (error) return c.json({ detail: error.message }, 500);
    return c.json({ success: true });
  });

  // ── POST /documents/{id}/review-status ─────────────────────────────────────
  app.post("/api/v1/documents/:document_id/review-status", async (c) => {
    const documentId = c.req.param("document_id");
    let body: { status?: unknown };
    try {
      body = (await c.req.json()) as { status?: unknown };
    } catch {
      return c.json({ detail: "Invalid JSON body" }, 400);
    }
    const status = body.status;
    if (status !== "approved" && status !== "pending_review") {
      return c.json(
        { detail: `Invalid status: ${JSON.stringify(status)}` },
        400,
      );
    }

    const old = await getCurrentDoc(ctx, documentId);
    const oldStatus = (old?.review_status as string | undefined) ?? "unknown";

    const { error } = await ctx.supabase
      .from("cerefox_documents")
      .update({ review_status: status, updated_at: new Date().toISOString() })
      .eq("id", documentId);
    if (error) return c.json({ detail: error.message }, 500);

    await createAuditEntry(ctx, {
      operation: "status-change",
      author: "user",
      documentId,
      description: `Review status changed from '${oldStatus}' to '${status}'`,
    });
    return c.json({ status });
  });

  // ── POST /documents/{id}/versions/{vid}/archive ────────────────────────────
  app.post(
    "/api/v1/documents/:document_id/versions/:version_id/archive",
    async (c) => {
      const documentId = c.req.param("document_id");
      const versionId = c.req.param("version_id");
      let body: { archived?: unknown };
      try {
        body = (await c.req.json()) as { archived?: unknown };
      } catch {
        return c.json({ detail: "Invalid JSON body" }, 400);
      }
      const archived = Boolean(body.archived);

      const { data, error } = await ctx.supabase
        .from("cerefox_document_versions")
        .update({ archived })
        .eq("id", versionId)
        .select("document_id, version_number")
        .maybeSingle();
      if (error) return c.json({ detail: error.message }, 500);

      const ver = data as
        | { document_id: string; version_number: number }
        | null;
      const op = archived ? "archive" : "unarchive";
      await createAuditEntry(ctx, {
        operation: op,
        author: "user",
        documentId: ver?.document_id ?? documentId,
        versionId,
        description: `Version ${ver?.version_number ?? "?"} ${op}d`,
      });
      return c.json({ archived });
    },
  );
}
