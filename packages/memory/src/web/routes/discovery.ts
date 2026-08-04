/**
 * Discovery endpoints: /search, /metadata-keys, /dashboard,
 * /documents/trash, /documents/metadata-search, /resolve-link.
 *
 * Python source: `src/cerefox/api/routes_api.py` (handlers between
 * lines 270 and 775) and `src/cerefox/db/client.py` (data access).
 *
 * Same single-implementation-principle as the rest of v0.6: business
 * logic lives in the Postgres RPCs (`cerefox_*_search`,
 * `cerefox_metadata_search`, `cerefox_list_metadata_keys`). These
 * handlers are thin: validate, call RPC / table, project, respond.
 */

import { resolveEmbedderKind } from "../../../../../_shared/embeddings/index.ts";
import { Hono } from "hono";

import { getEmbedding } from "../../../../../_shared/embeddings/index.js";
import { fetchAllPages } from "../../../../../_shared/db-client/paginate.ts";
import { getMinSearchScore } from "../../../../../_shared/mcp-tools/_utils.js";
import type { WebContext } from "../context.ts";
import { logWebUsage } from "../usage.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DOC_COLS =
  "id, title, source, source_path, content_hash, metadata, chunk_count, total_chars, review_status, created_at, updated_at, deleted_at";

const DASHBOARD_DOC_COLS =
  "id, title, source, chunk_count, total_chars, review_status, updated_at";

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function parseMetadataFilter(
  raw: string,
): { ok: true; value: Record<string, unknown> | null } | { ok: false } {
  if (!raw) return { ok: true, value: null };
  try {
    const parsed = JSON.parse(raw);
    return { ok: true, value: parsed };
  } catch {
    return { ok: false };
  }
}

async function listDocuments(
  ctx: WebContext,
  opts: { projectId?: string | null; limit: number; offset?: number },
): Promise<Record<string, unknown>[]> {
  const { projectId, limit, offset = 0 } = opts;
  let docIds: string[] | null = null;
  if (projectId) {
    const { data, error } = await ctx.supabase
      .from("cerefox_document_projects")
      .select("document_id")
      .eq("project_id", projectId);
    if (error) throw error;
    docIds = (data ?? []).map((r: { document_id: string }) => r.document_id);
    if (docIds.length === 0) return [];
  }
  let q = ctx.supabase
    .from("cerefox_documents")
    .select(DOC_COLS)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (docIds) q = q.in("id", docIds);
  q = q.range(offset, offset + limit - 1);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Record<string, unknown>[];
}

async function listAllProjects(
  ctx: WebContext,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await ctx.supabase
    .from("cerefox_projects")
    .select("*")
    .order("name");
  if (error) throw error;
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function getProjectsForDocuments(
  ctx: WebContext,
  docIds: string[],
  projects: Array<Record<string, unknown>>,
): Promise<Record<string, Array<Record<string, unknown>>>> {
  const result: Record<string, Array<Record<string, unknown>>> = {};
  for (const id of docIds) result[id] = [];
  if (docIds.length === 0) return result;
  const projectsById = new Map<string, Record<string, unknown>>(
    projects.map((p) => [String(p.id), p]),
  );
  try {
    const { data, error } = await ctx.supabase
      .from("cerefox_document_projects")
      .select("document_id, project_id")
      .in("document_id", docIds);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{
      document_id: string;
      project_id: string;
    }>) {
      const project = projectsById.get(row.project_id);
      if (project && result[row.document_id]) {
        result[row.document_id].push(project);
      }
    }
  } catch {
    // Degrade gracefully — display still works with empty project lists.
  }
  return result;
}

async function getProjectDocCounts(
  ctx: WebContext,
  projectIds: string[],
): Promise<{
  active: Record<string, number>;
  deleted: Record<string, number>;
}> {
  const active: Record<string, number> = {};
  const deleted: Record<string, number> = {};
  for (const pid of projectIds) {
    active[pid] = 0;
    deleted[pid] = 0;
  }
  if (projectIds.length === 0) return { active, deleted };
  try {
    // Paginated: the unbounded scan capped at the PostgREST row limit
    // (1000), silently under-counting every project once the KB crossed
    // 1000 junction rows (#131). One walk covers active + deleted counts.
    const rows = await fetchAllPages<{
      project_id: string;
      cerefox_documents: { deleted_at: string | null } | null;
    }>((from, to) =>
      ctx.supabase
        .from("cerefox_document_projects")
        .select("project_id, cerefox_documents(deleted_at)")
        .in("project_id", projectIds)
        .order("document_id", { ascending: true })
        .order("project_id", { ascending: true })
        .range(from, to),
    );
    for (const row of rows) {
      const pid = row.project_id;
      if (!(pid in active)) continue;
      const doc = row.cerefox_documents ?? null;
      if (doc && doc.deleted_at === null) active[pid] += 1;
      else if (doc && doc.deleted_at !== null) deleted[pid] += 1;
    }
  } catch {
    // Degrade gracefully.
  }
  return { active, deleted };
}

