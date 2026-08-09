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

-- Iteration 32 (v0.11, optimistic concurrency): content_hash added to the return
-- types of all document-shaped reads — the writer's concurrency token must be
-- obtainable from every read surface. Drop the pre-change signatures first.
DROP FUNCTION IF EXISTS cerefox_get_document(UUID, UUID);
DROP FUNCTION IF EXISTS cerefox_search_docs(TEXT, VECTOR(768), INT, FLOAT, UUID, FLOAT, INT, INT, JSONB);
DROP FUNCTION IF EXISTS cerefox_metadata_search(JSONB, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT, BOOLEAN, INT);
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

-- Iteration 28I (v1.0.3, search recall): below_confidence BOOLEAN added to the
-- return types of cerefox_hybrid_search and cerefox_search_docs (never-silently-
-- empty fallback). Drop the pre-change signatures first.
DROP FUNCTION IF EXISTS cerefox_hybrid_search(TEXT, VECTOR(768), INT, FLOAT, BOOLEAN, UUID, FLOAT, JSONB);
DROP FUNCTION IF EXISTS cerefox_search_docs(TEXT, VECTOR(768), INT, FLOAT, UUID, FLOAT, INT, INT, JSONB);

-- Iteration 28I follow-up (v1.0.4, term-coverage gate): p_min_term_coverage
-- added to the search RPC signatures (new arg count = new function; the old
-- overloads must go or PostgREST calls become ambiguous).
DROP FUNCTION IF EXISTS cerefox_hybrid_search(TEXT, VECTOR(768), INT, FLOAT, BOOLEAN, UUID, FLOAT, JSONB);
DROP FUNCTION IF EXISTS cerefox_fts_search(TEXT, INT, UUID, JSONB);
DROP FUNCTION IF EXISTS cerefox_search_docs(TEXT, VECTOR(768), INT, FLOAT, UUID, FLOAT, INT, INT, JSONB);

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
    p_alpha           FLOAT   DEFAULT NULL,
    p_use_upgrade     BOOLEAN DEFAULT FALSE,
    p_project_id      UUID    DEFAULT NULL,
    -- NULL means "not specified by the caller" (#133): resolve from
    -- cerefox_config, else the built-in default. Callers that pass a value
    -- still win — the chain is per-call > client .env > DB config > default.
    p_min_score       FLOAT   DEFAULT NULL,
    p_metadata_filter JSONB   DEFAULT NULL,
    -- 28I follow-up (v1.0.4): in OR-fallback mode, the unconditional FTS pass
    -- requires at least this fraction of the query's meaningful (non-stopword,
    -- deduplicated) terms to match the chunk. Under AND semantics a match
    -- meant 100% of terms — the pass this gate generalizes. Chunks below the
    -- bar can still pass via the vector threshold, else they are
    -- below-confidence material. 0 restores the pre-gate OR behavior.
    p_min_term_coverage FLOAT DEFAULT NULL
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
    version_count   INT,
    -- 28I: TRUE on every row of a below-confidence fallback response — nothing
    -- cleared the pass-filter, so these are the best-effort top candidates for
    -- the caller to judge (scores included). FALSE on all normal results.
    below_confidence BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    -- plainto_tsquery: ANDs all terms, treats every token as a literal word.
    -- We deliberately avoid websearch_to_tsquery here because it interprets `-` as
    -- a negation operator, which traps natural queries against dashed titles
    -- (e.g. `Job Hunting - Opportunity Index`). Agent queries don't use the
    -- websearch operators (phrase, OR, NOT); semantic ranking is the soft-match
    -- layer for "broadly related". If operator support is ever needed, gate it
    -- behind an opt-in flag rather than changing the default.
    --
    -- 28I progressive relaxation: AND-first, OR-fallback. The AND query stays
    -- the primary match (byte-identical behavior whenever it matches anything),
    -- but when it matches ZERO chunks (under the same project/metadata filters),
    -- we retry with an OR-composition of the same tokens: one absent term then
    -- no longer vetoes the terms that DO occur, and ts_rank_cd naturally ranks
    -- chunks matching more terms higher. Multi-term evidence accumulates
    -- instead of vetoing.
    query_fts_and tsquery := plainto_tsquery('english', p_query_text);
    query_fts_or  tsquery := NULL;
    query_fts     tsquery;
    tok           TEXT;
    tok_q         tsquery;
    and_matches   BOOLEAN := FALSE;
    -- v1.0.4 coverage gate: the per-token queries (deduplicated by normalized
    -- lexeme text, so "run running" counts once) and their count.
    tok_queries   tsquery[] := '{}';
    seen_tokens   TEXT[]    := '{}';
    total_tokens  INT;
    candidate_count INT := p_match_count * 5;
    -- #133 resolution: caller value, else deployment config, else built-in.
    v_min_score     FLOAT := COALESCE(p_min_score,
                                      cerefox_config_float('min_search_score', 0.5));
    v_alpha         FLOAT := COALESCE(p_alpha,
                                      cerefox_config_float('search_alpha', 0.7));
    v_min_coverage  FLOAT := COALESCE(p_min_term_coverage,
                                      cerefox_config_float('min_term_coverage', 0.5));
