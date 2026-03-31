-- Cerefox Search & Retrieval RPCs
-- These functions are exposed as MCP tools via Supabase.
-- Run via: python scripts/db_deploy.py (after schema.sql)
--
-- All RPCs are SECURITY DEFINER so they can be called safely via the
-- Supabase anon/service key without exposing the underlying tables directly.

-- ── Return-type change drops ──────────────────────────────────────────────────
-- When CREATE OR REPLACE cannot be used because the return type changes,
-- we drop the old function first.  These drops are safe to re-run.

-- Drop old 4-param overload (pre p_min_score) and current 5-param semantic search
DROP FUNCTION IF EXISTS cerefox_semantic_search(VECTOR(768), INT, BOOLEAN, UUID);
DROP FUNCTION IF EXISTS cerefox_semantic_search(VECTOR(768), INT, BOOLEAN, UUID, FLOAT);

-- Drop old 6-param hybrid_search (pre p_min_score, pre M2M join, used d.project_id column).
DROP FUNCTION IF EXISTS cerefox_hybrid_search(TEXT, VECTOR(768), INT, FLOAT, BOOLEAN, UUID);

-- Drop old 7-param hybrid_search that returned doc_project_id UUID (singular, pre-M2M).
DROP FUNCTION IF EXISTS cerefox_hybrid_search(TEXT, VECTOR(768), INT, FLOAT, BOOLEAN, UUID, FLOAT);

-- Drop old 5-param search_docs (pre p_min_score).
DROP FUNCTION IF EXISTS cerefox_search_docs(TEXT, VECTOR(768), INT, FLOAT, UUID);

-- Drop 6-param search_docs that returned doc_project_id UUID (singular) or lacked doc_updated_at.
DROP FUNCTION IF EXISTS cerefox_search_docs(TEXT, VECTOR(768), INT, FLOAT, UUID, FLOAT);

-- Drop 8-param search_docs (pre is_partial) so return-type change can be applied cleanly.
DROP FUNCTION IF EXISTS cerefox_search_docs(TEXT, VECTOR(768), INT, FLOAT, UUID, FLOAT, INT, INT);

DROP FUNCTION IF EXISTS cerefox_fts_search(TEXT, INT, UUID);
DROP FUNCTION IF EXISTS cerefox_reconstruct_doc(UUID);

-- Drop current signatures before adding version_count to their return types.
-- Iteration 12B: all chunk-level and document-level search results now include
-- version_count so agents and the web UI know when previous versions are available.
DROP FUNCTION IF EXISTS cerefox_hybrid_search(TEXT, VECTOR(768), INT, FLOAT, BOOLEAN, UUID, FLOAT);
DROP FUNCTION IF EXISTS cerefox_fts_search(TEXT, INT, UUID);
DROP FUNCTION IF EXISTS cerefox_semantic_search(VECTOR(768), INT, BOOLEAN, UUID, FLOAT);
DROP FUNCTION IF EXISTS cerefox_reconstruct_doc(UUID);
DROP FUNCTION IF EXISTS cerefox_search_docs(TEXT, VECTOR(768), INT, FLOAT, UUID, FLOAT);

-- Iteration 13: Drop pre-metadata-filter signatures so we can add p_metadata_filter JSONB.
-- Backwards-compatible: the new parameter has DEFAULT NULL so existing callers are unaffected.
DROP FUNCTION IF EXISTS cerefox_hybrid_search(TEXT, VECTOR(768), INT, FLOAT, BOOLEAN, UUID, FLOAT);
DROP FUNCTION IF EXISTS cerefox_fts_search(TEXT, INT, UUID);
DROP FUNCTION IF EXISTS cerefox_semantic_search(VECTOR(768), INT, BOOLEAN, UUID, FLOAT);
DROP FUNCTION IF EXISTS cerefox_search_docs(TEXT, VECTOR(768), INT, FLOAT, UUID, FLOAT, INT, INT);

-- Iteration 16B: Drop pre-project_names signatures so we can add doc_project_names TEXT[]
-- to all RETURNS TABLE shapes. Also drops reconstruct_doc and get_document for the same reason.
DROP FUNCTION IF EXISTS cerefox_hybrid_search(TEXT, VECTOR(768), INT, FLOAT, BOOLEAN, UUID, FLOAT, JSONB);
DROP FUNCTION IF EXISTS cerefox_fts_search(TEXT, INT, UUID, JSONB);
DROP FUNCTION IF EXISTS cerefox_semantic_search(VECTOR(768), INT, BOOLEAN, UUID, FLOAT, JSONB);
DROP FUNCTION IF EXISTS cerefox_search_docs(TEXT, VECTOR(768), INT, FLOAT, UUID, FLOAT, INT, INT, JSONB);
DROP FUNCTION IF EXISTS cerefox_reconstruct_doc(UUID);
DROP FUNCTION IF EXISTS cerefox_get_document(UUID, UUID);

-- ── Shared return type note ────────────────────────────────────────────────────
-- All chunk-level search RPCs return the same shape for consistency:
--   chunk_id, document_id, chunk_index, title, content, heading_path,
--   heading_level, score, doc_title, doc_source, doc_project_ids,
--   doc_project_names, doc_metadata, version_count
-- Note: doc_project_ids is UUID[] (array) — a document can belong to many projects.
-- Note: doc_project_names is TEXT[] (array) — human-readable project names.
-- Note: version_count is INT — number of archived versions for the parent document.
--       Agents and the web UI use this to know when previous versions are available
--       for retrieval. 0 means the current content has never been overwritten.

-- ── Hybrid Search ─────────────────────────────────────────────────────────────
-- Combines full-text search (FTS) and vector similarity with a configurable
-- alpha weight. alpha=1.0 means pure semantic; alpha=0.0 means pure FTS.
--
-- V1 approach: run both searches (top N*5 candidates each), FULL OUTER JOIN on
-- chunk ID, then combine scores with weighted average. Simple and fast for
-- typical knowledge base sizes.

