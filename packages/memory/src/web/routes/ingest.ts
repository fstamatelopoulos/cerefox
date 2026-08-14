/**
 * Ingestion endpoints (Part 25F — swap from 503 stubs to real handlers):
 *
 *   POST /api/v1/ingest                            — paste mode
 *   POST /api/v1/ingest/file                       — multipart file upload
 *   POST /api/v1/documents/{document_id}/upload    — replace existing content
 *
 * v0.6 (Part 24H) shipped these as 503 stubs with a friendly toast.
 * v0.7 (this Part) wires them to the in-process `IngestionPipeline`.
 * Frontend's `V07IngestionDeferredError` toast detector stays in
 * `api/client.ts` as dead code — no frontend changes required.
 *
 * Python source (kept through v0.7.x for the legacy Python web):
 *   - api_ingest_paste     (routes_api.py:1030)
 *   - api_ingest_file      (routes_api.py:1074)
 *   - api_upload_content   (routes_api.py:994)
 *
 * Embedder dependency: when `ctx.openAiApiKey` is null these endpoints
 * return 503 with `error: "Embedder not available"` — matches Python's
 * `Embedder not available` 503 shape.
 */

import { resolveEmbedderKind } from "../../../../../_shared/embeddings/index.ts";
import { Hono } from "hono";

import { fileToMarkdown } from "../../ingestion/file-to-markdown.ts";
import { IngestionPipeline } from "../../ingestion/pipeline.ts";
import type { WebContext } from "../context.ts";
import { logWebUsage } from "../usage.ts";

interface IngestResponse {
  success: boolean;
  document_id?: string;
  title?: string;
  skipped?: boolean;
  updated?: boolean;
  note?: string;
  error?: string;
}

function notReady(error: string): IngestResponse {
  return { success: false, error };
}

