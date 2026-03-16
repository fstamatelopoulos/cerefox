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

-- Drop old hybrid/fts/search_docs/reconstruct_doc signatures that returned
-- doc_project_id UUID (singular); new versions return doc_project_ids UUID[] (array).
DROP FUNCTION IF EXISTS cerefox_hybrid_search(TEXT, VECTOR(768), INT, FLOAT, BOOLEAN, UUID, FLOAT);
DROP FUNCTION IF EXISTS cerefox_fts_search(TEXT, INT, UUID);
DROP FUNCTION IF EXISTS cerefox_search_docs(TEXT, VECTOR(768), INT, FLOAT, UUID, FLOAT);
DROP FUNCTION IF EXISTS cerefox_reconstruct_doc(UUID);

-- Drop search_docs without doc_updated_at (return type changed to add that column).
DROP FUNCTION IF EXISTS cerefox_search_docs(TEXT, VECTOR(768), INT, FLOAT, UUID, FLOAT);

-- ── Shared return type note ────────────────────────────────────────────────────
-- All chunk-level search RPCs return the same shape for consistency:
--   chunk_id, document_id, chunk_index, title, content, heading_path,
--   heading_level, score, doc_title, doc_source, doc_project_ids, doc_metadata
-- Note: doc_project_ids is UUID[] (array) — a document can belong to many projects.

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
    p_min_score       FLOAT   DEFAULT 0.0
)
RETURNS TABLE (
    chunk_id       UUID,
    document_id    UUID,
    chunk_index    INT,
    title          TEXT,
    content        TEXT,
    heading_path   TEXT[],
    heading_level  INT,
    score          FLOAT,
    doc_title      TEXT,
    doc_source     TEXT,
    doc_project_ids UUID[],
    doc_metadata   JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
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
            WHERE c.fts @@ query_fts
              AND (p_project_id IS NULL OR EXISTS (
                      SELECT 1 FROM cerefox_document_projects dp
                      WHERE dp.document_id = d.id AND dp.project_id = p_project_id
                  ))
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
            WHERE (p_project_id IS NULL OR EXISTS (
                      SELECT 1 FROM cerefox_document_projects dp
                      WHERE dp.document_id = d.id AND dp.project_id = p_project_id
                  ))
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
        d.metadata      AS doc_metadata
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
    p_query_text  TEXT,
    p_match_count INT  DEFAULT 10,
    p_project_id  UUID DEFAULT NULL
)
RETURNS TABLE (
    chunk_id       UUID,
    document_id    UUID,
    chunk_index    INT,
    title          TEXT,
    content        TEXT,
    heading_path   TEXT[],
    heading_level  INT,
    score          FLOAT,
    doc_title      TEXT,
    doc_source     TEXT,
    doc_project_ids UUID[],
    doc_metadata   JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
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
        d.metadata      AS doc_metadata
    FROM cerefox_chunks c
    JOIN cerefox_documents d ON c.document_id = d.id
    WHERE c.fts @@ query_fts
      AND (p_project_id IS NULL OR EXISTS (
              SELECT 1 FROM cerefox_document_projects dp
              WHERE dp.document_id = d.id AND dp.project_id = p_project_id
          ))
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
    p_min_score       FLOAT   DEFAULT 0.0
)
RETURNS TABLE (
    chunk_id       UUID,
    document_id    UUID,
    chunk_index    INT,
    title          TEXT,
    content        TEXT,
    heading_path   TEXT[],
    heading_level  INT,
    score          FLOAT,
    doc_title      TEXT,
    doc_source     TEXT,
    doc_project_ids UUID[],
    doc_metadata   JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
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
        d.metadata      AS doc_metadata
    FROM cerefox_chunks c
    JOIN cerefox_documents d ON c.document_id = d.id
    WHERE (p_project_id IS NULL OR EXISTS (
              SELECT 1 FROM cerefox_document_projects dp
              WHERE dp.document_id = d.id AND dp.project_id = p_project_id
          ))
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
    full_content    TEXT,
    chunk_count     INT,
    total_chars     INT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT
        d.id            AS document_id,
        d.title         AS doc_title,
        d.source        AS doc_source,
        d.metadata      AS doc_metadata,
        ARRAY(SELECT dp.project_id FROM cerefox_document_projects dp
              WHERE dp.document_id = d.id) AS doc_project_ids,
        STRING_AGG(c.content, E'\n\n' ORDER BY c.chunk_index) AS full_content,
        COUNT(*)::INT   AS chunk_count,
        SUM(c.char_count)::INT AS total_chars
    FROM cerefox_documents d
    JOIN cerefox_chunks c ON c.document_id = d.id
    WHERE d.id = p_document_id
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
-- returns up to p_match_count *distinct documents* with their full content.
--
-- Use this when you want complete notes rather than isolated snippets.
-- Best for AI agents querying a personal knowledge base where notes are
-- small-to-medium sized and full context is more valuable than precision.
--
-- Parameters:
--   p_query_text      : Query string (used for FTS)
--   p_query_embedding : 768-dim query embedding (used for vector search)
--   p_match_count     : Max documents to return (default: 5)
--   p_alpha           : Semantic weight 0.0–1.0 (default: 0.7)
--   p_project_id      : Optional project filter (M2M: document must be in project)
--   p_min_score       : Minimum cosine similarity for vector results (default 0.0 here;
--                       the Python layer applies CEREFOX_MIN_SEARCH_SCORE, default 0.65).
--                       If calling this RPC directly (e.g. from an agent), set this
--                       explicitly — 0.0 disables filtering and returns everything.
--
-- Returns one row per document with full reconstructed content.

CREATE OR REPLACE FUNCTION cerefox_search_docs(
    p_query_text      TEXT,
    p_query_embedding VECTOR(768),
    p_match_count     INT   DEFAULT 5,
    p_alpha           FLOAT DEFAULT 0.7,
    p_project_id      UUID  DEFAULT NULL,
    p_min_score       FLOAT DEFAULT 0.0
)
RETURNS TABLE (
    document_id              UUID,
    doc_title                TEXT,
    doc_source               TEXT,
    doc_metadata             JSONB,
    doc_project_ids          UUID[],
    best_score               FLOAT,
    best_chunk_heading_path  TEXT[],
    full_content             TEXT,
    chunk_count              INT,
    total_chars              INT,
    doc_updated_at           TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    WITH chunk_results AS (
        -- Run hybrid search with a 10x candidate pool so deduplication has
        -- enough candidates to fill p_match_count unique documents.
        -- Personal knowledge bases have many chunks per document, so a 10x
        -- multiplier reliably surfaces p_match_count distinct documents.
        SELECT * FROM cerefox_hybrid_search(
            p_query_text      := p_query_text,
            p_query_embedding := p_query_embedding,
            p_match_count     := p_match_count * 10,
            p_alpha           := p_alpha,
            p_use_upgrade     := FALSE,
            p_project_id      := p_project_id,
            p_min_score       := p_min_score
        )
    ),
    best_per_doc AS (
        -- One row per document: keep the highest-scoring chunk as representative.
        -- Join cerefox_documents to pick up updated_at.
        SELECT DISTINCT ON (cr.document_id)
            cr.document_id,
            cr.heading_path    AS best_chunk_heading_path,
            cr.score           AS best_score,
            cr.doc_title,
            cr.doc_source,
            cr.doc_metadata,
            cr.doc_project_ids,
            d.updated_at       AS doc_updated_at
        FROM chunk_results cr
        JOIN cerefox_documents d ON d.id = cr.document_id
        ORDER BY cr.document_id, cr.score DESC
    ),
    top_docs AS (
        -- Rank documents by their best chunk score, then take top N.
        SELECT *
        FROM best_per_doc
        ORDER BY best_score DESC
        LIMIT p_match_count
    ),
    full_docs AS (
        -- Reconstruct full content for each top document from its chunks.
        SELECT
            c.document_id,
            STRING_AGG(c.content, E'\n\n' ORDER BY c.chunk_index) AS full_content,
            COUNT(*)::INT                                          AS chunk_count,
            SUM(c.char_count)::INT                                 AS total_chars
        FROM cerefox_chunks c
        WHERE c.document_id IN (SELECT document_id FROM top_docs)
        GROUP BY c.document_id
    )
    SELECT
        td.document_id,
        td.doc_title,
        td.doc_source,
        td.doc_metadata,
        td.doc_project_ids,
        td.best_score,
        td.best_chunk_heading_path,
        fd.full_content,
        fd.chunk_count,
        fd.total_chars,
        td.doc_updated_at
    FROM top_docs td
    JOIN full_docs fd ON fd.document_id = td.document_id
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
AS $$
    WITH seeds AS (
        SELECT c.id, c.document_id, c.chunk_index
        FROM cerefox_chunks c
        WHERE c.id = ANY(p_chunk_ids)
    ),
    expanded AS (
        SELECT DISTINCT c.id
        FROM cerefox_chunks c
        JOIN seeds s ON c.document_id = s.document_id
        WHERE c.chunk_index BETWEEN s.chunk_index - p_window_size
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