BEGIN
    -- Build the OR-composed query: plainto each whitespace token (so tokens get
    -- the same normalization/stemming as the AND path), skip stopword-only
    -- tokens, dedupe by normalized form, fold with the tsquery OR operator (||).
    FOR tok IN SELECT unnest(regexp_split_to_array(trim(p_query_text), '\s+')) LOOP
        tok_q := plainto_tsquery('english', tok);
        IF numnode(tok_q) > 0 AND NOT (tok_q::TEXT = ANY(seen_tokens)) THEN
            seen_tokens := seen_tokens || tok_q::TEXT;
            tok_queries := tok_queries || tok_q;
            query_fts_or := CASE WHEN query_fts_or IS NULL
                                 THEN tok_q ELSE query_fts_or || tok_q END;
        END IF;
    END LOOP;
    total_tokens := COALESCE(array_length(tok_queries, 1), 0);

    -- Does the strict AND query match anything at all (under the caller's
    -- filters)? Cheap probe against the partial FTS index.
    IF numnode(query_fts_and) > 0 THEN
        SELECT EXISTS (
            SELECT 1
            FROM cerefox_chunks c
            JOIN cerefox_documents d ON c.document_id = d.id
            WHERE c.version_id IS NULL
              AND d.deleted_at IS NULL
              AND c.fts @@ query_fts_and
              AND (p_project_id IS NULL OR EXISTS (
                      SELECT 1 FROM cerefox_document_projects dp
                      WHERE dp.document_id = d.id AND dp.project_id = p_project_id
                  ))
              AND (p_metadata_filter IS NULL OR d.metadata @> p_metadata_filter)
        ) INTO and_matches;
    END IF;

    query_fts := CASE WHEN and_matches THEN query_fts_and
                      ELSE COALESCE(query_fts_or, query_fts_and) END;

    RETURN QUERY
    WITH
        fts_results AS (
            SELECT
                c.id,
                ts_rank_cd(c.fts, query_fts)::FLOAT AS fts_score,
                -- v1.0.4 coverage gate: in AND mode a match means 100% of the
                -- query's terms are present, so the unconditional pass is
                -- earned by construction. In OR-fallback mode, earn it only
                -- when at least p_min_term_coverage of the meaningful terms
                -- match this chunk; weaker matches keep contributing their
                -- fts_score to the fusion but must pass via the vector
                -- threshold (or surface as below-confidence candidates).
                CASE
                    WHEN and_matches OR total_tokens = 0 THEN TRUE
                    ELSE (SELECT COUNT(*) FROM unnest(tok_queries) tq
                          WHERE c.fts @@ tq)::FLOAT
                         >= v_min_coverage * total_tokens
                END AS coverage_ok
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
                (   v_alpha * COALESCE(v.vec_score, 0.0) +
                    (1.0 - v_alpha) * COALESCE(f.fts_score, 0.0)
                ) AS score,
                COALESCE(v.vec_score, 0.0) AS vec_score,
                -- TRUE when the chunk matched the @@ FTS operator WITH enough
                -- term coverage to earn the unconditional pass (v1.0.4; always
                -- true for AND-mode matches). We use this flag rather than
                -- vec_score to decide whether a chunk passes the threshold,
                -- because in small corpora every chunk appears in vec_results
                -- (LIMIT candidate_count covers all rows), so vec_score is
                -- never NULL even for FTS-only matches.
                (f.id IS NOT NULL AND f.coverage_ok) AS has_fts_match
            FROM fts_results f
            FULL OUTER JOIN vec_results v ON f.id = v.id
        ),
        -- 28I: pass-filter as a flag rather than a WHERE, so we can fall back.
        -- FTS matches pass through unconditionally: the @@ operator is a hard
        -- gate and guarantees the query terms appear in the chunk. Vector-only
        -- results (no FTS match) are filtered by the cosine threshold.
        flagged AS (
            SELECT *,
                   (combined.has_fts_match OR combined.vec_score >= v_min_score) AS passes
            FROM combined
        ),
        any_pass AS (SELECT bool_or(fl.passes) AS ok FROM flagged fl),
        -- v1.0.6: in the below-confidence fallback, rank each candidate WITHIN
        -- its parent document so we can return one chunk per document. The cap
        -- used to apply to chunks, so when a document owned several of the top
        -- chunks the caller saw fewer than 3 results after document-level
        -- de-duplication (cerefox_search_docs, CLI and web) — the count varied
        -- with corpus shape rather than with the cap.
        ranked AS (
            SELECT fl.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY ch.document_id ORDER BY fl.score DESC
                   ) AS rank_in_doc
            FROM flagged fl
            JOIN cerefox_chunks ch ON ch.id = fl.id
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
         WHERE dv.document_id = d.id) AS version_count,
        -- 28I: when NOTHING clears the pass-filter, return the top candidates
        -- anyway, flagged — an empty response reads to agent callers as "this
        -- knowledge does not exist", the most expensive wrong conclusion a
        -- memory layer can produce. "Truly nothing" (no candidates at all)
        -- still returns zero rows.
        NOT ap.ok       AS below_confidence
    FROM ranked cm
    CROSS JOIN any_pass ap
    JOIN cerefox_chunks   c ON c.id = cm.id
    JOIN cerefox_documents d ON c.document_id = d.id
    -- Normal results are unchanged; fallback rows are restricted to each
    -- document's best chunk so the cap below counts documents, not chunks.
    WHERE cm.passes OR (NOT ap.ok AND cm.rank_in_doc = 1)
    ORDER BY cm.score DESC
    LIMIT (SELECT CASE WHEN ap2.ok THEN p_match_count
                       ELSE LEAST(p_match_count, 3) END
           FROM any_pass ap2);
END;
$$;

-- ── FTS-Only Search ───────────────────────────────────────────────────────────
-- Pure keyword / exact-match search. Best for names, dates, tags.