async function countActiveDocuments(ctx: WebContext): Promise<number> {
  const { count, error } = await ctx.supabase
    .from("cerefox_documents")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);
  if (error) throw error;
  return count ?? 0;
}

async function getCorpusTotals(
  ctx: WebContext,
): Promise<{ total_chunks: number; total_chars: number }> {
  // Degrade to zeros if the RPC isn't deployed yet (upgrade window: the web
  // server may be updated before `cerefox server deploy` applies rpcs.sql).
  const { data, error } = await ctx.supabase.rpc("cerefox_corpus_totals");
  if (error) return { total_chunks: 0, total_chars: 0 };
  const row = (Array.isArray(data) ? data[0] : data) as
    | { total_chunks: number | string; total_chars: number | string }
    | undefined;
  return {
    total_chunks: Number(row?.total_chunks ?? 0),
    total_chars: Number(row?.total_chars ?? 0),
  };
}

async function getRecentDocAuthors(
  ctx: WebContext,
  docIds: string[],
): Promise<Record<string, { author: string; author_type: string }>> {
  if (docIds.length === 0) return {};
  // Degrade to {} if the RPC isn't deployed yet — the Author column then
  // falls back to the document's source channel.
  const { data, error } = await ctx.supabase.rpc("cerefox_recent_doc_authors", {
    p_doc_ids: docIds,
  });
  if (error) return {};
  const out: Record<string, { author: string; author_type: string }> = {};
  for (const r of (data ?? []) as Array<{ document_id: string; author: string; author_type: string }>) {
    out[String(r.document_id)] = { author: r.author, author_type: r.author_type };
  }
  return out;
}

async function countDocumentsForProject(
  ctx: WebContext,
  projectId: string,
): Promise<number> {
  // Match Python: count junction rows whose linked document is not deleted.
  // Counted server-side (the `countActiveDocuments` pattern): the previous
  // fetch-and-count capped at the PostgREST row limit (1000), so projects
  // past ~1000 documents under-reported their total (#131). The `!inner`
  // embed makes the deleted_at filter an inner join, so junction rows whose
  // document is deleted (or missing) are excluded — same rows the old JS
  // filter kept.
  const { count, error } = await ctx.supabase
    .from("cerefox_document_projects")
    .select("document_id, cerefox_documents!inner(deleted_at)", {
      count: "exact",
      head: true,
    })
    .eq("project_id", projectId)
    .is("cerefox_documents.deleted_at", null);
  if (error) throw error;
  return count ?? 0;
}

function dashboardDocFromRow(
  row: Record<string, unknown>,
  projectIds: string[],
): Record<string, unknown> {
  return {
    id: row.id,
    title: (row.title as string) ?? "",
    source: (row.source as string | null) ?? null,
    chunk_count: (row.chunk_count as number) ?? 0,
    total_chars: (row.total_chars as number) ?? 0,
    review_status: (row.review_status as string) ?? "approved",
    updated_at: (row.updated_at as string | null) ?? null,
    project_ids: projectIds,
  };
}

// ── /search ──────────────────────────────────────────────────────────────────

interface DocResultRow {
  document_id: string;
  doc_title?: string;
  doc_source?: string | null;
  doc_metadata?: Record<string, unknown>;
  doc_project_ids?: string[];
  best_score?: number;
  best_chunk_heading_path?: string[];
  full_content?: string;
  chunk_count?: number;
  total_chars?: number;
  doc_updated_at?: string | null;
  is_partial?: boolean;
}

interface ChunkResultRow {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  title?: string;
  content?: string;
  heading_path?: string[];
  heading_level?: number | null;
  score?: number;
  doc_title?: string;
  doc_source?: string | null;
  doc_project_ids?: string[];
  doc_metadata?: Record<string, unknown>;
}

