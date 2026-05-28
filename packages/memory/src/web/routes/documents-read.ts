/**
 * Document read endpoints (Part 24D — 5 endpoints):
 *
 *   GET /api/v1/documents/{document_id}
 *   GET /api/v1/documents/{document_id}/chunks
 *   GET /api/v1/documents/{document_id}/versions
 *   GET /api/v1/documents/{document_id}/download
 *   GET /api/v1/check-filename
 *
 * Python source: `src/cerefox/api/routes_api.py` lines 777-921 (the four
 * documents/{id}/* handlers) + line 1131 (/check-filename).
 *
 * Same single-implementation principle as the rest of the read surface:
 * handlers call `cerefox_get_document` / `cerefox_reconstruct_doc` /
 * `cerefox_list_document_versions` RPCs and `cerefox_documents` /
 * `cerefox_chunks` / `cerefox_document_projects` tables directly. The
 * Python-side `_title_to_filename` helper is ported inline since it's
 * tiny and only used here.
 */

import { Hono } from "hono";

import type { WebContext } from "../context.ts";

interface DocReconRow {
  document_id?: string;
  doc_title?: string;
  doc_source?: string | null;
  doc_metadata?: Record<string, unknown>;
  full_content?: string;
  chunk_count?: number;
  total_chars?: number;
  version_id?: string | null;
  created_at?: string | null;
}

interface DocVersionRow {
  version_id: string;
  version_number: number;
  source?: string;
  chunk_count?: number;
  total_chars?: number;
  archived?: boolean;
  created_at?: string;
}

async function reconstructDoc(
  ctx: WebContext,
  documentId: string,
  versionId: string | null,
): Promise<DocReconRow | null> {
  if (versionId) {
    const { data, error } = await ctx.supabase.rpc("cerefox_get_document", {
      p_document_id: documentId,
      p_version_id: versionId,
    });
    if (error) throw error;
    const rows = (data ?? []) as DocReconRow[];
    return rows.length > 0 ? rows[0] : null;
  }
  const { data, error } = await ctx.supabase.rpc("cerefox_reconstruct_doc", {
    p_document_id: documentId,
  });
  if (error) throw error;
  const rows = (data ?? []) as DocReconRow[];
  return rows.length > 0 ? rows[0] : null;
}

async function getDocumentRow(
  ctx: WebContext,
  documentId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await ctx.supabase
    .from("cerefox_documents")
    .select("*")
    .eq("id", documentId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Record<string, unknown>;
}

async function listDocumentProjectIds(
  ctx: WebContext,
  documentId: string,
): Promise<string[]> {
  const { data, error } = await ctx.supabase
    .from("cerefox_document_projects")
    .select("project_id")
    .eq("document_id", documentId);
  if (error) return [];
  return ((data ?? []) as Array<{ project_id: string }>).map(
    (r) => r.project_id,
  );
}

async function listDocumentVersions(
  ctx: WebContext,
  documentId: string,
): Promise<DocVersionRow[]> {
  try {
    const { data, error } = await ctx.supabase.rpc(
      "cerefox_list_document_versions",
      { p_document_id: documentId },
    );
    if (error) return [];
    return (data ?? []) as DocVersionRow[];
  } catch {
    return [];
  }
}

const UNICODE_MAP: ReadonlyMap<string, string> = new Map([
  ["—", "-"],
  ["–", "-"],
  ["‘", "'"],
  ["’", "'"],
  ["“", '"'],
  ["”", '"'],
  ["…", "..."],
  ["·", "-"],
]);

function titleToFilename(title: string, maxLen = 80): string {
  let name = "";
  for (const ch of title) {
    name += UNICODE_MAP.get(ch) ?? ch;
  }
  // NFKD + drop non-ASCII (mirrors Python's `unicodedata.normalize("NFKD",
  // ...).encode("ascii", errors="ignore").decode("ascii")`).
  // The TextEncoder/Decoder approach below works on Bun + Node.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalised = (name as any).normalize ? name.normalize("NFKD") : name;
  let ascii = "";
  for (const ch of normalised as string) {
    const code = ch.codePointAt(0);
    if (code !== undefined && code < 128) ascii += ch;
  }
  ascii = ascii.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/^[. ]+|[. ]+$/g, "");
  return (ascii || "document").slice(0, maxLen);
}

