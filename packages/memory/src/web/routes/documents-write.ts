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

import { resolveEmbedderKind } from "../../../../../_shared/embeddings/index.ts";
import { Hono } from "hono";

import { contentHash } from "../../../../../_shared/ingest/index.ts";
import {
  FacetNotFoundError,
  FacetUpdateError,
  FacetValidationError,
  updateDocumentFacets,
} from "../../../../../_shared/mcp-tools/_document-meta.ts";
import { isDocumentNotFoundError } from "../../../../../_shared/mcp-tools/_utils.ts";
import { reviewWorkflowEnabled } from "../../../../../_shared/mcp-tools/feature-flags.ts";
import type { MCPSupabaseClient } from "../../../../../_shared/mcp-tools/types.ts";
import {
  ConcurrencyConflictError,
  ConcurrencyTokenRequiredError,
  IngestionPipeline,
} from "../../ingestion/pipeline.ts";
import type { WebContext } from "../context.ts";
import { resolveCallerIdentity } from "../identity.ts";

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
    const who = resolveCallerIdentity(c, body);
    if (!who.ok) return c.json({ detail: who.detail }, 400);
    const title = String(body.title ?? "").trim();
    const content = String(body.content ?? "");
    const projectIds = Array.isArray(body.project_ids)
      ? (body.project_ids as string[])
      : [];
    // Runtime-validated, not just cast (#212 round 5): body.metadata reaches a
    // jsonb column via a direct table update below, and a string here would
    // recreate exactly the corrupt state the 0.12.2 guards exist to prevent
    // (Object.keys("abc") is [0,1,2] — the cast is compile-time only).
    if (
      body.metadata !== undefined &&
      body.metadata !== null &&
      (typeof body.metadata !== "object" || Array.isArray(body.metadata))
    ) {
      return c.json(
        { success: false, error: "metadata must be a JSON object of key/value pairs" },
        400,
      );
    }
    const metadata = (body.metadata as Record<string, unknown> | undefined) ?? {};

    const doc = await getCurrentDoc(ctx, documentId);
    if (!doc) {
      return c.json({ success: false, error: "Document not found" }, 404);
    }
    if (doc.deleted_at) {
      // Covers BOTH branches below (content-changed and metadata-only): the
      // pipeline/RPC only guard the content path, and a metadata-only save
      // from a stale tab was silently mutating a trashed document.
      return c.json(
        {
          success: false,
          error: "document is in the trash",
          message:
            "This document was moved to the trash while you were editing. " +
            "Restore it from the Trash page first, then save again.",
        },
        409,
      );
    }

    const currentHash = doc.content_hash as string | null;
    const proposedHash = content.trim() ? contentHash(content) : null;
    const contentChanged =
      proposedHash !== null && currentHash !== null && proposedHash !== currentHash;

    // v0.7 (iter-25 Part 25E): content-change branch now routes through
    // the in-process TS ingestion pipeline. Previously returned 503 with
    // the V07IngestionDeferredError body the frontend toast catches.
    // The toast detector stays in `client.ts` as dead code — keeps the
    // pattern in place for any future 503 fallback we might want, and
    // avoids frontend churn.
    if (contentChanged) {
      if (!ctx.openAiApiKey && resolveEmbedderKind() !== "local") {
        return c.json(
          {
            success: false,
            error: "Embedder not available — set OPENAI_API_KEY in your config",
          },
          503,
        );
      }
      try {
        const pipeline = new IngestionPipeline({
          supabase: ctx.supabase,
          openAiApiKey: ctx.openAiApiKey ?? "",
        });
        const result = await pipeline.updateDocument({
          documentId,
          text: content,
          title: title || (doc.title as string),
          source: "manual",
          projectIds: Array.isArray(body.project_ids)
            ? (body.project_ids as string[])
            : undefined,
          // Carried-vs-absent (round 2): {} must CLEAR metadata on a
          // content-changing save too, not silently vanish.
          metadata: body.metadata != null ? metadata : undefined,
          author: who.identity.author,
          authorType: who.identity.authorType,
          // Optimistic concurrency (iter-32): the SPA sends the content_hash
          // it loaded the document with; a concurrent change → 409 below.
          expectedContentHash:
            typeof body.expected_content_hash === "string"
              ? body.expected_content_hash
              : null,
        });
        return c.json({ success: true, reindexed: result.reindexed });
      } catch (err) {
        if (err instanceof ConcurrencyConflictError) {
          return c.json(
            {
              success: false,
              error: "conflict",
              message:
                "This document changed while you were editing it (another writer saved a newer version). Open it again in a new tab, merge your changes, and save from there.",
              current_hash: err.currentHash,
            },
            409,
          );
        }
        if (err instanceof ConcurrencyTokenRequiredError) {
          return c.json(
            {
              success: false,
              error: "expected_content_hash required",
              message: err.message,
            },
            400,
          );
        }
        const msg = err instanceof Error ? err.message : String(err);
        // Link integrity (#214): unresolvable [Text](uuid) links reject the
        // write. 422 — the request is well-formed but the content fails a
        // semantic check the editor can fix.
        if (msg.includes("CEREFOX_UNRESOLVED_LINKS")) {
          const ids = msg.match(/do not exist: ([^.]+)\./)?.[1] ?? "";
          return c.json(
            {
              success: false,
              error: "unresolved document links",
              message:
                `This content links document id(s) that don't exist${ids ? `: ${ids}` : ""}. ` +
                `Fix or remove the broken link(s), or wrap example ids in backticks.`,
            },
            422,
          );
        }
        // 0.12.0: the ingest RPC refuses to rewrite a trashed document. The
        // only web path here is a stale edit tab (the UI hides Edit on
        // deleted docs), so phrase it for a human and class it as a
        // conflict-with-current-state, not a server fault.
        if (msg.includes("soft-deleted")) {
          return c.json(
            {
              success: false,
              error: "document is in the trash",
              message:
                "This document was moved to the trash while you were editing. " +
                "Restore it from the Trash page first, then save again.",
            },
            409,
          );
        }
        return c.json({ success: false, error: msg }, 500);
      }
    }

    // Meta-facet update path — the shared orchestrator (iteration 39). Each
    // facet applies through its single implementation, diffs against the
    // stored value (a facet the request carried unchanged is skipped, so the
    // trail never records non-events), and writes its own factual audit
    // entry. This route used to raw-write title (skipping the FTS refresh
    // title boosting requires), raw-replace metadata (bypassing the #212
    // guards), and record the REQUEST shape ("title=false, metadata=true,
    // projects=true") instead of what changed.
    try {
      const facets = await updateDocumentFacets(ctx.supabase as unknown as MCPSupabaseClient, {
        documentId,
        // Carried-vs-absent AND pre-diffed: an unchanged title never
        // invokes the rename RPC (0.15.0-only — a 0.14.x server must keep
        // serving metadata/project saves), and a CLEARED title flows through
        // to the typed 400 instead of silently collapsing to "absent".
        title:
          body.title !== undefined && title !== (doc.title as string) ? title : undefined,
        // Carried-vs-absent, NOT empty-vs-non-empty: metadata {} means
        // "clear every key" (review round 1 — deleting the last key in the
        // editor used to be a silent no-op that toasted success).
        // != null: an explicit JSON null is "not provided", NOT carried-{}
        // (which clears every key) — round 2 caught null wiping metadata.
        metadata: body.metadata != null ? metadata : undefined,
        projectIds: Array.isArray(body.project_ids) ? projectIds : undefined,
        author: who.identity.author,
        authorType: who.identity.authorType,
        accessPath: who.identity.accessPath,
      });
      return c.json({ success: true, reindexed: false, ...facets });
    } catch (err) {
      // Typed errors from the cores (review round 1: no status-by-prose).
      // FacetUpdateError wraps the real cause and names any facets that
      // committed before the failure; classify by the CAUSE, report the
      // wrapper's honest combined message. `detail` is the key ApiError
      // surfaces in the frontend toast.
      const cause = err instanceof FacetUpdateError ? err.cause : err;
      const msg = err instanceof Error ? err.message : String(err);
      if (cause instanceof FacetNotFoundError) {
        return c.json({ success: false, error: msg, detail: msg }, 404);
      }
      if (cause instanceof FacetValidationError) {
        return c.json({ success: false, error: msg, detail: msg }, 400);
      }
      return c.json({ success: false, error: msg, detail: msg }, 500);
    }
  });

  // ── DELETE /documents/{id} ─────────────────────────────────────────────────
  app.delete("/api/v1/documents/:document_id", async (c) => {
    const documentId = c.req.param("document_id");
    // No body on this method — identity comes from headers only.
    const who = resolveCallerIdentity(c);
    if (!who.ok) return c.json({ detail: who.detail }, 400);

    // Optimistic locking on delete (iter-40). The RPC has taken an optional
    // CAS token since 0.12.0 (#208) and cerefox_delete_document over MCP
    // REQUIRES it: a delete must follow a read. This route passed nothing,
    // which was defensible while the only caller was the web UI, where the
    // human sees the document and confirms in a dialog.
    //
    // Opening the surface to identified clients removes that safeguard without
    // replacing it, so: a caller that names itself must present the hash, the
    // same rule it would meet over MCP. An anonymous caller is the bundled web
    // UI and keeps today's behaviour exactly, which is the compatibility
    // promise this whole change is built on.
    const expectedHash = (
      c.req.header("x-cerefox-expected-content-hash") ??
      c.req.query("expected_content_hash") ??
      ""
    ).trim();
    if (who.identity.named && expectedHash === "") {
      return c.json(
        {
          detail:
            "CEREFOX_TOKEN_REQUIRED: an identified caller must send the content_hash it read, " +
            "as the X-Cerefox-Expected-Content-Hash header or an expected_content_hash query " +
            "parameter. A delete must follow a read.",
        },
        400,
      );
    }

    const { data, error } = await ctx.supabase.rpc("cerefox_delete_document", {
      p_document_id: documentId,
      p_author: who.identity.author,
      p_author_type: who.identity.authorType,
      p_expected_content_hash: expectedHash === "" ? null : expectedHash,
    });
    if (error) {
      // 0.12.0: a missing document RAISEs instead of silently no-opping. A
      // client-state race (deleted in another tab) is a 404, not a 500.
      if (isDocumentNotFoundError(error)) {
        return c.json({ detail: `Document ${documentId} not found` }, 404);
      }
      return c.json({ detail: error.message }, 500);
    }
    // A pre-0.12.0 VOID RPC returns null — its outcome is UNKNOWN, so no
    // fabricated honesty field: only report already_deleted when the server
    // actually said so.
    const row = data as { already_deleted?: boolean } | null;
    return c.json({ success: true, ...(row ? { already_deleted: row.already_deleted ?? false } : {}) });
  });

  // ── POST /documents/{id}/restore ───────────────────────────────────────────
  app.post("/api/v1/documents/:document_id/restore", async (c) => {
    const documentId = c.req.param("document_id");
    // No body on this method — identity comes from headers only.
    const who = resolveCallerIdentity(c);
    if (!who.ok) return c.json({ detail: who.detail }, 400);
    const { data, error } = await ctx.supabase.rpc("cerefox_restore_document", {
      p_document_id: documentId,
      p_author: who.identity.author,
      p_author_type: who.identity.authorType,
    });
    if (error) {
      // Two-tab race: A purges, B restores. 404 keeps the wrong-state class
      // out of the 5xx monitoring bucket and off the raw-RPC-text toast.
      if (isDocumentNotFoundError(error)) {
        return c.json({ detail: `Document ${documentId} not found` }, 404);
      }
      return c.json({ detail: error.message }, 500);
    }
    // Never fabricate the honesty signal: a pre-0.12.0 VOID RPC (standard
    // upgrade order runs the client update before `server deploy`) returns
    // null and may have silently no-opped — claiming restored:true there
    // reported success for a possibly-purged document.
    const row = data as { restored?: boolean } | null;
    return c.json({ success: true, ...(row ? { restored: row.restored ?? false } : {}) });
  });

  // ── DELETE /documents/{id}/purge ───────────────────────────────────────────
  app.delete("/api/v1/documents/:document_id/purge", async (c) => {
    const documentId = c.req.param("document_id");
    // No body on this method — identity comes from headers only.
    const who = resolveCallerIdentity(c);
    if (!who.ok) return c.json({ detail: who.detail }, 400);
    const { error } = await ctx.supabase.rpc("cerefox_purge_document", {
      p_document_id: documentId,
      p_author: who.identity.author,
      p_author_type: who.identity.authorType,
    });
    if (error) return c.json({ detail: error.message }, 500);
    return c.json({ success: true });
  });

  // ── POST /documents/{id}/review-status ─────────────────────────────────────
  app.post("/api/v1/documents/:document_id/review-status", async (c) => {
    // With the review workflow off the route does not exist (#241): a 404,
    // not a silent write into a field nothing displays.
    if (!(await reviewWorkflowEnabled(ctx.supabase))) {
      return c.json(
        {
          detail:
            "The review workflow is off on this store " +
            "(cerefox config set review_workflow_enabled true to enable it).",
        },
        404,
      );
    }
    const documentId = c.req.param("document_id");
    let body: { status?: unknown };
    try {
      body = (await c.req.json()) as { status?: unknown };
    } catch {
      return c.json({ detail: "Invalid JSON body" }, 400);
    }
    const who = resolveCallerIdentity(c, body);
    if (!who.ok) return c.json({ detail: who.detail }, 400);
    const status = body.status;
    if (status !== "approved" && status !== "pending_review") {
      return c.json(
        { detail: `Invalid status: ${JSON.stringify(status)}` },
        400,
      );
    }

    const old = await getCurrentDoc(ctx, documentId);
    if (old?.deleted_at) {
      // Same invariant as content updates: a trashed document is immutable
      // until restored (0.12.0). A stale tab's toggle gets a 409, not a
      // silent write into the trash.
      return c.json(
        { detail: "This document is in the trash — restore it before changing its review status." },
        409,
      );
    }
    const oldStatus = (old?.review_status as string | undefined) ?? "unknown";

    const { error } = await ctx.supabase
      .from("cerefox_documents")
      .update({ review_status: status, updated_at: new Date().toISOString() })
      .eq("id", documentId);
    if (error) return c.json({ detail: error.message }, 500);

    await createAuditEntry(ctx, {
      operation: "status-change",
      author: who.identity.author,
      authorType: who.identity.authorType,
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
      const who = resolveCallerIdentity(c, body);
      if (!who.ok) return c.json({ detail: who.detail }, 400);
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
        author: who.identity.author,
        authorType: who.identity.authorType,
        documentId: ver?.document_id ?? documentId,
        versionId,
        description: `Version ${ver?.version_number ?? "?"} ${op}d`,
      });
      return c.json({ archived });
    },
  );
}