function projectDocResult(r: DocResultRow): Record<string, unknown> {
  return {
    document_id: r.document_id,
    doc_title: r.doc_title ?? "",
    doc_source: r.doc_source ?? null,
    doc_metadata: r.doc_metadata ?? {},
    doc_project_ids: r.doc_project_ids ?? [],
    best_score: r.best_score ?? 0,
    best_chunk_heading_path: r.best_chunk_heading_path ?? [],
    full_content: r.full_content ?? "",
    chunk_count: r.chunk_count ?? 0,
    total_chars: r.total_chars ?? 0,
    doc_updated_at: r.doc_updated_at ?? null,
    is_partial: r.is_partial ?? false,
  };
}

function projectChunkResult(r: ChunkResultRow): Record<string, unknown> {
  return {
    chunk_id: r.chunk_id,
    document_id: r.document_id,
    chunk_index: r.chunk_index,
    title: r.title ?? "",
    content: r.content ?? "",
    heading_path: r.heading_path ?? [],
    heading_level: r.heading_level ?? null,
    score: r.score ?? 0,
    doc_title: r.doc_title ?? "",
    doc_source: r.doc_source ?? null,
    doc_project_ids: r.doc_project_ids ?? [],
    doc_metadata: r.doc_metadata ?? {},
  };
}