export function registerDocumentReadRoutes(app: Hono, ctx: WebContext): void {
  // ── GET /documents/{id} ────────────────────────────────────────────────────
  app.get("/api/v1/documents/:document_id", async (c) => {
    const documentId = c.req.param("document_id");
    const versionId = c.req.query("version_id") || null;

    const doc = await reconstructDoc(ctx, documentId, versionId);
    if (!doc) {
      return c.json({ detail: "Document not found" }, 404);
    }
    const meta = await getDocumentRow(ctx, documentId);
    const projectIds = await listDocumentProjectIds(ctx, documentId);
    const versions = await listDocumentVersions(ctx, documentId);

    return c.json({
      document_id: documentId,
      full_content: doc.full_content ?? "",
      doc_title:
        doc.doc_title ?? (meta ? ((meta.title as string) ?? "") : ""),
      doc_source:
        doc.doc_source ?? (meta ? (meta.source as string | null) ?? null : null),
      doc_metadata: meta
        ? ((meta.metadata as Record<string, unknown>) ?? {})
        : {},
      total_chars: doc.total_chars ?? 0,
      chunk_count: doc.chunk_count ?? 0,
      project_ids: projectIds,
      review_status: meta
        ? ((meta.review_status as string) ?? "approved")
        : "approved",
      created_at: meta ? ((meta.created_at as string | null) ?? null) : null,
      updated_at: meta ? ((meta.updated_at as string | null) ?? null) : null,
      versions: versions.map((v) => ({
        version_id: v.version_id,
        version_number: v.version_number,
        source: v.source ?? "",
        chunk_count: v.chunk_count ?? 0,
        total_chars: v.total_chars ?? 0,
        archived: v.archived ?? false,
        created_at: v.created_at ?? "",
      })),
    });
  });

  // ── GET /documents/{id}/chunks ─────────────────────────────────────────────
  app.get("/api/v1/documents/:document_id/chunks", async (c) => {
    const documentId = c.req.param("document_id");
    const { data, error } = await ctx.supabase
      .from("cerefox_chunks")
      .select(
        "id, document_id, chunk_index, heading_path, heading_level, title, content, char_count",
      )
      .eq("document_id", documentId)
      .is("version_id", null)
      .order("chunk_index");
    if (error) return c.json({ detail: error.message }, 500);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return c.json(
      rows.map((r) => ({
        chunk_id: r.id,
        document_id: documentId,
        chunk_index: (r.chunk_index as number) ?? 0,
        title: (r.title as string) ?? "",
        content: (r.content as string) ?? "",
        heading_path: (r.heading_path as string[]) ?? [],
        heading_level: (r.heading_level as number | null) ?? null,
        char_count: (r.char_count as number) ?? 0,
      })),
    );
  });

  // ── GET /documents/{id}/versions ───────────────────────────────────────────
  app.get("/api/v1/documents/:document_id/versions", async (c) => {
    const documentId = c.req.param("document_id");
    const versions = await listDocumentVersions(ctx, documentId);
    return c.json(
      versions.map((v) => ({
        version_id: v.version_id,
        version_number: v.version_number,
        source: v.source ?? "",
        chunk_count: v.chunk_count ?? 0,
        total_chars: v.total_chars ?? 0,
        archived: v.archived ?? false,
        created_at: v.created_at ?? "",
      })),
    );
  });

  // ── GET /documents/{id}/download ───────────────────────────────────────────
  app.get("/api/v1/documents/:document_id/download", async (c) => {
    const documentId = c.req.param("document_id");
    const versionId = c.req.query("version_id") || null;

    const doc = await reconstructDoc(ctx, documentId, versionId);
    if (!doc) {
      return c.json({ detail: "Document not found" }, 404);
    }
    const content = doc.full_content ?? "";
    const meta = await getDocumentRow(ctx, documentId);
    const sourcePath = meta ? ((meta.source_path as string | null) ?? "") : "";
    let base = "";
    if (sourcePath) base = sourcePath.split("/").pop() ?? "";
    if (!base) {
      const title = (meta?.title as string | undefined) ?? "document";
      base = `${titleToFilename(title)}.md`;
    }
    if (versionId) {
      const versions = await listDocumentVersions(ctx, documentId);
      const ver = versions.find((v) => v.version_id === versionId);
      if (ver) {
        const stem = base.endsWith(".md") ? base.slice(0, -3) : base;
        const verDate = (ver.created_at ?? "").slice(0, 10);
        base = `${stem} v${ver.version_number} - ${verDate}.md`;
      }
    }

    return c.body(content, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${base}"`,
    });
  });

  // ── GET /check-filename ────────────────────────────────────────────────────
  app.get("/api/v1/check-filename", async (c) => {
    const filename = (c.req.query("filename") ?? "").trim();
    if (!filename) return c.json({ exists: false });
    try {
      const { data } = await ctx.supabase
        .from("cerefox_documents")
        .select("id, title, updated_at")
        .eq("source_path", filename)
        .order("updated_at", { ascending: false })
        .limit(1);
      const rows = (data ?? []) as Array<{
        id: string;
        title: string | null;
        updated_at: string | null;
      }>;
      if (rows.length > 0) {
        const doc = rows[0];
        return c.json({
          exists: true,
          document_id: doc.id,
          title: doc.title,
          updated_at: doc.updated_at,
        });
      }
    } catch {
      // Degrade silently to "doesn't exist" — Python does the same.
    }
    return c.json({ exists: false });
  });
}