CREATE OR REPLACE FUNCTION cerefox_hybrid_search(
    p_query_text      TEXT,
    p_query_embedding VECTOR(768),
    p_match_count     INT     DEFAULT 10,
    p_alpha           FLOAT   DEFAULT 0.7,
    p_use_upgrade     BOOLEAN DEFAULT FALSE,
    p_project_id      UUID    DEFAULT NULL,
    p_min_score       FLOAT   DEFAULT 0.0,
    p_metadata_filter JSONB   DEFAULT NULL
)
RETURNS TABLE (
    chunk_id        UUID,
    document_id     UUID,
    chunk_index     INT,
    title           TEXT,
    content         TEXT,
    heading_path    TEXT[],
    heading_level   INT,
    score           FLOAT,
    doc_title       TEXT,
    doc_source      TEXT,
    doc_project_ids UUID[],
    doc_project_names TEXT[],
    doc_metadata    JSONB,
    version_count   INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    query_fts tsquery := websearch_to_tsquery('english', p_query_text);
    candidate_count INT := p_match_count * 5;
BEGIN
    RETURN QUERY
    WITH
        fts_results AS (
            SELECT
                c.id,
                ts_rank_cd(c.fts, query_fts)::FLOAT AS fts_score
            FROM cerefox_chunks c
            JOIN cerefox_documents d ON c.document_id = d.id
            WHERE c.version_id IS NULL
              AND d.deleted_at IS NULL
              AND c.fts @@ query_fts
              AND (p_project_id IS NULL OR EXISTS (
                      SELECT 1 FROM cerefox_document_projects dp
                      WHERE dp.document_id = d.id AND dp.project_id = p_project_id
                  ))
              AND (p_metadata_filter IS NULL OR d.metadata @> p_metadata_filter)
            ORDER BY fts_score DESC
            LIMIT candidate_count
        ),
        vec_results AS (
            SELECT
                c.id,
                CASE
                    WHEN p_use_upgrade AND c.embedding_upgrade IS NOT NULL
                        THEN (1.0 - (c.embedding_upgrade <=> p_query_embedding))::FLOAT
                    ELSE
                        (1.0 - (c.embedding_primary <=> p_query_embedding))::FLOAT
                END AS vec_score
            FROM cerefox_chunks c
            JOIN cerefox_documents d ON c.document_id = d.id
            WHERE c.version_id IS NULL
              AND d.deleted_at IS NULL
              AND (p_project_id IS NULL OR EXISTS (
                      SELECT 1 FROM cerefox_document_projects dp
                      WHERE dp.document_id = d.id AND dp.project_id = p_project_id
                  ))
              AND (p_metadata_filter IS NULL OR d.metadata @> p_metadata_filter)
            ORDER BY
                CASE
                    WHEN p_use_upgrade AND c.embedding_upgrade IS NOT NULL
                        THEN c.embedding_upgrade <=> p_query_embedding
                    ELSE c.embedding_primary <=> p_query_embedding
                END
            LIMIT candidate_count
        ),
        combined AS (
            SELECT
                COALESCE(f.id, v.id) AS id,
                (   p_alpha * COALESCE(v.vec_score, 0.0) +
                    (1.0 - p_alpha) * COALESCE(f.fts_score, 0.0)
                ) AS score,
                COALESCE(v.vec_score, 0.0) AS vec_score,
                -- TRUE when the chunk matched the @@ FTS operator.
                -- We use this flag rather than vec_score to decide whether a chunk
                -- passes the threshold, because in small corpora every chunk appears
                -- in vec_results (LIMIT candidate_count covers all rows), so
                -- vec_score is never NULL even for FTS-only matches.
                f.id IS NOT NULL AS has_fts_match
            FROM fts_results f
            FULL OUTER JOIN vec_results v ON f.id = v.id
        )
    SELECT
        c.id            AS chunk_id,
        c.document_id,
        c.chunk_index,
        c.title,
        c.content,
        c.heading_path,
        c.heading_level,
        cm.score,
        d.title         AS doc_title,
        d.source        AS doc_source,
        ARRAY(SELECT dp.project_id FROM cerefox_document_projects dp
              WHERE dp.document_id = d.id) AS doc_project_ids,
        ARRAY(SELECT p.name FROM cerefox_projects p
              JOIN cerefox_document_projects dp ON p.id = dp.project_id
              WHERE dp.document_id = d.id) AS doc_project_names,
        d.metadata      AS doc_metadata,
        (SELECT COUNT(*)::INT FROM cerefox_document_versions dv
         WHERE dv.document_id = d.id) AS version_count
    FROM combined cm
    JOIN cerefox_chunks   c ON c.id = cm.id
    JOIN cerefox_documents d ON c.document_id = d.id
    -- FTS matches pass through unconditionally: the @@ operator is a hard gate
    -- and guarantees the query terms appear in the chunk.
    -- Vector-only results (no FTS match) are filtered by the cosine threshold.
    WHERE cm.has_fts_match OR cm.vec_score >= p_min_score
    ORDER BY cm.score DESC
    LIMIT p_match_count;
END;
$$;

-- ── FTS-Only Search ───────────────────────────────────────────────────────────
-- Pure keyword / exact-match search. Best for names, dates, tags.

CREATE OR REPLACE FUNCTION cerefox_fts_search(
    p_query_text      TEXT,
    p_match_count     INT  DEFAULT 10,
    p_project_id      UUID DEFAULT NULL,
    p_metadata_filter JSONB DEFAULT NULL
)
RETURNS TABLE (
    chunk_id        UUID,
    document_id     UUID,
    chunk_index     INT,
    title           TEXT,
    content         TEXT,
    heading_path    TEXT[],
    heading_level   INT,
    score           FLOAT,
    doc_title       TEXT,
    doc_source      TEXT,
    doc_project_ids UUID[],
    doc_project_names TEXT[],
    doc_metadata    JSONB,
    version_count   INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    query_fts tsquery := websearch_to_tsquery('english', p_query_text);
BEGIN
    RETURN QUERY
    SELECT
        c.id            AS chunk_id,
        c.document_id,
        c.chunk_index,
        c.title,
        c.content,
        c.heading_path,
        c.heading_level,
        ts_rank_cd(c.fts, query_fts)::FLOAT AS score,
        d.title         AS doc_title,
        d.source        AS doc_source,
        ARRAY(SELECT dp.project_id FROM cerefox_document_projects dp
              WHERE dp.document_id = d.id) AS doc_project_ids,
        ARRAY(SELECT p.name FROM cerefox_projects p
              JOIN cerefox_document_projects dp ON p.id = dp.project_id
              WHERE dp.document_id = d.id) AS doc_project_names,
        d.metadata      AS doc_metadata,
        (SELECT COUNT(*)::INT FROM cerefox_document_versions dv
         WHERE dv.document_id = d.id) AS version_count
    FROM cerefox_chunks c
    JOIN cerefox_documents d ON c.document_id = d.id
    WHERE c.version_id IS NULL
              AND d.deleted_at IS NULL
      AND c.fts @@ query_fts
      AND (p_project_id IS NULL OR EXISTS (
              SELECT 1 FROM cerefox_document_projects dp
              WHERE dp.document_id = d.id AND dp.project_id = p_project_id
          ))
      AND (p_metadata_filter IS NULL OR d.metadata @> p_metadata_filter)
    ORDER BY score DESC
    LIMIT p_match_count;
END;
$$;

-- ── Semantic-Only Search ──────────────────────────────────────────────────────
-- Pure vector similarity. Best for conceptual / paraphrase queries.

CREATE OR REPLACE FUNCTION cerefox_semantic_search(
    p_query_embedding VECTOR(768),
    p_match_count     INT     DEFAULT 10,
    p_use_upgrade     BOOLEAN DEFAULT FALSE,
    p_project_id      UUID    DEFAULT NULL,
    p_min_score       FLOAT   DEFAULT 0.0,
    p_metadata_filter JSONB   DEFAULT NULL
)
RETURNS TABLE (
    chunk_id        UUID,
    document_id     UUID,
    chunk_index     INT,
    title           TEXT,
    content         TEXT,
    heading_path    TEXT[],
    heading_level   INT,
    score           FLOAT,
    doc_title       TEXT,
    doc_source      TEXT,
    doc_project_ids UUID[],
    doc_project_names TEXT[],
    doc_metadata    JSONB,
    version_count   INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id            AS chunk_id,
        c.document_id,
        c.chunk_index,
        c.title,
        c.content,
        c.heading_path,
        c.heading_level,
        CASE
            WHEN p_use_upgrade AND c.embedding_upgrade IS NOT NULL
                THEN (1.0 - (c.embedding_upgrade <=> p_query_embedding))::FLOAT
            ELSE
                (1.0 - (c.embedding_primary <=> p_query_embedding))::FLOAT
        END AS score,
        d.title         AS doc_title,
        d.source        AS doc_source,
        ARRAY(SELECT dp.project_id FROM cerefox_document_projects dp
              WHERE dp.document_id = d.id) AS doc_project_ids,
        ARRAY(SELECT p.name FROM cerefox_projects p
              JOIN cerefox_document_projects dp ON p.id = dp.project_id
              WHERE dp.document_id = d.id) AS doc_project_names,
        d.metadata      AS doc_metadata,
        (SELECT COUNT(*)::INT FROM cerefox_document_versions dv
         WHERE dv.document_id = d.id) AS version_count
    FROM cerefox_chunks c
    JOIN cerefox_documents d ON c.document_id = d.id
    WHERE c.version_id IS NULL
              AND d.deleted_at IS NULL
      AND (p_project_id IS NULL OR EXISTS (
              SELECT 1 FROM cerefox_document_projects dp
              WHERE dp.document_id = d.id AND dp.project_id = p_project_id
          ))
      AND (p_metadata_filter IS NULL OR d.metadata @> p_metadata_filter)
      AND (p_use_upgrade = FALSE OR c.embedding_upgrade IS NOT NULL)
      -- Optional minimum cosine similarity threshold.
      -- Default 0.0 means no filtering (returns all top-N results).
      -- When called via the Python layer, CEREFOX_MIN_SEARCH_SCORE (default 0.65)
      -- is applied client-side; agents calling this RPC directly can pass p_min_score.
      AND CASE
              WHEN p_use_upgrade AND c.embedding_upgrade IS NOT NULL
                  THEN (1.0 - (c.embedding_upgrade <=> p_query_embedding))::FLOAT
              ELSE (1.0 - (c.embedding_primary <=> p_query_embedding))::FLOAT
          END >= p_min_score
    ORDER BY
        CASE
            WHEN p_use_upgrade AND c.embedding_upgrade IS NOT NULL
                THEN c.embedding_upgrade <=> p_query_embedding
            ELSE c.embedding_primary <=> p_query_embedding
        END
    LIMIT p_match_count;
END;
$$;

-- ── Document Reconstruction ───────────────────────────────────────────────────
-- Reassemble a full document from its chunks (ordered by chunk_index).
-- Agents use this after a chunk-level search to get broader context.

CREATE OR REPLACE FUNCTION cerefox_reconstruct_doc(
    p_document_id UUID
)
RETURNS TABLE (
    document_id     UUID,
    doc_title       TEXT,
    doc_source      TEXT,
    doc_metadata    JSONB,
    doc_project_ids UUID[],
    doc_project_names TEXT[],
    full_content    TEXT,
    chunk_count     INT,
    total_chars     INT,
    version_count   INT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
    SELECT
        d.id            AS document_id,
        d.title         AS doc_title,
        d.source        AS doc_source,
        d.metadata      AS doc_metadata,
        ARRAY(SELECT dp.project_id FROM cerefox_document_projects dp
              WHERE dp.document_id = d.id) AS doc_project_ids,
        ARRAY(SELECT p.name FROM cerefox_projects p
              JOIN cerefox_document_projects dp ON p.id = dp.project_id
              WHERE dp.document_id = d.id) AS doc_project_names,
        STRING_AGG(c.content, E'\n\n' ORDER BY c.chunk_index) AS full_content,
        COUNT(*)::INT   AS chunk_count,
        SUM(c.char_count)::INT AS total_chars,
        (SELECT COUNT(*)::INT FROM cerefox_document_versions dv
         WHERE dv.document_id = d.id) AS version_count
    FROM cerefox_documents d
    JOIN cerefox_chunks c ON c.document_id = d.id
    WHERE d.id = p_document_id
      AND c.version_id IS NULL
    GROUP BY d.id, d.title, d.source, d.metadata;
$$;

-- ── cerefox_save_note ─────────────────────────────────────────────────────────
-- Agent write tool: create a minimal document record for a short text note.
-- Embedding and chunking are NOT done server-side in V1 — the Python ingestion
-- pipeline should be used for full ingest.  This RPC is intended for quick
-- one-shot note capture from AI agents that want to store something immediately.
--
-- Parameters:
--   p_title       : Note title (required)
--   p_content     : Markdown content (required)
--   p_source      : Origin label, e.g. 'agent' (default: 'agent')
--   p_project_id  : Optional project UUID (assigns to a single project)
--   p_metadata    : Optional JSONB metadata (e.g. agent name, session id)
--
-- Returns: the created document row (id, title, created_at)

CREATE OR REPLACE FUNCTION cerefox_save_note(
    p_title       TEXT,
    p_content     TEXT,
    p_source      TEXT    DEFAULT 'agent',
    p_project_id  UUID    DEFAULT NULL,
    p_metadata    JSONB   DEFAULT '{}'::JSONB
)
RETURNS TABLE (
    id          UUID,
    title       TEXT,
    created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_hash TEXT;
    v_doc_id UUID;
    v_created_at TIMESTAMPTZ;
BEGIN
    -- Compute content hash to support deduplication on the caller side.
    v_hash := encode(sha256(p_content::BYTEA), 'hex');

    INSERT INTO cerefox_documents (
        title, source, content_hash, metadata, chunk_count, total_chars
    ) VALUES (
        p_title, p_source, v_hash, p_metadata, 0, length(p_content)
    )
    RETURNING cerefox_documents.id, cerefox_documents.created_at
    INTO v_doc_id, v_created_at;

    -- Assign to project if provided (many-to-many junction).
    IF p_project_id IS NOT NULL THEN
        INSERT INTO cerefox_document_projects (document_id, project_id)
        VALUES (v_doc_id, p_project_id)
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN QUERY SELECT v_doc_id, p_title, v_created_at;
END;
$$;

-- ── cerefox_search_docs ───────────────────────────────────────────────────────
-- Document-level hybrid search: runs hybrid search internally, deduplicates
-- results by document (keeping the best-scoring chunk per document), and
-- returns up to p_match_count *distinct documents* with their content.
--
-- ── RPC-level configuration (not exposed via .env) ────────────────────────────
-- Two params below are intentionally NOT surfaced in Python config or .env.
-- They are system-level tuning knobs with the same role as OPENAI_MODEL and
-- EMBEDDING_DIMENSIONS in the Edge Functions — change them here and redeploy
-- rpcs.sql (python scripts/db_deploy.py) if you need different values.
--
--   p_small_to_big_threshold (default: 20000 chars)
--     Documents larger than this return matched chunks + neighbours instead of
--     the full document. Set to 0 to always return full document content.
--     Rationale: at the default match_count=5 and 200 KB response ceiling,
--     5 × 20 000 chars ≈ 100 KB — comfortably under the limit even before
--     accounting for small-to-big compression of large docs.
--
--   p_context_window (default: 1)
--     Neighbour chunks on each side of each matched chunk.
--     N=1 → up to 3 contiguous chunks per hit (prev, match, next).
--     N=0 → matched chunks only (no expansion).
--     N=2 → up to 5 contiguous chunks per hit.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Parameters:
--   p_query_text             : Query string (used for FTS)
--   p_query_embedding        : 768-dim query embedding (used for vector search)
--   p_match_count            : Max documents to return (default: 5)
--   p_alpha                  : Semantic weight 0.0–1.0 (default: 0.7)
--   p_project_id             : Optional project filter (M2M)
--   p_min_score              : Minimum cosine similarity for vector results
--   p_small_to_big_threshold : See above (default: 20000)
--   p_context_window         : See above (default: 1)
--
-- Returns one row per document. total_chars is always the full document size.
-- chunk_count reflects how many chunks are in full_content (may be partial).
-- is_partial = TRUE when the small-to-big path was taken for that document.

CREATE OR REPLACE FUNCTION cerefox_search_docs(
    p_query_text             TEXT,
    p_query_embedding        VECTOR(768),
    p_match_count            INT   DEFAULT 5,
    p_alpha                  FLOAT DEFAULT 0.7,
    p_project_id             UUID  DEFAULT NULL,
    p_min_score              FLOAT DEFAULT 0.0,
    p_small_to_big_threshold INT   DEFAULT 20000,
    p_context_window         INT   DEFAULT 1,
    p_metadata_filter        JSONB DEFAULT NULL
)
RETURNS TABLE (
    document_id              UUID,
    doc_title                TEXT,
    doc_source               TEXT,
    doc_metadata             JSONB,
    doc_project_ids          UUID[],
    doc_project_names        TEXT[],
    best_score               FLOAT,
    best_chunk_heading_path  TEXT[],
    full_content             TEXT,
    chunk_count              INT,
    total_chars              INT,
    doc_updated_at           TIMESTAMPTZ,
    version_count            INT,
    is_partial               BOOL
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
    WITH chunk_results AS (
        -- Run hybrid search with a 10x candidate pool so deduplication has
        -- enough candidates to fill p_match_count unique documents.
        SELECT * FROM cerefox_hybrid_search(
            p_query_text      := p_query_text,
            p_query_embedding := p_query_embedding,
            p_match_count     := p_match_count * 10,
            p_alpha           := p_alpha,
            p_use_upgrade     := FALSE,
            p_project_id      := p_project_id,
            p_min_score       := p_min_score,
            p_metadata_filter := p_metadata_filter
        )
    ),
    best_per_doc AS (
        -- One row per document: keep the highest-scoring chunk as representative.
        SELECT DISTINCT ON (cr.document_id)
            cr.document_id,
            cr.heading_path    AS best_chunk_heading_path,
            cr.score           AS best_score,
            cr.doc_title,
            cr.doc_source,
            cr.doc_metadata,
            cr.doc_project_ids,
            cr.doc_project_names,
            cr.version_count,
            d.updated_at       AS doc_updated_at
        FROM chunk_results cr
        JOIN cerefox_documents d ON d.id = cr.document_id
        ORDER BY cr.document_id, cr.score DESC
    ),
    top_docs AS (
        SELECT *
        FROM best_per_doc
        ORDER BY best_score DESC
        LIMIT p_match_count
    ),
    -- Compute actual total_chars per top document (needed for threshold check).
    doc_sizes AS (
        SELECT c.document_id, SUM(c.char_count)::INT AS total_chars
        FROM cerefox_chunks c
        WHERE c.document_id IN (SELECT document_id FROM top_docs)
          AND c.version_id IS NULL
        GROUP BY c.document_id
    ),
    -- Matched chunk IDs from documents that exceed the threshold.
    large_doc_seeds AS (
        SELECT cr.chunk_id
        FROM chunk_results cr
        JOIN doc_sizes ds ON cr.document_id = ds.document_id
        WHERE p_small_to_big_threshold > 0
          AND ds.total_chars > p_small_to_big_threshold
          AND cr.document_id IN (SELECT document_id FROM top_docs)
    ),
    -- Expand context for all large-doc seeds in a single call.
    -- cerefox_context_expand respects document boundaries and deduplicates.
    -- When large_doc_seeds is empty (threshold=0 or all docs are small),
    -- ARRAY_AGG returns NULL; COALESCE converts that to an empty array so the
    -- function returns 0 rows safely.
    expanded AS (
        SELECT ec.chunk_id, ec.document_id, ec.chunk_index, ec.content
        FROM cerefox_context_expand(
            COALESCE((SELECT ARRAY_AGG(chunk_id) FROM large_doc_seeds), ARRAY[]::UUID[]),
            p_context_window
        ) ec
    ),
    -- Aggregate expanded chunks per large document (is_partial = TRUE).
    large_doc_content AS (
        SELECT
            e.document_id,
            STRING_AGG(e.content, E'\n\n' ORDER BY e.chunk_index) AS full_content,
            COUNT(*)::INT AS chunk_count,
            TRUE          AS is_partial
        FROM expanded e
        GROUP BY e.document_id
    ),
    -- Full content for small documents (is_partial = FALSE).
    small_doc_content AS (
        SELECT
            c.document_id,
            STRING_AGG(c.content, E'\n\n' ORDER BY c.chunk_index) AS full_content,
            COUNT(*)::INT AS chunk_count,
            FALSE         AS is_partial
        FROM cerefox_chunks c
        WHERE c.document_id IN (SELECT document_id FROM top_docs)
          AND c.document_id NOT IN (SELECT document_id FROM large_doc_content)
          AND c.version_id IS NULL
        GROUP BY c.document_id
    ),
    all_content AS (
        SELECT document_id, full_content, chunk_count, is_partial FROM large_doc_content
        UNION ALL
        SELECT document_id, full_content, chunk_count, is_partial FROM small_doc_content
    )
    SELECT
        td.document_id,
        td.doc_title,
        td.doc_source,
        td.doc_metadata,
        td.doc_project_ids,
        td.doc_project_names,
        td.best_score,
        td.best_chunk_heading_path,
        ac.full_content,
        ac.chunk_count,
        ds.total_chars,    -- always full document size, even for partial results
        td.doc_updated_at,
        td.version_count,
        ac.is_partial
    FROM top_docs td
    JOIN doc_sizes ds ON ds.document_id = td.document_id
    JOIN all_content ac ON ac.document_id = td.document_id
    ORDER BY td.best_score DESC;
$$;

-- ── cerefox_context_expand ────────────────────────────────────────────────────
-- Small-to-big retrieval: given a set of chunk IDs from a search result,
-- return those chunks plus their immediate neighbours (±window_size by
-- chunk_index within the same document).  Use this after a chunk-level search
-- to recover more surrounding context without fetching the full document.
--
-- Parameters:
--   p_chunk_ids   : Array of chunk UUIDs from the search results
--   p_window_size : Number of chunks to expand in each direction (default: 1)
--
-- Returns each expanded chunk with is_seed=TRUE for original results.

CREATE OR REPLACE FUNCTION cerefox_context_expand(
    p_chunk_ids   UUID[],
    p_window_size INT DEFAULT 1
)
RETURNS TABLE (
    chunk_id      UUID,
    document_id   UUID,
    chunk_index   INT,
    title         TEXT,
    content       TEXT,
    heading_path  TEXT[],
    heading_level INT,
    doc_title     TEXT,
    is_seed       BOOL
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
    WITH seeds AS (
        SELECT c.id, c.document_id, c.chunk_index
        FROM cerefox_chunks c
        WHERE c.id = ANY(p_chunk_ids)
          AND c.version_id IS NULL
    ),
    expanded AS (
        SELECT DISTINCT c.id
        FROM cerefox_chunks c
        JOIN seeds s ON c.document_id = s.document_id
        WHERE c.version_id IS NULL
          AND c.chunk_index BETWEEN s.chunk_index - p_window_size
                                AND s.chunk_index + p_window_size
    )
    SELECT
        c.id            AS chunk_id,
        c.document_id,
        c.chunk_index,
        c.title,
        c.content,
        c.heading_path,
        c.heading_level,
        d.title         AS doc_title,
        c.id = ANY(p_chunk_ids) AS is_seed
    FROM expanded e
    JOIN cerefox_chunks   c ON c.id = e.id
    JOIN cerefox_documents d ON c.document_id = d.id
    ORDER BY c.document_id, c.chunk_index;
$$;

-- ── Metadata key discovery RPC ───────────────────────────────────────────────
-- Derives metadata keys from actual document data (metadata JSONB column).
-- No registry table needed — always accurate, zero maintenance.
-- Used by CLI, MCP tools, web UI autocomplete.

-- ── cerefox_snapshot_version ──────────────────────────────────────────────────
-- Archives all current chunks for a document (sets version_id to the new version
-- row's UUID) and runs lazy retention cleanup.
--
-- Called by the Python pipeline's update_document() and by the TypeScript Edge
-- Functions before inserting new chunks. This single RPC is the canonical way to
-- create a version — do not split the chunk-archiving step into separate code.
--
-- Retention policy (p_retention_hours):
--   - Always keeps the most recently created version (accidental-deletion protection)
--   - Also keeps all versions created within the retention window
--   - Deletes older versions beyond the window (cascade removes their chunks)
--
-- Parameters:
--   p_document_id     : Document to snapshot
--   p_source          : How the update was triggered ('file','paste','agent','manual')
--   p_retention_hours : Retention window in hours (default: 48)
--
-- Returns: (version_id, version_number, chunk_count, total_chars) of the new version

DROP FUNCTION IF EXISTS cerefox_snapshot_version(UUID, TEXT, INT);
DROP FUNCTION IF EXISTS cerefox_snapshot_version(UUID, TEXT, INT, BOOLEAN);
CREATE FUNCTION cerefox_snapshot_version(
    p_document_id       UUID,
    p_source            TEXT    DEFAULT 'manual',
    p_retention_hours   INT     DEFAULT 48,
    p_cleanup_enabled   BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    version_id     UUID,
    version_number INT,
    chunk_count    INT,
    total_chars    INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_version_id     UUID;
    v_version_number INT;
    v_chunk_count    INT;
    v_total_chars    INT;
BEGIN
    -- Count current chunks to record in the version metadata
    SELECT COUNT(*), COALESCE(SUM(char_count), 0)
    INTO v_chunk_count, v_total_chars
    FROM cerefox_chunks c
    WHERE c.document_id = p_document_id
      AND c.version_id IS NULL;

    -- Compute the next version number (sequential per document)
    SELECT COALESCE(MAX(dv.version_number), 0) + 1
    INTO v_version_number
    FROM cerefox_document_versions dv
    WHERE dv.document_id = p_document_id;

    -- Create the version row
    INSERT INTO cerefox_document_versions (
        document_id, version_number, source, chunk_count, total_chars
    ) VALUES (
        p_document_id, v_version_number, p_source, v_chunk_count, v_total_chars
    )
    RETURNING id INTO v_version_id;

    -- Archive all current chunks by pointing them at the new version
    UPDATE cerefox_chunks c
    SET version_id = v_version_id
    WHERE c.document_id = p_document_id
      AND c.version_id IS NULL;

    -- Lazy retention: delete versions outside the retention window,
    -- but always keep the most recently created version (the one we just made).
    -- Skip archived versions (archived=true) -- they are protected from cleanup.
    -- Skip cleanup entirely if p_cleanup_enabled is false (immutable mode).
    IF p_cleanup_enabled THEN
        DELETE FROM cerefox_document_versions dv
        WHERE dv.document_id = p_document_id
          AND dv.archived IS NOT TRUE
          AND dv.created_at < NOW() - (p_retention_hours || ' hours')::INTERVAL
          AND dv.id != (
              SELECT id FROM cerefox_document_versions
              WHERE document_id = p_document_id
              ORDER BY created_at DESC
              LIMIT 1
          );
    END IF;

    RETURN QUERY SELECT v_version_id, v_version_number, v_chunk_count, v_total_chars;
END;
$$;

-- ── cerefox_get_document ──────────────────────────────────────────────────────
-- Returns the full content of a document by reconstructing it from chunks.
-- Pass p_version_id = NULL (or omit it) for the current version.
-- Pass a specific version UUID to retrieve an archived version.
-- Version UUIDs are returned by cerefox_list_document_versions.

CREATE FUNCTION cerefox_get_document(
    p_document_id UUID,
    p_version_id  UUID DEFAULT NULL
)
RETURNS TABLE (
    document_id     UUID,
    doc_title       TEXT,
    doc_source      TEXT,
    doc_metadata    JSONB,
    doc_project_ids UUID[],
    doc_project_names TEXT[],
    version_id      UUID,
    full_content    TEXT,
    chunk_count     INT,
    total_chars     INT,
    created_at      TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
    SELECT
        d.id            AS document_id,
        d.title         AS doc_title,
        d.source        AS doc_source,
        d.metadata      AS doc_metadata,
        ARRAY(SELECT dp.project_id FROM cerefox_document_projects dp
              WHERE dp.document_id = d.id) AS doc_project_ids,
        ARRAY(SELECT p.name FROM cerefox_projects p
              JOIN cerefox_document_projects dp ON p.id = dp.project_id
              WHERE dp.document_id = d.id) AS doc_project_names,
        p_version_id    AS version_id,
        STRING_AGG(c.content, E'\n\n' ORDER BY c.chunk_index) AS full_content,
        COUNT(*)::INT   AS chunk_count,
        SUM(c.char_count)::INT AS total_chars,
        d.created_at
    FROM cerefox_documents d
    JOIN cerefox_chunks c ON c.document_id = d.id
    WHERE d.id = p_document_id
      AND (
          (p_version_id IS NULL     AND c.version_id IS NULL) OR
          (p_version_id IS NOT NULL AND c.version_id = p_version_id)
      )
    GROUP BY d.id, d.title, d.source, d.metadata, d.created_at;
$$;

-- ── cerefox_list_document_versions ────────────────────────────────────────────
-- Returns all archived versions for a document, newest first.
-- version_id is the UUID to pass to cerefox_get_document for retrieval.
-- version_number is the sequential human-readable number (unique per document).

DROP FUNCTION IF EXISTS cerefox_list_document_versions(UUID);
CREATE FUNCTION cerefox_list_document_versions(
    p_document_id UUID
)
RETURNS TABLE (
    version_id     UUID,
    version_number INT,
    source         TEXT,
    chunk_count    INT,
    total_chars    INT,
    archived       BOOLEAN,
    created_at     TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
    SELECT id, version_number, source, chunk_count, total_chars, archived, created_at
    FROM cerefox_document_versions
    WHERE document_id = p_document_id
    ORDER BY created_at DESC;
$$;

-- ── cerefox_delete_document (soft delete) ────────────────────────────────────
-- Soft-deletes a document by setting deleted_at = NOW(). The document, its
-- chunks, and versions remain in the database but are excluded from search.
-- Use cerefox_purge_document for permanent deletion.
-- Use cerefox_restore_document to undo a soft delete.

DROP FUNCTION IF EXISTS cerefox_delete_document(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS cerefox_delete_document(UUID);
CREATE FUNCTION cerefox_delete_document(
    p_document_id   UUID,
    p_author        TEXT    DEFAULT 'unknown',
    p_author_type   TEXT    DEFAULT 'user'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_title      TEXT;
    v_total_chars INT;
BEGIN
    SELECT title, total_chars INTO v_title, v_total_chars
    FROM cerefox_documents WHERE id = p_document_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Document % not found', p_document_id;
    END IF;

    -- Soft delete: set deleted_at timestamp
    UPDATE cerefox_documents SET deleted_at = NOW() WHERE id = p_document_id;

    PERFORM cerefox_create_audit_entry(
        p_document_id := p_document_id,
        p_operation := 'delete',
        p_author := p_author,
        p_author_type := p_author_type,
        p_size_before := v_total_chars,
        p_size_after := 0,
        p_description := 'Soft-deleted document: ' || COALESCE(v_title, '(untitled)') ||
                         ' (' || COALESCE(v_total_chars, 0) || ' chars)'
    );
END;
$$;

-- ── cerefox_restore_document ─────────────────────────────────────────────────
-- Restores a soft-deleted document by clearing deleted_at.

CREATE OR REPLACE FUNCTION cerefox_restore_document(
    p_document_id   UUID,
    p_author        TEXT    DEFAULT 'unknown',
    p_author_type   TEXT    DEFAULT 'user'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_title      TEXT;
    v_total_chars INT;
BEGIN
    SELECT title, total_chars INTO v_title, v_total_chars
    FROM cerefox_documents WHERE id = p_document_id AND deleted_at IS NOT NULL;

    IF v_title IS NULL THEN
        RETURN;  -- Not found or not deleted
    END IF;

    UPDATE cerefox_documents SET deleted_at = NULL WHERE id = p_document_id;

    PERFORM cerefox_create_audit_entry(
        p_document_id := p_document_id,
        p_operation := 'restore',
        p_author := p_author,
        p_author_type := p_author_type,
        p_size_before := 0,
        p_size_after := v_total_chars,
        p_description := 'Restored document: ' || COALESCE(v_title, '(untitled)')
    );
END;
$$;

-- ── cerefox_purge_document ───────────────────────────────────────────────────
-- Permanently deletes a soft-deleted document (CASCADE). Only works on
-- documents that are already soft-deleted (deleted_at IS NOT NULL).

CREATE OR REPLACE FUNCTION cerefox_purge_document(
    p_document_id   UUID,
    p_author        TEXT    DEFAULT 'unknown',
    p_author_type   TEXT    DEFAULT 'user'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_title      TEXT;
    v_total_chars INT;
BEGIN
    SELECT title, total_chars INTO v_title, v_total_chars
    FROM cerefox_documents WHERE id = p_document_id AND deleted_at IS NOT NULL;

    IF v_title IS NULL THEN
        RETURN;  -- Not found or not soft-deleted
    END IF;

    PERFORM cerefox_create_audit_entry(
        p_document_id := p_document_id,
        p_operation := 'delete',
        p_author := p_author,
        p_author_type := p_author_type,
        p_size_before := v_total_chars,
        p_size_after := 0,
        p_description := 'Permanently deleted document: ' || COALESCE(v_title, '(untitled)') ||
                         ' (' || COALESCE(v_total_chars, 0) || ' chars)'
    );

    DELETE FROM cerefox_documents WHERE id = p_document_id;
END;
$$;


-- ── cerefox_ingest_document ──────────────────────────────────────────────────
-- Single RPC for ingesting a document (create or update). Handles:
--   - Create: insert document row, insert chunks, set review_status, create audit entry
--   - Update: snapshot old version, delete old chunks, update document row,
--             insert new chunks, set review_status, create audit entry
--
-- Both the Python pipeline and the Edge Function call this after chunking and
-- embedding. This is the single implementation of the ingestion write path.
--
-- Parameters:
--   p_document_id     : NULL for create, UUID for update
--   p_title, p_source, p_source_path, p_content_hash, p_metadata : document fields
--   p_review_status   : 'approved' or 'pending_review' (based on author_type)
--   p_chunks          : JSONB array of chunk objects, each with:
--                        chunk_index, heading_path, heading_level, title,
--                        content, char_count, embedding (float[]), embedder (text)
--   p_author, p_author_type : for audit entry
--   p_source_label    : version source label for snapshot ('file','paste','agent','manual')
--   p_retention_hours : for version cleanup (default 48)
--   p_cleanup_enabled : whether version cleanup runs (default true)
--
-- Returns: document_id, chunk_count, total_chars, operation ('create' or 'update-content'),
--          version_id (UUID of snapshot, null on create)

DROP FUNCTION IF EXISTS cerefox_ingest_document(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, JSONB, TEXT, TEXT, TEXT, INT, BOOLEAN);
CREATE FUNCTION cerefox_ingest_document(
    p_document_id       UUID        DEFAULT NULL,
    p_title             TEXT        DEFAULT 'Untitled',
    p_source            TEXT        DEFAULT 'agent',
    p_source_path       TEXT        DEFAULT NULL,
    p_content_hash      TEXT        DEFAULT '',
    p_metadata          JSONB       DEFAULT '{}',
    p_review_status     TEXT        DEFAULT 'approved',
    p_chunks            JSONB       DEFAULT '[]',
    p_author            TEXT        DEFAULT 'unknown',
    p_author_type       TEXT        DEFAULT 'user',
    p_source_label      TEXT        DEFAULT 'manual',
    p_retention_hours   INT         DEFAULT 48,
    p_cleanup_enabled   BOOLEAN     DEFAULT TRUE
)
RETURNS TABLE (
    document_id     UUID,
    chunk_count     INT,
    total_chars     INT,
    operation       TEXT,
    version_id      UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_doc_id        UUID;
    v_chunk_count   INT;
    v_total_chars   INT;
    v_operation     TEXT;
    v_version_id    UUID    := NULL;
    v_old_chars     INT     := 0;
    v_chunk         JSONB;
    v_snap          RECORD;
    v_status        TEXT;
BEGIN
    -- Validate review_status
    v_status := CASE WHEN p_review_status IN ('approved', 'pending_review')
                     THEN p_review_status ELSE 'approved' END;

    -- Count chunks and total chars from the input
    v_chunk_count := jsonb_array_length(p_chunks);
    v_total_chars := 0;
    FOR v_chunk IN SELECT * FROM jsonb_array_elements(p_chunks) LOOP
        v_total_chars := v_total_chars + COALESCE((v_chunk->>'char_count')::INT, 0);
    END LOOP;

    IF p_document_id IS NOT NULL THEN
        -- ── UPDATE PATH ──────────────────────────────────────────────
        v_doc_id := p_document_id;
        v_operation := 'update-content';

        -- Get old size for audit
        SELECT COALESCE(d.total_chars, 0) INTO v_old_chars
        FROM cerefox_documents d WHERE d.id = v_doc_id;

        -- Snapshot old version (archives current chunks, runs retention cleanup)
        SELECT sv.version_id INTO v_version_id
        FROM cerefox_snapshot_version(v_doc_id, p_source_label, p_retention_hours, p_cleanup_enabled) sv;

        -- Update document record
        UPDATE cerefox_documents SET
            title = p_title,
            source = p_source,
            source_path = COALESCE(p_source_path, source_path),
            content_hash = p_content_hash,
            metadata = p_metadata,
            chunk_count = v_chunk_count,
            total_chars = v_total_chars,
            review_status = v_status,
            updated_at = NOW()
        WHERE id = v_doc_id;

    ELSE
        -- ── CREATE PATH ──────────────────────────────────────────────
        v_operation := 'create';

        INSERT INTO cerefox_documents (
            title, source, source_path, content_hash, metadata,
            chunk_count, total_chars, review_status
        ) VALUES (
            p_title, p_source, p_source_path, p_content_hash, p_metadata,
            v_chunk_count, v_total_chars, v_status
        )
        RETURNING id INTO v_doc_id;
    END IF;

    -- ── Insert chunks ────────────────────────────────────────────────
    INSERT INTO cerefox_chunks (
        document_id, chunk_index, heading_path, heading_level,
        title, content, char_count, embedding_primary, embedder_primary
    )
    SELECT
        v_doc_id,
        (c->>'chunk_index')::INT,
        ARRAY(SELECT jsonb_array_elements_text(c->'heading_path')),
        (c->>'heading_level')::INT,
        c->>'title',
        c->>'content',
        (c->>'char_count')::INT,
        (SELECT array_agg(e::FLOAT)::VECTOR(768) FROM jsonb_array_elements_text(c->'embedding') AS e),
        c->>'embedder'
    FROM jsonb_array_elements(p_chunks) AS c;

    -- ── Audit entry ──────────────────────────────────────────────────
    PERFORM cerefox_create_audit_entry(
        p_document_id := v_doc_id,
        p_version_id := v_version_id,
        p_operation := v_operation,
        p_author := p_author,
        p_author_type := p_author_type,
        p_size_before := CASE WHEN v_operation = 'create' THEN NULL ELSE v_old_chars END,
        p_size_after := v_total_chars,
        p_description := v_operation || ': ' || p_title || ' (' || v_chunk_count || ' chunks, ' || v_total_chars || ' chars)'
    );

    RETURN QUERY SELECT v_doc_id, v_chunk_count, v_total_chars, v_operation, v_version_id;
END;
$$;


-- ── cerefox_create_audit_entry ────────────────────────────────────────────────
-- Inserts an immutable audit log entry. Called by all access paths (Python
-- pipeline, Edge Functions, MCP) to maintain the single implementation principle.
-- Returns the created entry's id and created_at.

DROP FUNCTION IF EXISTS cerefox_create_audit_entry(UUID, UUID, TEXT, TEXT, TEXT, INT, INT, TEXT);
CREATE FUNCTION cerefox_create_audit_entry(
    p_document_id   UUID    DEFAULT NULL,
    p_version_id    UUID    DEFAULT NULL,
    p_operation     TEXT    DEFAULT 'create',
    p_author        TEXT    DEFAULT 'unknown',
    p_author_type   TEXT    DEFAULT 'user',
    p_size_before   INT     DEFAULT NULL,
    p_size_after    INT     DEFAULT NULL,
    p_description   TEXT    DEFAULT ''
)
RETURNS TABLE (
    audit_id    UUID,
    created_at  TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    INSERT INTO cerefox_audit_log (
        document_id, version_id, operation, author, author_type,
        size_before, size_after, description
    )
    VALUES (
        p_document_id, p_version_id, p_operation, p_author,
        CASE WHEN p_author_type IN ('user', 'agent') THEN p_author_type ELSE 'user' END,
        p_size_before, p_size_after, p_description
    )
    RETURNING id AS audit_id, cerefox_audit_log.created_at;
$$;

-- ── cerefox_list_audit_entries ────────────────────────────────────────────────
-- Returns audit log entries with optional filters. Joins cerefox_documents to
-- include doc_title. Used by the web UI, Edge Function, and MCP tool.
--
-- Parameters:
--   p_document_id : Filter by document (NULL = all)
--   p_author      : Filter by author (NULL = all)
--   p_operation   : Filter by operation type (NULL = all)
--   p_since       : Return entries created at or after this timestamp (NULL = no lower bound)
--   p_until       : Return entries created at or before this timestamp (NULL = no upper bound)
--   p_limit       : Max entries to return (default: 50)

DROP FUNCTION IF EXISTS cerefox_list_audit_entries(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT);
CREATE FUNCTION cerefox_list_audit_entries(
    p_document_id   UUID        DEFAULT NULL,
    p_author        TEXT        DEFAULT NULL,
    p_operation     TEXT        DEFAULT NULL,
    p_since         TIMESTAMPTZ DEFAULT NULL,
    p_until         TIMESTAMPTZ DEFAULT NULL,
    p_limit         INT         DEFAULT 50
)
RETURNS TABLE (
    id              UUID,
    document_id     UUID,
    doc_title       TEXT,
    version_id      UUID,
    operation       TEXT,
    author          TEXT,
    author_type     TEXT,
    size_before     INT,
    size_after      INT,
    description     TEXT,
    created_at      TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
    SELECT
        a.id,
        a.document_id,
        d.title         AS doc_title,
        a.version_id,
        a.operation,
        a.author,
        a.author_type,
        a.size_before,
        a.size_after,
        a.description,
        a.created_at
    FROM cerefox_audit_log a
    LEFT JOIN cerefox_documents d ON d.id = a.document_id
    WHERE (p_document_id IS NULL OR a.document_id = p_document_id)
      AND (p_author IS NULL      OR a.author = p_author)
      AND (p_operation IS NULL   OR a.operation = p_operation)
      AND (p_since IS NULL       OR a.created_at >= p_since)
      AND (p_until IS NULL       OR a.created_at <= p_until)
    ORDER BY a.created_at DESC
    LIMIT p_limit;
$$;

-- ── Metadata key discovery RPC ────────────────────────────────────────────────
-- Derives metadata keys from actual document data (metadata JSONB column).
-- No registry table needed; always accurate, zero maintenance.
-- Used by CLI, MCP tools, web UI autocomplete.

DROP FUNCTION IF EXISTS cerefox_list_metadata_keys();
CREATE FUNCTION cerefox_list_metadata_keys()
RETURNS TABLE (
    key            TEXT,
    doc_count      BIGINT,
    example_values TEXT[]
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
    SELECT
        k.key,
        COUNT(DISTINCT d.id)                                    AS doc_count,
        (ARRAY_AGG(DISTINCT d.metadata ->> k.key) FILTER
          (WHERE d.metadata ->> k.key IS NOT NULL))[1:5]   AS example_values
    FROM cerefox_documents d,
         LATERAL jsonb_object_keys(d.metadata) AS k(key)
    WHERE d.metadata IS NOT NULL
      AND d.metadata != '{}'::jsonb
    GROUP BY k.key
    ORDER BY doc_count DESC, k.key;
$$;

-- ── cerefox_list_projects ────────────────────────────────────────────────────
-- Lists all projects. Used by MCP tools for project discovery and by the
-- web UI for project name dropdowns.

CREATE OR REPLACE FUNCTION cerefox_list_projects()
RETURNS TABLE (
    id          UUID,
    name        TEXT,
    description TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
    SELECT p.id, p.name, p.description
    FROM cerefox_projects p
    ORDER BY p.name;
$$;

-- ── cerefox_metadata_search ──────────────────────────────────────────────────
-- Query documents by metadata key-value criteria without a text search term.
-- Uses JSONB containment (@>) which leverages the existing GIN index on
-- cerefox_documents.metadata.
--
-- Parameters:
--   p_metadata_filter : JSONB containment filter (AND semantics for all keys)
--   p_project_id      : Optional project UUID filter
--   p_updated_since   : Only docs updated on or after this timestamp
--   p_created_since   : Only docs created on or after this timestamp
--   p_limit           : Max results (default 10)
--   p_include_content : When TRUE, reconstruct full text from current chunks
--   p_max_bytes       : Byte budget for accumulated content (NULL = no limit)

CREATE OR REPLACE FUNCTION cerefox_metadata_search(
    p_metadata_filter   JSONB,
    p_project_id        UUID        DEFAULT NULL,
    p_updated_since     TIMESTAMPTZ DEFAULT NULL,
    p_created_since     TIMESTAMPTZ DEFAULT NULL,
    p_limit             INT         DEFAULT 10,
    p_include_content   BOOLEAN     DEFAULT FALSE,
    p_max_bytes         INT         DEFAULT NULL
)
RETURNS TABLE (
    document_id     UUID,
    title           TEXT,
    doc_metadata    JSONB,
    review_status   TEXT,
    source          TEXT,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ,
    total_chars     INT,
    chunk_count     INT,
    project_ids     UUID[],
    project_names   TEXT[],
    version_count   INT,
    content         TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_bytes_used INT := 0;
    v_row RECORD;
    v_row_bytes INT;
BEGIN
    FOR v_row IN
        SELECT
            d.id              AS document_id,
            d.title,
            d.metadata        AS doc_metadata,
            d.review_status,
            d.source,
            d.created_at,
            d.updated_at,
            d.total_chars,
            d.chunk_count,
            ARRAY(SELECT dp.project_id FROM cerefox_document_projects dp
                  WHERE dp.document_id = d.id) AS project_ids,
            ARRAY(SELECT p.name FROM cerefox_projects p
                  JOIN cerefox_document_projects dp ON p.id = dp.project_id
                  WHERE dp.document_id = d.id) AS project_names,
            (SELECT COUNT(*)::INT FROM cerefox_document_versions dv
             WHERE dv.document_id = d.id) AS version_count,
            CASE WHEN p_include_content THEN
                (SELECT STRING_AGG(c.content, E'\n\n' ORDER BY c.chunk_index)
                 FROM cerefox_chunks c
                 WHERE c.document_id = d.id AND c.version_id IS NULL)
            ELSE NULL END AS content
        FROM cerefox_documents d
        WHERE d.metadata @> p_metadata_filter
          AND (p_project_id IS NULL OR EXISTS (
                  SELECT 1 FROM cerefox_document_projects dp
                  WHERE dp.document_id = d.id AND dp.project_id = p_project_id
              ))
          AND (p_updated_since IS NULL OR d.updated_at >= p_updated_since)
          AND (p_created_since IS NULL OR d.created_at >= p_created_since)
        ORDER BY d.updated_at DESC
        LIMIT p_limit
    LOOP
        -- Byte budget enforcement (when p_max_bytes is set and content is included)
        IF p_max_bytes IS NOT NULL AND p_include_content AND v_row.content IS NOT NULL THEN
            v_row_bytes := octet_length(v_row.content);
            IF v_bytes_used + v_row_bytes > p_max_bytes THEN
                EXIT;  -- stop emitting rows
            END IF;
            v_bytes_used := v_bytes_used + v_row_bytes;
        END IF;

        document_id   := v_row.document_id;
        title         := v_row.title;
        doc_metadata  := v_row.doc_metadata;
        review_status := v_row.review_status;
        source        := v_row.source;
        created_at    := v_row.created_at;
        updated_at    := v_row.updated_at;
        total_chars   := v_row.total_chars;
        chunk_count   := v_row.chunk_count;
        project_ids   := v_row.project_ids;
        project_names := v_row.project_names;
        version_count := v_row.version_count;
        content       := v_row.content;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- ── cerefox_get_config / cerefox_set_config ──────────────────────────────────
-- Read/write key-value config from cerefox_config table.

CREATE OR REPLACE FUNCTION cerefox_get_config(p_key TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
    SELECT value FROM cerefox_config WHERE key = p_key;
$$;

CREATE OR REPLACE FUNCTION cerefox_set_config(p_key TEXT, p_value TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_allowed TEXT[] := ARRAY['usage_tracking_enabled', 'require_requestor_identity', 'requestor_identity_format'];
BEGIN
    IF NOT (p_key = ANY(v_allowed)) THEN
        RAISE EXCEPTION 'Unknown config key: %. Allowed keys: %', p_key, v_allowed;
    END IF;

    INSERT INTO cerefox_config (key, value)
    VALUES (p_key, p_value)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END;
$$;

-- ── cerefox_log_usage ────────────────────────────────────────────────────────
-- Insert a usage log entry. Checks config first; no-op if tracking is disabled.

CREATE OR REPLACE FUNCTION cerefox_log_usage(
    p_operation    TEXT,
    p_access_path  TEXT,
    p_requestor       TEXT        DEFAULT NULL,
    p_document_id  UUID        DEFAULT NULL,
    p_project_id   UUID        DEFAULT NULL,
    p_query_text   TEXT        DEFAULT NULL,
    p_result_count INT         DEFAULT NULL,
    p_extra        JSONB       DEFAULT '{}'::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_enabled TEXT;
BEGIN
    SELECT value INTO v_enabled FROM cerefox_config WHERE key = 'usage_tracking_enabled';
    IF v_enabled IS NULL OR v_enabled != 'true' THEN
        RETURN;
    END IF;

    INSERT INTO cerefox_usage_log (
        operation, access_path, requestor, document_id, project_id,
        query_text, result_count, extra
    ) VALUES (
        p_operation, p_access_path, p_requestor, p_document_id, p_project_id,
        p_query_text, p_result_count, p_extra
    );
END;
$$;

-- ── cerefox_list_usage_log ───────────────────────────────────────────────────
-- Query usage log with optional filters.

CREATE OR REPLACE FUNCTION cerefox_list_usage_log(
    p_start       TIMESTAMPTZ DEFAULT NULL,
    p_end         TIMESTAMPTZ DEFAULT NULL,
    p_operation   TEXT        DEFAULT NULL,
    p_access_path TEXT        DEFAULT NULL,
    p_requestor      TEXT        DEFAULT NULL,
    p_project_id  UUID        DEFAULT NULL,
    p_limit       INT         DEFAULT 100
)
RETURNS TABLE (
    id           UUID,
    logged_at    TIMESTAMPTZ,
    operation    TEXT,
    access_path  TEXT,
    requestor    TEXT,
    document_id  UUID,
    doc_title    TEXT,
    project_id   UUID,
    query_text   TEXT,
    result_count INT,
    extra        JSONB
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
    SELECT
        ul.id,
        ul.logged_at,
        ul.operation,
        ul.access_path,
        ul.requestor,
        ul.document_id,
        d.title AS doc_title,
        ul.project_id,
        ul.query_text,
        ul.result_count,
        ul.extra
    FROM cerefox_usage_log ul
    LEFT JOIN cerefox_documents d ON ul.document_id = d.id
    WHERE (p_start IS NULL       OR ul.logged_at >= p_start)
      AND (p_end IS NULL         OR ul.logged_at <= p_end)
      AND (p_operation IS NULL   OR ul.operation = p_operation)
      AND (p_access_path IS NULL OR ul.access_path = p_access_path)
      AND (p_requestor IS NULL      OR ul.requestor = p_requestor)
      AND (p_project_id IS NULL  OR ul.project_id = p_project_id)
    ORDER BY ul.logged_at DESC
    LIMIT p_limit;
$$;

-- ── cerefox_usage_summary ────────────────────────────────────────────────────
-- Returns a JSON object with aggregated stats for the analytics page.

CREATE OR REPLACE FUNCTION cerefox_usage_summary(
    p_start       TIMESTAMPTZ DEFAULT NULL,
    p_end         TIMESTAMPTZ DEFAULT NULL,
    p_project_id  UUID        DEFAULT NULL,
    p_access_path TEXT        DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_result JSON;
BEGIN
    WITH filtered AS (
        SELECT *
        FROM cerefox_usage_log ul
        WHERE (p_start IS NULL       OR ul.logged_at >= p_start)
          AND (p_end IS NULL         OR ul.logged_at <= p_end)
          AND (p_project_id IS NULL  OR ul.project_id = p_project_id)
          AND (p_access_path IS NULL OR ul.access_path = p_access_path)
    ),
    ops_by_day AS (
        SELECT DATE(logged_at) AS day, COUNT(*) AS count
        FROM filtered
        GROUP BY DATE(logged_at)
        ORDER BY day
    ),
    ops_by_operation AS (
        SELECT operation, COUNT(*) AS count
        FROM filtered
        GROUP BY operation
        ORDER BY count DESC
    ),
    ops_by_access_path AS (
        SELECT access_path, COUNT(*) AS count
        FROM filtered
        GROUP BY access_path
        ORDER BY count DESC
    ),
    top_documents AS (
        SELECT f.document_id, d.title AS doc_title, COUNT(*) AS count
        FROM filtered f
        JOIN cerefox_documents d ON f.document_id = d.id
        WHERE f.document_id IS NOT NULL
        GROUP BY f.document_id, d.title
        ORDER BY count DESC
        LIMIT 10
    ),
    top_requestors AS (
        SELECT requestor, COUNT(*) AS count
        FROM filtered
        WHERE requestor IS NOT NULL
        GROUP BY requestor
        ORDER BY count DESC
        LIMIT 10
    )
    SELECT json_build_object(
        'total_count', (SELECT COUNT(*) FROM filtered),
        'ops_by_day', COALESCE((SELECT json_agg(json_build_object('day', day, 'count', count)) FROM ops_by_day), '[]'::JSON),
        'ops_by_operation', COALESCE((SELECT json_agg(json_build_object('operation', operation, 'count', count)) FROM ops_by_operation), '[]'::JSON),
        'ops_by_access_path', COALESCE((SELECT json_agg(json_build_object('access_path', access_path, 'count', count)) FROM ops_by_access_path), '[]'::JSON),
        'top_documents', COALESCE((SELECT json_agg(json_build_object('document_id', document_id, 'doc_title', doc_title, 'count', count)) FROM top_documents), '[]'::JSON),
        'top_requestors', COALESCE((SELECT json_agg(json_build_object('requestor', requestor, 'count', count)) FROM top_requestors), '[]'::JSON)
    ) INTO v_result;

    RETURN v_result;
END;
$$;