async function runSearch(
  ctx: WebContext,
  opts: {
    query: string;
    mode: string;
    projectId: string | null;
    count: number;
    metadataFilter: Record<string, unknown> | null;
  },
): Promise<Array<Record<string, unknown>>> {
  const { query, mode, projectId, count, metadataFilter } = opts;

  if (mode === "fts") {
    const params: Record<string, unknown> = {
      p_query_text: query,
      p_match_count: count,
      p_project_id: projectId,
    };
    if (metadataFilter) params.p_metadata_filter = metadataFilter;
    const { data, error } = await ctx.supabase.rpc("cerefox_fts_search", params);
    if (error) throw error;
    return ((data ?? []) as ChunkResultRow[]).map(projectChunkResult);
  }

  // Modes below need an embedding.
  if (!ctx.openAiApiKey && resolveEmbedderKind() !== "local") {
    throw new HttpError(503, "Embedder not available");
  }
  const embedding = await getEmbedding(query, ctx.openAiApiKey);

  if (mode === "semantic") {
    const params: Record<string, unknown> = {
      p_query_embedding: embedding,
      p_match_count: count,
      p_use_upgrade: false,
      p_project_id: projectId,
    };
    if (metadataFilter) params.p_metadata_filter = metadataFilter;
    const { data, error } = await ctx.supabase.rpc(
      "cerefox_semantic_search",
      params,
    );
    if (error) throw error;
    return ((data ?? []) as ChunkResultRow[]).map(projectChunkResult);
  }

  if (mode === "hybrid") {
    const params: Record<string, unknown> = {
      p_query_text: query,
      p_query_embedding: embedding,
      p_match_count: count,
      p_alpha: 0.7,
      p_use_upgrade: false,
      p_project_id: projectId,
      p_min_score: getMinSearchScore(),
    };
    if (metadataFilter) params.p_metadata_filter = metadataFilter;
    const { data, error } = await ctx.supabase.rpc(
      "cerefox_hybrid_search",
      params,
    );
    if (error) throw error;
    return ((data ?? []) as ChunkResultRow[]).map(projectChunkResult);
  }

  // mode === "docs" (default)
  const params: Record<string, unknown> = {
    p_query_text: query,
    p_query_embedding: embedding,
    p_match_count: Math.min(count, 5),
    p_alpha: 0.7,
    p_project_id: projectId,
    p_min_score: getMinSearchScore(),
  };
  if (metadataFilter) params.p_metadata_filter = metadataFilter;
  const { data, error } = await ctx.supabase.rpc("cerefox_search_docs", params);
  if (error) throw error;
  return ((data ?? []) as DocResultRow[]).map(projectDocResult);
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerDiscoveryRoutes(app: Hono, ctx: WebContext): void {
  // ── /search ────────────────────────────────────────────────────────────────
  app.get("/api/v1/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    const mode = c.req.query("mode") ?? "docs";
    const projectIdRaw = c.req.query("project_id") ?? "";
    const projectId = projectIdRaw || null;
    const countRaw = c.req.query("count") ?? "10";
    let count = Number.parseInt(countRaw, 10);
    if (!Number.isFinite(count)) count = 10;
    count = Math.min(Math.max(count, 1), 50);
    const metadataFilterStr = c.req.query("metadata_filter") ?? "";
    const reviewStatus = c.req.query("review_status") ?? "";

    const mf = parseMetadataFilter(metadataFilterStr);
    if (!mf.ok) {
      return c.json({ detail: "Invalid metadata_filter JSON" }, 400);
    }

    // Browse mode: project selected but no query
    if (projectId && !q) {
      const raw = await listDocuments(ctx, { projectId, limit: 100 });
      const browse = raw.map((d) => ({
        document_id: d.id,
        doc_title: (d.title as string) ?? "",
        doc_source: (d.source as string | null) ?? "",
        doc_metadata: (d.metadata as Record<string, unknown>) ?? {},
        doc_project_ids: [projectId],
        best_score: 0.0,
        best_chunk_heading_path: [],
        full_content: "",
        chunk_count: (d.chunk_count as number) ?? 0,
        total_chars: (d.total_chars as number) ?? 0,
        doc_updated_at: (d.updated_at as string | null) ?? "",
        is_partial: false,
      }));
      return c.json({
        results: browse,
        query: "",
        mode: "docs",
        total_found: browse.length,
        response_bytes: 0,
        truncated: browse.length === 100,
      });
    }

    if (!q) {
      return c.json({
        results: [],
        query: "",
        mode,
        total_found: 0,
        response_bytes: 0,
        truncated: false,
      });
    }

    let results: Array<Record<string, unknown>>;
    try {
      results = await runSearch(ctx, {
        query: q,
        mode,
        projectId,
        count,
        metadataFilter: mf.value,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        return c.json({ detail: err.message }, err.status);
      }
      throw err;
    }

    // Post-filter by review_status (docs mode only).
    if (
      reviewStatus &&
      (reviewStatus === "approved" || reviewStatus === "pending_review") &&
      mode === "docs"
    ) {
      const docIds = results.map((r) => r.document_id as string);
      if (docIds.length > 0) {
        const { data } = await ctx.supabase
          .from("cerefox_documents")
          .select("id, review_status")
          .in("id", docIds);
        const statusMap = new Map<string, string>();
        for (const row of (data ?? []) as Array<{
          id: string;
          review_status: string | null;
        }>) {
          statusMap.set(row.id, row.review_status ?? "approved");
        }
        results = results.filter(
          (r) => statusMap.get(r.document_id as string) === reviewStatus,
        );
      }
    }

    logWebUsage(ctx, { operation: "search", query_text: q, result_count: results.length });

    return c.json({
      results,
      query: q,
      mode,
      total_found: results.length,
      response_bytes: jsonByteLength(results),
      truncated: false,
    });
  });

  // ── /metadata-keys ─────────────────────────────────────────────────────────
  app.get("/api/v1/metadata-keys", async (c) => {
    const { data, error } = await ctx.supabase.rpc("cerefox_list_metadata_keys");
    if (error) return c.json({ detail: error.message }, 500);
    const rows = (data ?? []) as Array<{
      key: string;
      doc_count?: number;
      example_values?: string[];
    }>;
    return c.json(
      rows.map((row) => ({
        key: row.key,
        doc_count: row.doc_count ?? 0,
        examples: row.example_values ?? [],
      })),
    );
  });

  // ── /documents/metadata-search ─────────────────────────────────────────────
  app.post("/api/v1/documents/metadata-search", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ detail: "Invalid JSON body" }, 400);
    }
    const metadataFilter = body.metadata_filter as
      | Record<string, unknown>
      | undefined;
    if (!metadataFilter || typeof metadataFilter !== "object") {
      return c.json({ detail: "metadata_filter is required" }, 400);
    }
    const params: Record<string, unknown> = {
      p_metadata_filter: metadataFilter,
      p_project_id: (body.project_id as string | null) ?? null,
      p_updated_since: (body.updated_since as string | null) ?? null,
      p_created_since: (body.created_since as string | null) ?? null,
      p_limit: typeof body.limit === "number" ? body.limit : 10,
      p_include_content:
        typeof body.include_content === "boolean" ? body.include_content : false,
    };
    const { data, error } = await ctx.supabase.rpc(
      "cerefox_metadata_search",
      params,
    );
    if (error) return c.json({ detail: error.message }, 500);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return c.json(
      rows.map((row) => ({
        document_id: row.document_id,
        title: (row.title as string) ?? "",
        doc_metadata: (row.doc_metadata as Record<string, unknown>) ?? {},
        review_status: (row.review_status as string) ?? "approved",
        source: (row.source as string | null) ?? null,
        created_at: String(row.created_at ?? ""),
        updated_at: String(row.updated_at ?? ""),
        total_chars: (row.total_chars as number) ?? 0,
        chunk_count: (row.chunk_count as number) ?? 0,
        project_ids: (row.project_ids as string[]) ?? [],
        project_names: (row.project_names as string[]) ?? [],
        version_count: (row.version_count as number) ?? 0,
        content: (row.content as string | null) ?? null,
      })),
    );
  });

  // ── /dashboard ─────────────────────────────────────────────────────────────
  app.get("/api/v1/dashboard", async (c) => {
    const [recentDocs, projects, docCount, totals] = await Promise.all([
      listDocuments(ctx, { limit: 10 }),
      listAllProjects(ctx),
      countActiveDocuments(ctx),
      getCorpusTotals(ctx),
    ]);
    const projectIds = projects.map((p) => String(p.id));
    const docIds = recentDocs.map((d) => String(d.id));
    const [docProjectsMap, counts, authors] = await Promise.all([
      getProjectsForDocuments(ctx, docIds, projects),
      getProjectDocCounts(ctx, projectIds),
      getRecentDocAuthors(ctx, docIds),
    ]);

    const recent = recentDocs.map((d) => {
      const id = String(d.id);
      const pids = (docProjectsMap[id] ?? []).map((p) => String(p.id));
      const a = authors[id];
      return {
        ...dashboardDocFromRow(d, pids),
        author: a?.author ?? null,
        author_type: a?.author_type ?? null,
      };
    });

    const projectsOut = projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: (p.description as string | null) ?? null,
      created_at: (p.created_at as string | null) ?? "",
      updated_at: (p.updated_at as string | null) ?? "",
    }));

    return c.json({
      doc_count: docCount,
      total_chunks: totals.total_chunks,
      total_chars: totals.total_chars,
      project_count: projects.length,
      recent_docs: recent,
      projects: projectsOut,
      project_doc_counts: counts.active,
      project_deleted_doc_counts: counts.deleted,
    });
  });

  // ── /projects/{id}/documents ───────────────────────────────────────────────
  app.get("/api/v1/projects/:project_id/documents", async (c) => {
    const projectId = c.req.param("project_id");
    const limit = Math.min(
      Math.max(Number.parseInt(c.req.query("limit") ?? "50", 10) || 50, 1),
      200,
    );
    const offset = Math.max(
      Number.parseInt(c.req.query("offset") ?? "0", 10) || 0,
      0,
    );
    const [docs, total, projects] = await Promise.all([
      listDocuments(ctx, { projectId, limit, offset }),
      countDocumentsForProject(ctx, projectId),
      listAllProjects(ctx),
    ]);
    const docIds = docs.map((d) => String(d.id));
    const docProjectsMap = await getProjectsForDocuments(ctx, docIds, projects);
    const documents = docs.map((d) => {
      const id = String(d.id);
      const pids = (docProjectsMap[id] ?? []).map((p) => String(p.id));
      return dashboardDocFromRow(d, pids);
    });
    return c.json({ documents, total, limit, offset });
  });

  // ── /documents/trash ───────────────────────────────────────────────────────
  app.get("/api/v1/documents/trash", async (c) => {
    const limit = Math.min(
      Math.max(Number.parseInt(c.req.query("limit") ?? "50", 10) || 50, 1),
      500,
    );
    const { data, error } = await ctx.supabase
      .from("cerefox_documents")
      .select(
        "id, title, source, chunk_count, total_chars, review_status, deleted_at, updated_at",
      )
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(limit);
    if (error) return c.json({ detail: error.message }, 500);
    const docs = (data ?? []) as Array<Record<string, unknown>>;
    if (docs.length === 0) return c.json([]);
    const projects = await listAllProjects(ctx);
    const docIds = docs.map((d) => String(d.id));
    const map = await getProjectsForDocuments(ctx, docIds, projects);
    const out = docs.map((d) => ({
      ...d,
      project_ids: (map[String(d.id)] ?? []).map((p) => String(p.id)),
    }));
    return c.json(out);
  });

  // ── /resolve-link ──────────────────────────────────────────────────────────
  app.get("/api/v1/resolve-link", async (c) => {
    const rawPath = c.req.query("path");
    if (rawPath === undefined) {
      return c.json({ detail: "path query param is required" }, 422);
    }
    const fromDocId = c.req.query("from_doc_id") || null;
    const limit = Math.min(
      Math.max(Number.parseInt(c.req.query("limit") ?? "10", 10) || 10, 1),
      50,
    );

    let path = rawPath;
    let anchor: string | null = null;
    const hashIdx = path.indexOf("#");
    if (hashIdx !== -1) {
      const tail = path.slice(hashIdx + 1);
      anchor = tail.length > 0 ? `#${tail}` : null;
      path = path.slice(0, hashIdx);
    }
    path = path.trim();
    if (!path) {
      return c.json({ tried_path: "", anchor, matches: [] });
    }

    // Tier 0: UUID short-circuit
    if (UUID_RE.test(path)) {
      if (path === fromDocId) {
        return c.json({ tried_path: path, anchor, matches: [] });
      }
      const { data } = await ctx.supabase
        .from("cerefox_documents")
        .select("id, title, source_path, deleted_at")
        .eq("id", path)
        .maybeSingle();
      if (!data || (data as { deleted_at: string | null }).deleted_at !== null) {
        return c.json({ tried_path: path, anchor, matches: [] });
      }
      const row = data as {
        id: string;
        title: string | null;
        source_path: string | null;
      };
      return c.json({
        tried_path: path,
        anchor,
        matches: [
          {
            document_id: row.id,
            title: row.title ?? "",
            source_path: row.source_path,
            match_method: "document_id",
          },
        ],
      });
    }

    const normalised = path
      .replace(/^(?:\.\.\/)+/, "")
      .replace(/^\.\//, "")
      .replace(/^\/+/, "");
    if (!normalised) {
      return c.json({ tried_path: "", anchor, matches: [] });
    }
    const basename = normalised.split("/").pop() ?? normalised;

    type MatchRow = { id: string; title: string | null; source_path: string | null };
    const project = (rows: MatchRow[], method: string) =>
      rows
        .filter((r) => r.id !== fromDocId)
        .map((r) => ({
          document_id: r.id,
          title: r.title ?? "",
          source_path: r.source_path,
          match_method: method,
        }));

    // Tier 1: source_path ends with the full normalised path
    {
      const { data } = await ctx.supabase
        .from("cerefox_documents")
        .select("id, title, source_path")
        .is("deleted_at", null)
        .like("source_path", `%/${normalised}`)
        .order("updated_at", { ascending: false })
        .limit(limit);
      const rows = (data ?? []) as MatchRow[];
      const matches = project(rows, "source_path_suffix");
      if (matches.length > 0) {
        return c.json({ tried_path: normalised, anchor, matches });
      }
    }

    // Tier 2: source_path ends with just the basename (distinct from tier 1)
    if (basename !== normalised) {
      const { data } = await ctx.supabase
        .from("cerefox_documents")
        .select("id, title, source_path")
        .is("deleted_at", null)
        .like("source_path", `%/${basename}`)
        .order("updated_at", { ascending: false })
        .limit(limit);
      const rows = (data ?? []) as MatchRow[];
      const matches = project(rows, "basename");
      if (matches.length > 0) {
        return c.json({ tried_path: normalised, anchor, matches });
      }
    }

    // Tier 3: title-slug fuzzy match
    {
      const stem = basename.replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim();
      if (stem) {
        const { data } = await ctx.supabase
          .from("cerefox_documents")
          .select("id, title, source_path")
          .is("deleted_at", null)
          .ilike("title", `%${stem}%`)
          .order("updated_at", { ascending: false })
          .limit(limit);
        const rows = (data ?? []) as MatchRow[];
        const matches = project(rows, "title_match");
        if (matches.length > 0) {
          return c.json({ tried_path: normalised, anchor, matches });
        }
      }
    }

    return c.json({ tried_path: normalised, anchor, matches: [] });
  });
}