export function registerIngestRoutes(app: Hono, ctx: WebContext): void {
  // ── POST /api/v1/ingest (paste) ───────────────────────────────────────────
  app.post("/api/v1/ingest", async (c) => {
    if (!ctx.openAiApiKey && resolveEmbedderKind() !== "local") {
      return c.json(notReady("Embedder not available"), 503);
    }

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json(notReady("Invalid JSON body"), 400);
    }
    const title = String(body.title ?? "").trim();
    const content = String(body.content ?? "");

    if (!title) return c.json(notReady("Title is required."), 200);
    if (!content.trim()) return c.json(notReady("Content cannot be empty."), 200);

    try {
      const pipeline = new IngestionPipeline({
        supabase: ctx.supabase,
        openAiApiKey: ctx.openAiApiKey ?? "",
      });
      const result = await pipeline.ingestText({
        text: content.trim(),
        title,
        source: "paste",
        projectIds: Array.isArray(body.project_ids)
          ? (body.project_ids as string[])
          : null,
        metadata: (body.metadata as Record<string, string> | undefined) ?? null,
        updateExisting: Boolean(body.update_existing),
        documentId: (body.document_id as string | undefined) ?? null,
        author: "web-ui",
        authorType: "user",
      });
      const skipped = result.action === "skipped";
      const resp: IngestResponse = {
        success: !skipped,
        document_id: result.documentId,
        title: result.title,
        skipped,
        updated: result.reindexed,
      };
      if (result.note) resp.note = result.note;
      logWebUsage(ctx, { operation: "ingest", document_id: result.documentId });
      return c.json(resp, 200);
    } catch (err) {
      return c.json(
        notReady(err instanceof Error ? err.message : String(err)),
        200,
      );
    }
  });

  // ── POST /api/v1/ingest/file (multipart) ──────────────────────────────────
  app.post("/api/v1/ingest/file", async (c) => {
    if (!ctx.openAiApiKey && resolveEmbedderKind() !== "local") {
      return c.json(notReady("Embedder not available"), 503);
    }

    let form: { [k: string]: unknown };
    try {
      form = await c.req.parseBody();
    } catch (err) {
      return c.json(
        notReady(`Invalid multipart body: ${err instanceof Error ? err.message : err}`),
        400,
      );
    }
    const file = form.file as File | undefined;
    if (!file) return c.json(notReady("file field is required."), 400);

    let text: string;
    try {
      text = await fileToMarkdown(file.name, Buffer.from(await file.arrayBuffer()));
    } catch (err) {
      return c.json(notReady(err instanceof Error ? err.message : String(err)), 400);
    }
    const titleField = String(form.title ?? "").trim();
    const docTitle = titleField || file.name || "Untitled";
    const updateExisting = String(form.update_existing ?? "false") === "true";
    const projectIdsStr = String(form.project_ids ?? "");
    const projectIds = projectIdsStr
      ? projectIdsStr.split(",").map((s) => s.trim()).filter(Boolean)
      : null;
    const metadataStr = String(form.metadata ?? "");
    let metadata: Record<string, string> | null = null;
    if (metadataStr) {
      try {
        metadata = JSON.parse(metadataStr) as Record<string, string>;
      } catch {
        metadata = null;
      }
    }

    try {
      const pipeline = new IngestionPipeline({
        supabase: ctx.supabase,
        openAiApiKey: ctx.openAiApiKey ?? "",
      });
      const result = await pipeline.ingestText({
        text,
        title: docTitle,
        source: "file",
        sourcePath: file.name,
        projectIds,
        metadata,
        updateExisting,
        author: "web-ui",
        authorType: "user",
      });
      const skipped = result.action === "skipped";
      logWebUsage(ctx, { operation: "ingest", document_id: result.documentId });
      return c.json(
        {
          success: !skipped,
          document_id: result.documentId,
          title: result.title,
          skipped,
          updated: result.reindexed,
          // The WHY on a skip (e.g. "identical content is in the TRASH —
          // restore it"). The paste branch always forwarded it; dropping it
          // here left file re-uploads with a bare unexplained "skipped".
          ...(result.note ? { note: result.note } : {}),
        },
        200,
      );
    } catch (err) {
      return c.json(
        notReady(err instanceof Error ? err.message : String(err)),
        200,
      );
    }
  });

  // ── POST /api/v1/documents/{id}/upload (replace existing) ────────────────
  app.post("/api/v1/documents/:document_id/upload", async (c) => {
    if (!ctx.openAiApiKey && resolveEmbedderKind() !== "local") {
      return c.json(notReady("Embedder not available"), 503);
    }
    const documentId = c.req.param("document_id");

    let form: { [k: string]: unknown };
    try {
      form = await c.req.parseBody();
    } catch (err) {
      return c.json(
        notReady(`Invalid multipart body: ${err instanceof Error ? err.message : err}`),
        400,
      );
    }
    const file = form.file as File | undefined;
    if (!file) return c.json(notReady("file field is required."), 400);

    let text: string;
    try {
      text = await fileToMarkdown(file.name, Buffer.from(await file.arrayBuffer()));
    } catch (err) {
      return c.json(notReady(err instanceof Error ? err.message : String(err)), 400);
    }

    // Fetch the existing doc so we can preserve its title if the upload
    // doesn't provide one (matches Python: keeps existing.title or
    // falls back to filename).
    const { data: existing } = await ctx.supabase
      .from("cerefox_documents")
      .select("id, title")
      .eq("id", documentId)
      .maybeSingle();
    if (!existing) return c.json(notReady("Document not found"), 404);

    const title =
      (existing.title as string | null) || file.name || "Untitled";

    try {
      const pipeline = new IngestionPipeline({
        supabase: ctx.supabase,
        openAiApiKey: ctx.openAiApiKey ?? "",
      });
      const result = await pipeline.updateDocument({
        documentId,
        text,
        title,
        source: "file",
        author: "web-ui",
        authorType: "user",
      });
      logWebUsage(ctx, { operation: "ingest", document_id: result.documentId });
      return c.json(
        {
          success: true,
          document_id: result.documentId,
          title: result.title,
          updated: result.reindexed,
        },
        200,
      );
    } catch (err) {
      return c.json(
        notReady(err instanceof Error ? err.message : String(err)),
        200,
      );
    }
  });
}
