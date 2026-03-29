-- Migration 0005: Metadata search + project name standardisation (Iteration 16B)
--
-- Changes:
--   1. Add project_names TEXT[] to all chunk-level search RPCs (hybrid, fts, semantic)
--   2. Add project_names TEXT[] to document-level RPCs (search_docs, reconstruct_doc, get_document)
--   3. New cerefox_list_projects() RPC
--   4. New cerefox_metadata_search() RPC
--
-- All DROP + CREATE pairs are required because RETURNS TABLE signature changes
-- cannot be applied via CREATE OR REPLACE.

-- ── 1. Drop existing signatures before recreating with project_names ─────────

-- Chunk-level RPCs
DROP FUNCTION IF EXISTS cerefox_hybrid_search(TEXT, VECTOR(768), INT, FLOAT, BOOLEAN, UUID, FLOAT, JSONB);
DROP FUNCTION IF EXISTS cerefox_fts_search(TEXT, INT, UUID, JSONB);
DROP FUNCTION IF EXISTS cerefox_semantic_search(VECTOR(768), INT, BOOLEAN, UUID, FLOAT, JSONB);

-- Document-level RPCs
DROP FUNCTION IF EXISTS cerefox_search_docs(TEXT, VECTOR(768), INT, FLOAT, UUID, FLOAT, INT, INT, JSONB);
DROP FUNCTION IF EXISTS cerefox_reconstruct_doc(UUID);
DROP FUNCTION IF EXISTS cerefox_get_document(UUID, UUID);

-- ── 2. Recreate chunk-level RPCs with project_names TEXT[] ───────────────────

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
    WHERE cm.has_fts_match OR cm.vec_score >= p_min_score
    ORDER BY cm.score DESC
    LIMIT p_match_count;
END;
$$;


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
      AND (p_project_id IS NULL OR EXISTS (
              SELECT 1 FROM cerefox_document_projects dp
              WHERE dp.document_id = d.id AND dp.project_id = p_project_id
          ))
      AND (p_metadata_filter IS NULL OR d.metadata @> p_metadata_filter)
      AND (p_use_upgrade = FALSE OR c.embedding_upgrade IS NOT NULL)
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

-- ── 3. Recreate document-level RPCs with project_names TEXT[] ────────────────

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
    doc_sizes AS (
        SELECT c.document_id, SUM(c.char_count)::INT AS total_chars
        FROM cerefox_chunks c
        WHERE c.document_id IN (SELECT document_id FROM top_docs)
          AND c.version_id IS NULL
        GROUP BY c.document_id
    ),
    large_doc_seeds AS (
        SELECT cr.chunk_id
        FROM chunk_results cr
        JOIN doc_sizes ds ON cr.document_id = ds.document_id
        WHERE p_small_to_big_threshold > 0
          AND ds.total_chars > p_small_to_big_threshold
          AND cr.document_id IN (SELECT document_id FROM top_docs)
    ),
    expanded AS (
        SELECT ec.chunk_id, ec.document_id, ec.chunk_index, ec.content
        FROM cerefox_context_expand(
            COALESCE((SELECT ARRAY_AGG(chunk_id) FROM large_doc_seeds), ARRAY[]::UUID[]),
            p_context_window
        ) ec
    ),
    large_doc_content AS (
        SELECT
            e.document_id,
            STRING_AGG(e.content, E'\n\n' ORDER BY e.chunk_index) AS full_content,
            COUNT(*)::INT AS chunk_count,
            TRUE          AS is_partial
        FROM expanded e
        GROUP BY e.document_id
    ),
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
        ds.total_chars,
        td.doc_updated_at,
        td.version_count,
        ac.is_partial
    FROM top_docs td
    JOIN doc_sizes ds ON ds.document_id = td.document_id
    JOIN all_content ac ON ac.document_id = td.document_id
    ORDER BY td.best_score DESC;
$$;


CREATE FUNCTION cerefox_reconstruct_doc(
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

-- ── 4. New RPC: cerefox_list_projects ────────────────────────────────────────

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

-- ── 5. New RPC: cerefox_metadata_search ──────────────────────────────────────
-- Query documents by metadata key-value criteria without a text search term.
-- Uses JSONB containment (@>) which leverages the existing GIN index on
-- cerefox_documents.metadata.

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