CREATE OR REPLACE FUNCTION cerefox_fts_search(
    p_query_text      TEXT,
    p_match_count     INT  DEFAULT 10,
    p_project_id      UUID DEFAULT NULL,
    p_metadata_filter JSONB DEFAULT NULL,
    -- v1.0.4: see cerefox_hybrid_search. In OR-fallback mode results must
    -- match at least this fraction of the query's meaningful terms.
    p_min_term_coverage FLOAT DEFAULT NULL
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
    -- plainto_tsquery + 28I AND-first/OR-fallback: see the rationale comments
    -- in cerefox_hybrid_search above.
    query_fts_and tsquery := plainto_tsquery('english', p_query_text);
    query_fts_or  tsquery := NULL;
    query_fts     tsquery;
    tok           TEXT;
    tok_q         tsquery;
    and_matches   BOOLEAN := FALSE;
    tok_queries   tsquery[] := '{}';
    seen_tokens   TEXT[]    := '{}';
    total_tokens  INT;
    v_min_coverage FLOAT := COALESCE(p_min_term_coverage,
                                     cerefox_config_float('min_term_coverage', 0.5));
BEGIN
    FOR tok IN SELECT unnest(regexp_split_to_array(trim(p_query_text), '\s+')) LOOP
        tok_q := plainto_tsquery('english', tok);
        IF numnode(tok_q) > 0 AND NOT (tok_q::TEXT = ANY(seen_tokens)) THEN
            seen_tokens := seen_tokens || tok_q::TEXT;
            tok_queries := tok_queries || tok_q;
            query_fts_or := CASE WHEN query_fts_or IS NULL
                                 THEN tok_q ELSE query_fts_or || tok_q END;
        END IF;
    END LOOP;
    total_tokens := COALESCE(array_length(tok_queries, 1), 0);

    IF numnode(query_fts_and) > 0 THEN
        SELECT EXISTS (
            SELECT 1
            FROM cerefox_chunks c
            JOIN cerefox_documents d ON c.document_id = d.id
            WHERE c.version_id IS NULL
              AND d.deleted_at IS NULL
              AND c.fts @@ query_fts_and
              AND (p_project_id IS NULL OR EXISTS (
                      SELECT 1 FROM cerefox_document_projects dp
                      WHERE dp.document_id = d.id AND dp.project_id = p_project_id
                  ))
              AND (p_metadata_filter IS NULL OR d.metadata @> p_metadata_filter)
        ) INTO and_matches;
    END IF;

    query_fts := CASE WHEN and_matches THEN query_fts_and
                      ELSE COALESCE(query_fts_or, query_fts_and) END;

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
      -- v1.0.4 coverage gate (OR-fallback mode only): pure keyword search
      -- returns only chunks matching enough of the query's terms.
      AND (and_matches OR total_tokens = 0
           OR (SELECT COUNT(*) FROM unnest(tok_queries) tq
               WHERE c.fts @@ tq)::FLOAT >= v_min_coverage * total_tokens)
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
        CASE WHEN MAX(c.content_format) >= 2 THEN STRING_AGG(c.content, '' ORDER BY c.chunk_index) ELSE STRING_AGG(c.content, E'\n\n' ORDER BY c.chunk_index) END AS full_content,
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
    p_alpha                  FLOAT DEFAULT NULL,
    p_project_id             UUID  DEFAULT NULL,
    p_min_score              FLOAT DEFAULT NULL,
    p_small_to_big_threshold INT   DEFAULT 20000,
    p_context_window         INT   DEFAULT 1,
    p_metadata_filter        JSONB DEFAULT NULL,
    -- NULL flows through to cerefox_hybrid_search, which resolves the
    -- caller > cerefox_config > built-in chain in one place (#133).
    p_min_term_coverage      FLOAT DEFAULT NULL
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
    is_partial               BOOL,
    -- Optimistic-concurrency token (iter-32): the document's current
    -- content_hash, to pass back as expected_content_hash on update.
    content_hash             TEXT,
    -- 28I: TRUE when this is a below-confidence fallback response (nothing
    -- cleared the hybrid pass-filter). See cerefox_hybrid_search.
    below_confidence         BOOLEAN
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
            p_metadata_filter := p_metadata_filter,
            p_min_term_coverage := p_min_term_coverage
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
            cr.below_confidence,
            d.updated_at       AS doc_updated_at,
            d.content_hash
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
            CASE WHEN MAX(ch.content_format) >= 2 THEN STRING_AGG(e.content, '' ORDER BY e.chunk_index) ELSE STRING_AGG(e.content, E'\n\n' ORDER BY e.chunk_index) END AS full_content,
            COUNT(*)::INT AS chunk_count,
            TRUE          AS is_partial
        FROM expanded e
        JOIN cerefox_chunks ch ON ch.id = e.chunk_id
        GROUP BY e.document_id
    ),
    -- Full content for small documents (is_partial = FALSE).
    small_doc_content AS (
        SELECT
            c.document_id,
            CASE WHEN MAX(c.content_format) >= 2 THEN STRING_AGG(c.content, '' ORDER BY c.chunk_index) ELSE STRING_AGG(c.content, E'\n\n' ORDER BY c.chunk_index) END AS full_content,
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
        ac.is_partial,
        td.content_hash,
        td.below_confidence
    FROM top_docs td
    JOIN doc_sizes ds ON ds.document_id = td.document_id
    JOIN all_content ac ON ac.document_id = td.document_id
    ORDER BY td.best_score DESC;
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
--   p_retention_hours : Retention window in hours. NULL (default) reads
--                       `version_retention_hours` from cerefox_config, else 120
--                       (5 days — long enough that a bad edit made on a Friday
--                       is still recoverable on Monday; 48h was not).
--                       A non-NULL value overrides the store policy for this
--                       call only.
--
-- Returns: (version_id, version_number, chunk_count, total_chars) of the new version

DROP FUNCTION IF EXISTS cerefox_snapshot_version(UUID, TEXT, INT);
DROP FUNCTION IF EXISTS cerefox_snapshot_version(UUID, TEXT, INT, BOOLEAN);
CREATE FUNCTION cerefox_snapshot_version(
    p_document_id       UUID,
    p_source            TEXT    DEFAULT 'manual',
    -- NULL (the new default) means "use the store's policy from
    -- cerefox_config". Passing a value still overrides, for deliberate one-off
    -- admin operations — but callers no longer supply one by accident.
    p_retention_hours   INT     DEFAULT NULL,
    p_cleanup_enabled   BOOLEAN DEFAULT NULL
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
    -- Resolve the retention policy from the STORE, not the caller.
    --
    -- These used to arrive as parameters filled from each client's own env, so
    -- the surviving version history depended on which client wrote last: an
    -- agent running defaults would prune versions that an operator had
    -- configured to keep. Retention describes the data, so it belongs to the
    -- data. Same COALESCE(param, config, default) shape the retrieval tunables
    -- already use.
    v_retention      INT     := COALESCE(p_retention_hours,
                                         cerefox_config_int('version_retention_hours', 120));
    v_cleanup        BOOLEAN := COALESCE(p_cleanup_enabled,
                                         cerefox_config_bool('version_cleanup_enabled', TRUE));
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
    IF v_cleanup THEN
        DELETE FROM cerefox_document_versions dv
        WHERE dv.document_id = p_document_id
          AND dv.archived IS NOT TRUE
          AND dv.created_at < NOW() - (v_retention || ' hours')::INTERVAL
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
    created_at      TIMESTAMPTZ,
    -- Current content_hash of the document — the optimistic-concurrency token
    -- to pass back as expected_content_hash on update (iter-32). Note: always
    -- the CURRENT hash, even when an archived version is being retrieved.
    content_hash    TEXT
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
        CASE WHEN MAX(c.content_format) >= 2 THEN STRING_AGG(c.content, '' ORDER BY c.chunk_index) ELSE STRING_AGG(c.content, E'\n\n' ORDER BY c.chunk_index) END AS full_content,
        COUNT(*)::INT   AS chunk_count,
        SUM(c.char_count)::INT AS total_chars,
        d.created_at,
        d.content_hash
    FROM cerefox_documents d
    JOIN cerefox_chunks c ON c.document_id = d.id
    WHERE d.id = p_document_id
      AND (
          (p_version_id IS NULL     AND c.version_id IS NULL) OR
          (p_version_id IS NOT NULL AND c.version_id = p_version_id)
      )
    GROUP BY d.id, d.title, d.source, d.metadata, d.created_at, d.content_hash;
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
--   p_title, p_source, p_source_path, p_content_hash : document fields
--   p_metadata        : JSONB metadata. NULL = "not provided" → create uses '{}',
--                       update keeps the existing metadata (v0.11.1). Pass '{}'
--                       explicitly to clear all metadata.
--   p_review_status   : 'approved' or 'pending_review' (based on author_type)
--   p_chunks          : JSONB array of chunk objects, each with:
--                        chunk_index, heading_path, heading_level, title,
--                        content, char_count, embedding (float[]), embedder (text)
--   p_author, p_author_type : for audit entry
--   p_source_label    : version source label for snapshot ('file','paste','agent','manual')
--   p_retention_hours : version-cleanup window. NULL (default) = use the store's
--                       `version_retention_hours` from cerefox_config.
--   p_cleanup_enabled : whether cleanup runs. NULL (default) = use the store's
--                       `version_cleanup_enabled`.
--   p_expected_content_hash : optimistic-concurrency token (iter-32). On the UPDATE
--                       path this must equal the document's current content_hash —
--                       the caller proves they based their edit on the live version.
--                       Mismatch → CEREFOX_CONFLICT (SQLSTATE PT409 → HTTP 409). Absent (NULL)
--                       without p_last_write_wins → CEREFOX_TOKEN_REQUIRED (22023).
--                       Ignored on the CREATE path.
--   p_last_write_wins : explicit opt-out of the concurrency check (filesystem-sync
--                       flows where an external source of truth makes conflicts
--                       meaningless). Recorded in the audit description when used.
--
-- Returns: document_id, chunk_count, total_chars, operation ('create' or 'update-content'),
--          version_id (UUID of snapshot, null on create)

DROP FUNCTION IF EXISTS cerefox_ingest_document(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, JSONB, TEXT, TEXT, TEXT, INT, BOOLEAN);
DROP FUNCTION IF EXISTS cerefox_ingest_document(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, JSONB, TEXT, TEXT, TEXT, INT, BOOLEAN, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS cerefox_ingest_document(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, JSONB, TEXT, TEXT, TEXT, INT, BOOLEAN, TEXT, BOOLEAN, SMALLINT);
-- iter-33: return shape gains content_hash + size_warning, so the 16-arg form
-- must be dropped before the 17-arg CREATE below (Postgres will not replace a
-- function whose RETURNS TABLE changed).
DROP FUNCTION IF EXISTS cerefox_ingest_document(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, JSONB, TEXT, TEXT, TEXT, INT, BOOLEAN, TEXT, BOOLEAN, SMALLINT, JSONB);
CREATE FUNCTION cerefox_ingest_document(
    p_document_id       UUID        DEFAULT NULL,
    p_title             TEXT        DEFAULT 'Untitled',
    p_source            TEXT        DEFAULT 'agent',
    p_source_path       TEXT        DEFAULT NULL,
    p_content_hash      TEXT        DEFAULT '',
    -- NULL = "not provided": create uses '{}', update KEEPS existing metadata
    -- (v0.11.1 fix — content updates without metadata used to wipe tags).
    -- Pass '{}' explicitly to deliberately clear all metadata.
    p_metadata          JSONB       DEFAULT NULL,
    p_review_status     TEXT        DEFAULT 'approved',
    p_chunks            JSONB       DEFAULT '[]',
    p_author            TEXT        DEFAULT 'unknown',
    p_author_type       TEXT        DEFAULT 'user',
    p_source_label      TEXT        DEFAULT 'manual',
    -- NULL, so `cerefox_snapshot_version` falls through to the store's policy in
    -- cerefox_config. These carried concrete defaults (48 / TRUE) until v1.1.2,
    -- which silently defeated the whole store-level retention feature: this is
    -- snapshot_version's ONLY caller, so it never once received NULL and never
    -- once consulted the config (#183, reported by @tdebasis). A caller may still
    -- pass explicit values to override the store for one call.
    p_retention_hours   INT         DEFAULT NULL,
    p_cleanup_enabled   BOOLEAN     DEFAULT NULL,
    p_expected_content_hash TEXT    DEFAULT NULL,
    p_last_write_wins   BOOLEAN     DEFAULT FALSE,
    -- content_format for the chunks being written (iter-28D). 2 = exact-partition
    -- (blind-stitch reconstruction); default 1 = legacy (E'\n\n'-join). Stamped on
    -- every chunk this call inserts.
    p_content_format    SMALLINT    DEFAULT 1,
    -- iter-33 (partial edits): when NULL, audit behaves exactly as before
    -- ('create' / 'update-content'). When set, it is a JSONB array of
    -- {"op": "...", "detail": "..."} and ONE audit entry is written per element,
    -- so a cerefox_edit batch records what it actually did rather than
    -- flattening to 'update-content'. NULL-means-today, per the #183 lesson:
    -- a parameter that substitutes its own concrete default is how store policy
    -- got silently overridden for a whole release.
    p_operations        JSONB       DEFAULT NULL
)
RETURNS TABLE (
    document_id     UUID,
    chunk_count     INT,
    total_chars     INT,
    operation       TEXT,
    version_id      UUID,
    -- iter-33: the hash just written, on CREATE as well as update (#189). A
    -- document is now born holding its own concurrency token, so the author
    -- never has to re-read it or fall back to last_write_wins.
    content_hash    TEXT,
    -- iter-33: true when the new size crosses `document_size_warning_chars`
    -- (dormant when that config is unset/0). A signal, never a refusal: an
    -- insert-only workflow otherwise never sees a document grow.
    size_warning    BOOLEAN
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
    v_current_hash  TEXT;
    v_chunk         JSONB;
    v_snap          RECORD;
    v_status        TEXT;
    v_op            JSONB;      -- iter-33: per-operation audit element
    v_size_warn_at  INT;
    v_size_warning  BOOLEAN := FALSE;
BEGIN
    -- ── Zero-chunk guard (v0.3.1) ────────────────────────────────────────
    -- Refuse to create or update a document with no chunks. Three reasons:
    --   1. A zero-chunk document is meaningless on its own (no body, no
    --      embeddings, can't be searched).
    --   2. The SQL signature has DEFAULTs for every parameter, so calling
    --      `SELECT cerefox_ingest_document()` with no args used to create
    --      an orphan `Untitled` row. v0.3.0's db-client introspection
    --      fallback hit this path; see the v0.3.1 Decision Log entry.
    --   3. It papers over the asymmetry between `list_documents` (returns
    --      0-chunk rows) and `cerefox_get_document` (404s on them).
    --      Cheaper to refuse the write than to fix both queries.
    -- If you actually need to clear a doc's content, soft-delete it.
    IF p_chunks IS NULL OR jsonb_array_length(p_chunks) = 0 THEN
        RAISE EXCEPTION
            'cerefox_ingest_document: refusing to write a document with zero chunks (title=%, source=%). Supply at least one chunk, or use cerefox_delete_document to clear content.',
            p_title, p_source
            USING ERRCODE = '22023';  -- invalid_parameter_value
    END IF;

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

        -- Lock the row and read its current state. FOR UPDATE makes the
        -- concurrency check below atomic with the write: two simultaneous
        -- updaters serialize here, and the second one sees the first one's
        -- hash — the race window (chunk + embed latency) is closed at the
        -- only place all transports share (iter-32).
        SELECT COALESCE(d.total_chars, 0), d.content_hash
        INTO v_old_chars, v_current_hash
        FROM cerefox_documents d WHERE d.id = v_doc_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'cerefox_ingest_document: document not found: %', v_doc_id
                USING ERRCODE = '22023';  -- invalid_parameter_value
        END IF;

        -- ── Optimistic concurrency check (iter-32) ───────────────────
        -- Content updates must prove freshness (expected hash) or explicitly
        -- choose last-write-wins. Message prefixes are machine-detectable:
        -- transport handlers map them to agent-first retry instructions.
        IF NOT p_last_write_wins THEN
            -- A blank token is an ABSENT token, not a stale one.
            --
            -- '' is not NULL, so an empty string used to skip the
            -- TOKEN_REQUIRED branch and fall into the conflict branch below:
            -- it can never equal a real hash, so it failed deterministically
            -- and forever. That is precisely the shape that drove the retry
            -- storm — a permanent failure reported as a retryable one. Even
            -- with PT409 now closing the loop, classifying it as a conflict is
            -- wrong: nobody read '' from a document, so the caller has not
            -- followed the read-before-write contract, which is a 400.
            IF NULLIF(BTRIM(p_expected_content_hash), '') IS NULL THEN
                RAISE EXCEPTION
                    'CEREFOX_TOKEN_REQUIRED: content updates require expected_content_hash (the content_hash you read) or last_write_wins=true. Current hash: %',
                    v_current_hash
                    USING ERRCODE = '22023';  -- invalid_parameter_value
            ELSIF p_expected_content_hash <> v_current_hash THEN
                RAISE EXCEPTION
                    'CEREFOX_CONFLICT: document % changed since it was read (expected hash %, current hash %). Re-read the document, merge your changes, and retry with the new hash.',
                    v_doc_id, p_expected_content_hash, v_current_hash
                    -- PT409 → HTTP 409 Conflict (PostgREST's PTxxx convention).
                    --
                    -- This was '40001' (serialization_failure) until v1.1.0-beta.6,
                    -- which was a category error with severe consequences. 40001 is
                    -- the ONE PostgreSQL class that promises "this was transient,
                    -- retry and it may succeed" — but a stale-token conflict is
                    -- DETERMINISTIC: the same request fails identically forever.
                    -- Retry-aware layers took the promise at face value and looped.
                    --
                    -- Measured on a real project: one HTTP request carrying a stale
                    -- hash executed this function 68,825 times in 125s before the
                    -- gateway returned 504 — and kept going after the client was
                    -- gone, passing 153,000 executions before the backend was killed
                    -- manually. A contributor hit the same loop for ~24h and 47
                    -- MILLION calls, which is what depleted their Disk IO budget.
                    -- The same probe raising PT409 executed exactly ONCE and
                    -- returned 409 in 636ms.
                    --
                    -- Rule of thumb: never raise a permanent application error under
                    -- a SQLSTATE whose contract says "retryable".
                    USING ERRCODE = 'PT409';
            END IF;
        END IF;

        -- Snapshot old version (archives current chunks, runs retention cleanup)
        SELECT sv.version_id INTO v_version_id
        FROM cerefox_snapshot_version(v_doc_id, p_source_label, p_retention_hours, p_cleanup_enabled) sv;

        -- Update document record. metadata: NULL = keep existing (v0.11.1 —
        -- a content update without metadata must not wipe the document's tags).
        UPDATE cerefox_documents SET
            title = p_title,
            source = p_source,
            source_path = COALESCE(p_source_path, source_path),
            content_hash = p_content_hash,
            metadata = COALESCE(p_metadata, metadata),
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
            p_title, p_source, p_source_path, p_content_hash, COALESCE(p_metadata, '{}'::JSONB),
            v_chunk_count, v_total_chars, v_status
        )
        RETURNING id INTO v_doc_id;
    END IF;

    -- ── Insert chunks ────────────────────────────────────────────────
    -- fts is computed here (Option B) using p_title (document title, already a parameter)
    -- and the chunk's own heading title + content. This avoids pre-computing tsvectors in
    -- the Python/TypeScript callers and keeps logic in one place (single-implementation).
    -- Formula: doc_title (A) || chunk_heading (A) || body_content (B)
    INSERT INTO cerefox_chunks (
        document_id, chunk_index, heading_path, heading_level,
        title, content, char_count, content_format, embedding_primary, embedder_primary, fts
    )
    SELECT
        v_doc_id,
        (c->>'chunk_index')::INT,
        ARRAY(SELECT jsonb_array_elements_text(c->'heading_path')),
        (c->>'heading_level')::INT,
        c->>'title',
        c->>'content',
        (c->>'char_count')::INT,
        p_content_format,
        (SELECT array_agg(e::FLOAT)::VECTOR(768) FROM jsonb_array_elements_text(c->'embedding') AS e),
        c->>'embedder',
        setweight(to_tsvector('english', COALESCE(p_title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(c->>'title', '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(c->>'content', '')), 'B')
    FROM jsonb_array_elements(p_chunks) AS c;

    -- ── Audit entries ────────────────────────────────────────────────
    -- p_operations NULL (every pre-iter-33 caller): one entry, exactly as before.
    -- p_operations set (cerefox_insert / cerefox_edit): one entry per operation,
    -- each under its own operation value, so the trail distinguishes "added to"
    -- from "rewrote" from "removed" instead of flattening to 'update-content'.
    -- The CHECK constraint on cerefox_audit_log.operation is the allow-list: a
    -- handler label that drifts from it aborts this transaction rather than
    -- silently recording something the readers of the trail cannot interpret.
    IF p_operations IS NULL OR jsonb_array_length(p_operations) = 0 THEN
        PERFORM cerefox_create_audit_entry(
            p_document_id := v_doc_id,
            p_version_id := v_version_id,
            p_operation := v_operation,
            p_author := p_author,
            p_author_type := p_author_type,
            p_size_before := CASE WHEN v_operation = 'create' THEN NULL ELSE v_old_chars END,
            p_size_after := v_total_chars,
            p_description := v_operation || ': ' || p_title || ' (' || v_chunk_count || ' chunks, ' || v_total_chars || ' chars)'
                || CASE WHEN p_last_write_wins AND v_operation = 'update-content'
                        THEN ' [last-write-wins]' ELSE '' END
        );
    ELSE
        FOR v_op IN SELECT * FROM jsonb_array_elements(p_operations) LOOP
            PERFORM cerefox_create_audit_entry(
                p_document_id := v_doc_id,
                p_version_id := v_version_id,
                p_operation := v_op->>'op',
                p_author := p_author,
                p_author_type := p_author_type,
                -- Sizes describe the whole write, so they go on the last entry
                -- only; per-operation sizes would double-count a single write.
                p_size_before := NULL,
                p_size_after := NULL,
                p_description := COALESCE(v_op->>'detail', v_op->>'op')
            );
        END LOOP;
        -- One sizing entry for the write as a whole.
        PERFORM cerefox_create_audit_entry(
            p_document_id := v_doc_id,
            p_version_id := v_version_id,
            p_operation := v_operation,
            p_author := p_author,
            p_author_type := p_author_type,
            p_size_before := CASE WHEN v_operation = 'create' THEN NULL ELSE v_old_chars END,
            p_size_after := v_total_chars,
            p_description := 'partial edit: ' || p_title || ' ('
                || jsonb_array_length(p_operations) || ' operation(s), '
                || v_chunk_count || ' chunks, ' || v_total_chars || ' chars)'
        );
    END IF;

    -- ── Size signal (iter-33) ────────────────────────────────────────
    -- Dormant unless an operator sets a threshold. Never blocks the write: a
    -- size policy is not a correctness rule, and an agent that only ever
    -- inserts otherwise never sees the document grow past its split point.
    v_size_warn_at := cerefox_config_int('document_size_warning_chars', 0);
    IF v_size_warn_at > 0 AND v_total_chars > v_size_warn_at THEN
        v_size_warning := TRUE;
    END IF;

    RETURN QUERY SELECT v_doc_id, v_chunk_count, v_total_chars, v_operation,
                        v_version_id, p_content_hash, v_size_warning;
END;
$$;


-- ── cerefox_update_chunk_fts ──────────────────────────────────────────────────
-- Updates the FTS tsvector for all current chunks of a document using a new
-- document title. Called when a document's title changes without a content change
-- (the content-unchanged path in the ingestion pipeline skips cerefox_ingest_document).
--
-- Formula: doc_title (A) || chunk_heading (A) || body_content (B)
-- Reads chunk title and content directly from the DB -- caller only needs to
-- supply the new document title.
--
-- Only affects current chunks (version_id IS NULL). Archived chunks retain their
-- original tsvectors (they are excluded from all search indexes and require
-- re-ingestion to restore anyway).

DROP FUNCTION IF EXISTS cerefox_update_chunk_fts(UUID, TEXT);
CREATE FUNCTION cerefox_update_chunk_fts(
    p_document_id   UUID,
    p_new_title     TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    UPDATE cerefox_chunks
    SET fts =
        setweight(to_tsvector('english', COALESCE(p_new_title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(content, '')), 'B')
    WHERE document_id = p_document_id
      AND version_id IS NULL;
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
    -- jsonb_object_keys() throws on non-object jsonb (scalar/array), and one such
    -- row would poison the whole listing (issue #89). jsonb_typeof covers NULL
    -- (returns NULL → filtered), scalars, and arrays; '{}' yields no keys anyway.
    WHERE jsonb_typeof(d.metadata) = 'object'
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
    -- Optimistic-concurrency token (iter-32): pass back as
    -- expected_content_hash on update.
    content_hash    TEXT,
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
            d.content_hash,
            CASE WHEN p_include_content THEN
                (SELECT CASE WHEN MAX(c.content_format) >= 2 THEN STRING_AGG(c.content, '' ORDER BY c.chunk_index) ELSE STRING_AGG(c.content, E'\n\n' ORDER BY c.chunk_index) END
                 FROM cerefox_chunks c
                 WHERE c.document_id = d.id AND c.version_id IS NULL)
            ELSE NULL END AS content
        FROM cerefox_documents d
        WHERE d.metadata @> p_metadata_filter
          AND d.deleted_at IS NULL
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
        content_hash  := v_row.content_hash;
        content       := v_row.content;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- ══ Document relations (iteration 29) ═════════════════════════════════════════
-- Typed edges between documents. Design:
-- docs/research/document-relations-and-semantic-graph.md
--
-- Type dictionary: rel_type is free text (any string is accepted and returned),
-- but a few KNOWN types carry behaviour. Keeping the dictionary in one place
-- here — rather than scattered CASE expressions — is what lets the set/delete
-- RPCs stay symmetric with each other.
--   symmetric   both directions are written/removed together
--   supersedes  target becomes 'superseded'
--   contradicts both documents become 'stale'
CREATE OR REPLACE FUNCTION cerefox_relation_is_symmetric(p_rel_type TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
    SELECT p_rel_type IN ('related_to', 'contradicts', 'duplicates');
$$;

-- Create (or update) a relation. Symmetric types write both directions in one
-- transaction, so a half-written pair is impossible.
CREATE OR REPLACE FUNCTION cerefox_set_relation(
    p_source_id   UUID,
    p_target_id   UUID,
    p_rel_type    TEXT,
    p_author      TEXT    DEFAULT 'unknown',
    p_author_type TEXT    DEFAULT 'agent',
    p_metadata    JSONB   DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    relation_id UUID,
    source_id   UUID,
    target_id   UUID,
    rel_type      TEXT,
    is_symmetric  BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
-- The OUT columns (source_id, target_id, rel_type) share names with the
-- table's columns; inside the INSERT/ON CONFLICT below the COLUMN is meant.
#variable_conflict use_column
DECLARE
    v_symmetric BOOLEAN := cerefox_relation_is_symmetric(p_rel_type);
    v_id        UUID;
BEGIN
    IF p_source_id = p_target_id THEN
        RAISE EXCEPTION 'A document cannot relate to itself (%).', p_source_id
            USING ERRCODE = '22023';
    END IF;
    IF p_rel_type IS NULL OR btrim(p_rel_type) = '' THEN
        RAISE EXCEPTION 'rel_type is required.' USING ERRCODE = '22023';
    END IF;
    -- Explicit existence checks give a clear error instead of an FK violation.
    IF NOT EXISTS (SELECT 1 FROM cerefox_documents d
                   WHERE d.id = p_source_id AND d.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Source document % not found (or deleted).', p_source_id
            USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cerefox_documents d
                   WHERE d.id = p_target_id AND d.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Target document % not found (or deleted).', p_target_id
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO cerefox_document_relations AS r
        (source_id, target_id, rel_type, metadata, author, author_type)
    VALUES (p_source_id, p_target_id, btrim(p_rel_type), COALESCE(p_metadata, '{}'::jsonb),
            p_author, p_author_type)
    ON CONFLICT (source_id, target_id, rel_type) DO UPDATE
        SET metadata = EXCLUDED.metadata,
            author = EXCLUDED.author,
            author_type = EXCLUDED.author_type
    RETURNING r.id INTO v_id;

    IF v_symmetric THEN
        INSERT INTO cerefox_document_relations
            (source_id, target_id, rel_type, metadata, author, author_type)
        VALUES (p_target_id, p_source_id, btrim(p_rel_type),
                COALESCE(p_metadata, '{}'::jsonb), p_author, p_author_type)
        ON CONFLICT (source_id, target_id, rel_type) DO UPDATE
            SET metadata = EXCLUDED.metadata,
                author = EXCLUDED.author,
                author_type = EXCLUDED.author_type;
    END IF;

    -- Lifecycle side effects (type dictionary).
    IF btrim(p_rel_type) = 'supersedes' THEN
        UPDATE cerefox_documents SET lifecycle_status = 'superseded'
        WHERE id = p_target_id;
    ELSIF btrim(p_rel_type) = 'contradicts' THEN
        UPDATE cerefox_documents SET lifecycle_status = 'stale'
        WHERE id IN (p_source_id, p_target_id);
    END IF;

    INSERT INTO cerefox_audit_log (document_id, operation, author, author_type, description)
    VALUES (p_source_id, 'relation-set', p_author, p_author_type,
            format('%s → %s (%s)', p_source_id, p_target_id, btrim(p_rel_type)));

    RETURN QUERY SELECT v_id, p_source_id, p_target_id, btrim(p_rel_type), v_symmetric;
END;
$$;

-- Remove a relation. Symmetric types remove both directions. Lifecycle side
-- effects are NOT auto-reverted: a document marked superseded may have been
-- superseded by something else too, and guessing wrong is worse than leaving
-- the operator to set it explicitly.
CREATE OR REPLACE FUNCTION cerefox_delete_relation(
    p_source_id   UUID,
    p_target_id   UUID,
    p_rel_type    TEXT,
    p_author      TEXT DEFAULT 'unknown',
    p_author_type TEXT DEFAULT 'agent'
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_deleted INT := 0;
    v_n       INT;
BEGIN
    DELETE FROM cerefox_document_relations
    WHERE source_id = p_source_id AND target_id = p_target_id
      AND rel_type = btrim(p_rel_type);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted + v_n;

    IF cerefox_relation_is_symmetric(p_rel_type) THEN
        DELETE FROM cerefox_document_relations
        WHERE source_id = p_target_id AND target_id = p_source_id
          AND rel_type = btrim(p_rel_type);
        GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted + v_n;
    END IF;

    IF v_deleted > 0 THEN
        INSERT INTO cerefox_audit_log (document_id, operation, author, author_type, description)
        VALUES (p_source_id, 'relation-delete', p_author, p_author_type,
                format('%s → %s (%s)', p_source_id, p_target_id, btrim(p_rel_type)));
    END IF;
    RETURN v_deleted;
END;
$$;

-- All edges touching a document, in both directions. `direction` tells the
-- caller which way each edge points relative to the document asked about.
CREATE OR REPLACE FUNCTION cerefox_get_relations(p_document_id UUID)
RETURNS TABLE (
    relation_id      UUID,
    direction        TEXT,
    rel_type         TEXT,
    other_id         UUID,
    other_title      TEXT,
    other_lifecycle  TEXT,
    metadata         JSONB,
    author           TEXT,
    created_at       TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
    SELECT r.id, 'outbound'::TEXT, r.rel_type, r.target_id, d.title,
           d.lifecycle_status, r.metadata, r.author, r.created_at
    FROM cerefox_document_relations r
    JOIN cerefox_documents d ON d.id = r.target_id
    WHERE r.source_id = p_document_id AND d.deleted_at IS NULL
    UNION ALL
    SELECT r.id, 'inbound'::TEXT, r.rel_type, r.source_id, d.title,
           d.lifecycle_status, r.metadata, r.author, r.created_at
    FROM cerefox_document_relations r
    JOIN cerefox_documents d ON d.id = r.source_id
    WHERE r.target_id = p_document_id AND d.deleted_at IS NULL
    ORDER BY 3, 9 DESC;
$$;

-- Walk the graph from a document along ONE relation type. Depth > 1 follows
-- chains (meaningful for e.g. `follows` / `reply_to`); a visited-set stops
-- cycles, which free-text types make possible.
CREATE OR REPLACE FUNCTION cerefox_get_neighbors(
    p_document_id UUID,
    p_rel_type    TEXT,
    p_depth       INT DEFAULT 1,
    p_from_time   TIMESTAMPTZ DEFAULT NULL,
    p_to_time     TIMESTAMPTZ DEFAULT NULL,
    p_limit       INT DEFAULT 50
)
RETURNS TABLE (
    document_id     UUID,
    title           TEXT,
    lifecycle_status TEXT,
    depth           INT,
    direction       TEXT,
    doc_created_at  TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
    WITH RECURSIVE walk AS (
        SELECT p_document_id AS id, 0 AS depth, 'self'::TEXT AS direction,
               ARRAY[p_document_id] AS seen
        UNION ALL
        SELECT nxt.id, w.depth + 1, nxt.direction, w.seen || nxt.id
        FROM walk w
        CROSS JOIN LATERAL (
            SELECT r.target_id AS id, 'outbound'::TEXT AS direction
            FROM cerefox_document_relations r
            WHERE r.source_id = w.id AND r.rel_type = btrim(p_rel_type)
            UNION ALL
            SELECT r.source_id, 'inbound'::TEXT
            FROM cerefox_document_relations r
            WHERE r.target_id = w.id AND r.rel_type = btrim(p_rel_type)
        ) nxt
        WHERE w.depth < GREATEST(p_depth, 1)
          AND NOT (nxt.id = ANY(w.seen))   -- cycle guard
    )
    SELECT DISTINCT ON (w.id)
           w.id, d.title, d.lifecycle_status, w.depth, w.direction, d.created_at
    FROM walk w
    JOIN cerefox_documents d ON d.id = w.id
    WHERE w.depth > 0
      AND d.deleted_at IS NULL
      AND (p_from_time IS NULL OR d.created_at >= p_from_time)
      AND (p_to_time   IS NULL OR d.created_at <= p_to_time)
    ORDER BY w.id, w.depth
    LIMIT GREATEST(p_limit, 1);
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

-- Numeric config reader with a fallback (v1.1.0, #133). Returns p_fallback
-- when the key is unset or unparseable, so a malformed row can never break
-- search — it just reverts to the built-in default.
CREATE OR REPLACE FUNCTION cerefox_config_float(p_key TEXT, p_fallback FLOAT)
RETURNS FLOAT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_raw TEXT;
    v_num FLOAT;
BEGIN
    SELECT value INTO v_raw FROM cerefox_config WHERE key = p_key;
    IF v_raw IS NULL OR v_raw = '' THEN RETURN p_fallback; END IF;
    BEGIN
        v_num := v_raw::FLOAT;
    EXCEPTION WHEN others THEN
        RETURN p_fallback;
    END;
    RETURN v_num;
END;
$$;

-- Integer/boolean companions to cerefox_config_float. Same contract: fall back
-- to the caller's default when the key is unset or unparseable, so a malformed
-- row can never break a write path.
CREATE OR REPLACE FUNCTION cerefox_config_int(p_key TEXT, p_fallback INT)
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_raw TEXT;
BEGIN
    SELECT value INTO v_raw FROM cerefox_config WHERE key = p_key;
    IF v_raw IS NULL OR btrim(v_raw) = '' THEN RETURN p_fallback; END IF;
    RETURN v_raw::INT;
EXCEPTION WHEN others THEN
    RETURN p_fallback;
END;
$$;

CREATE OR REPLACE FUNCTION cerefox_config_bool(p_key TEXT, p_fallback BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_raw TEXT;
BEGIN
    SELECT value INTO v_raw FROM cerefox_config WHERE key = p_key;
    IF v_raw IS NULL OR btrim(v_raw) = '' THEN RETURN p_fallback; END IF;
    RETURN lower(btrim(v_raw)) = 'true';
END;
$$;

CREATE OR REPLACE FUNCTION cerefox_set_config(p_key TEXT, p_value TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    -- Retrieval tunables (#133) join the governance keys: setting one here
    -- governs EVERY access path (CLI, local + remote MCP, Edge Functions, web),
    -- because they all resolve through these RPCs.
    v_allowed TEXT[] := ARRAY[
        'usage_tracking_enabled', 'require_requestor_identity', 'requestor_identity_format',
        'min_search_score', 'min_term_coverage', 'search_alpha',
        -- Version retention: a property of the STORE, not of whichever client
        -- happens to write. Previously passed per-call from client env, so the
        -- surviving history depended on who saved last.
        'version_retention_hours', 'version_cleanup_enabled',
        -- Optional features, off by default (iteration 29).
        'relations_enabled'
    ];
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

-- ─────────────────────────────────────────────────────────────────────────
-- Schema version reporter
-- ─────────────────────────────────────────────────────────────────────────
-- Returns the schema version currently deployed in this database. The value
-- must match the `@version` marker at the top of schema.sql.
-- Bump both when schema.sql or rpcs.sql changes in a way that requires a
-- redeploy. The web UI's /api/v1/schema-version endpoint compares the bundled
-- and deployed values and surfaces a 'redeploy needed' banner on mismatch.

CREATE OR REPLACE FUNCTION cerefox_schema_version()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    -- Keep in lockstep with the `@version:` marker in schema.sql (cut_release.ts
    -- enforces it). Bump whenever schema.sql OR rpcs.sql changes.
    SELECT '0.11.0'::TEXT;
$$;

-- ── cerefox_content_format_stats ─────────────────────────────────────────────
-- Counts how many (non-deleted) documents still use the legacy chunk
-- reconstruction format (content_format = 1) vs the total. Powers the
-- informational `cerefox doctor` line. See docs/guides/content-format.md.
CREATE OR REPLACE FUNCTION cerefox_content_format_stats()
RETURNS TABLE (legacy_docs INT, total_docs INT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    SELECT
        COUNT(*) FILTER (WHERE cf.min_format < 2)::INT AS legacy_docs,
        COUNT(*)::INT                                  AS total_docs
    FROM cerefox_documents d
    LEFT JOIN LATERAL (
        SELECT MIN(c.content_format) AS min_format
        FROM cerefox_chunks c
        WHERE c.document_id = d.id AND c.version_id IS NULL
    ) cf ON TRUE
    WHERE d.deleted_at IS NULL;
$$;



-- ─────────────────────────────────────────────────────────────────────────
-- Function-existence probe (introspection helper)
-- ─────────────────────────────────────────────────────────────────────────
-- Returns TRUE if a function with the given name exists in the public schema,
-- regardless of its signature. Used by `db_status.ts` and `cerefox doctor`
-- (v0.5) to verify schema health without having to know the parameter list
-- of every RPC. Cheaper and more reliable than calling each RPC and parsing
-- the error message.

CREATE OR REPLACE FUNCTION cerefox_pg_function_exists(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.proname = p_name
    );
$$;



-- ─────────────────────────────────────────────────────────────────────────
-- Corpus totals (dashboard aggregates)
-- ─────────────────────────────────────────────────────────────────────────
-- Cheap global aggregates for the dashboard stat strip: total current chunks
-- (version_id IS NULL, on non-deleted documents) and total characters across
-- active documents. SUM cannot be expressed over the Data API, so it lives
-- here as a single STABLE function the /dashboard route calls once.

CREATE OR REPLACE FUNCTION cerefox_corpus_totals()
RETURNS TABLE (total_chunks BIGINT, total_chars BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    SELECT
        (SELECT COUNT(*)
           FROM cerefox_chunks c
           JOIN cerefox_documents d ON d.id = c.document_id
          WHERE c.version_id IS NULL
            AND d.deleted_at IS NULL)::BIGINT AS total_chunks,
        (SELECT COALESCE(SUM(total_chars), 0)
           FROM cerefox_documents
          WHERE deleted_at IS NULL)::BIGINT AS total_chars;
$$;



-- ─────────────────────────────────────────────────────────────────────────
-- Recent-doc authors (dashboard "Author" column)
-- ─────────────────────────────────────────────────────────────────────────
-- The latest audit author (+ type) per document, for the given doc ids.
-- "Latest editor" — used by the /dashboard recent-docs list so the Author
-- column can show who last touched a doc (agent vs human). Read-only.

CREATE OR REPLACE FUNCTION cerefox_recent_doc_authors(p_doc_ids UUID[])
RETURNS TABLE (document_id UUID, author TEXT, author_type TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    SELECT DISTINCT ON (a.document_id)
        a.document_id, a.author, a.author_type
    FROM cerefox_audit_log a
    WHERE a.document_id = ANY(p_doc_ids)
    ORDER BY a.document_id, a.created_at DESC;
$$;

-- ── Function privilege lockdown (schema 0.7.0) ────────────────────────────────
-- SECURITY (critical): every cerefox_* RPC is SECURITY DEFINER, so it bypasses the
-- Row Level Security enabled on the tables. PostgreSQL grants EXECUTE to PUBLIC by
-- default, and Supabase's PostgREST exposes public-schema functions at
-- /rest/v1/rpc/<name>. WITHOUT this block, the anon key (and the new sb_publishable_
-- key, which maps to the same anon role) could call every RPC directly via the Data
-- API — reading and writing the entire KB, bypassing BOTH the Edge Functions and
-- RLS. Every legitimate caller uses the service_role key instead (Edge Functions via
-- SUPABASE_SERVICE_ROLE_KEY; the CLI/web via the secret key; local World B via a
-- container-minted service_role JWT), so we REVOKE EXECUTE from PUBLIC/anon/
-- authenticated and GRANT only to service_role.
--
-- Applied over ALL cerefox_* functions (so new functions are covered on the next
-- deploy) and idempotent — re-applied each time rpcs.sql is deployed. Guarded on
-- role existence so it is safe on non-Supabase Postgres (e.g. World B bootstrap).
DO $$
DECLARE
  fn regprocedure;
  r  text;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'cerefox\_%'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', fn, r);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;
END $$;
