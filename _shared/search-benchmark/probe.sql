-- Search-calibration probe (iteration 48). NOT part of the schema: the benchmark
-- runner creates this on a LABELED (non-production) target for one run and drops
-- it afterwards. Read-only.
--
-- Returns, for every current chunk of the documents in one project, the raw
-- signals cerefox_hybrid_search combines, so candidate formulas can be applied
-- client-side over an identical pool:
--   vec_score      1 - cosine distance to the query embedding (primary embedding)
--   in_and/in_or   the chunk matches the AND / the OR-fallback tsquery
--   rank_and/or    raw ts_rank_cd against each (unbounded; the current formula's input)
--   tokens_matched how many of the query's distinct tokens the chunk matches
--   total_tokens   how many distinct tokens the query has
-- Tokenisation mirrors cerefox_hybrid_search exactly (same split, same dedupe).
CREATE OR REPLACE FUNCTION cerefox_bench_signals(
    p_query_text      TEXT,
    p_query_embedding VECTOR(768),
    p_project_id      UUID
)
RETURNS TABLE (
    chunk_id       UUID,
    document_id    UUID,
    vec_score      FLOAT,
    in_and         BOOLEAN,
    in_or          BOOLEAN,
    rank_and       FLOAT,
    rank_or        FLOAT,
    tokens_matched INT,
    total_tokens   INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    q_and       tsquery := plainto_tsquery('english', p_query_text);
    q_or        tsquery := NULL;
    tok         TEXT;
    tok_q       tsquery;
    tok_queries tsquery[] := '{}';
    seen        TEXT[]    := '{}';
BEGIN
    FOR tok IN SELECT unnest(regexp_split_to_array(trim(p_query_text), '\s+')) LOOP
        tok_q := plainto_tsquery('english', tok);
        IF numnode(tok_q) > 0 AND NOT (tok_q::TEXT = ANY(seen)) THEN
            seen := seen || tok_q::TEXT;
            tok_queries := tok_queries || tok_q;
            q_or := CASE WHEN q_or IS NULL THEN tok_q ELSE q_or || tok_q END;
        END IF;
    END LOOP;

    RETURN QUERY
    SELECT
        c.id,
        c.document_id,
        (1.0 - (c.embedding_primary <=> p_query_embedding))::FLOAT,
        (numnode(q_and) > 0 AND c.fts @@ q_and),
        (q_or IS NOT NULL AND c.fts @@ q_or),
        CASE WHEN numnode(q_and) > 0 THEN ts_rank_cd(c.fts, q_and)::FLOAT ELSE 0.0 END,
        CASE WHEN q_or IS NOT NULL THEN ts_rank_cd(c.fts, q_or)::FLOAT ELSE 0.0 END,
        (SELECT COUNT(*)::INT FROM unnest(tok_queries) tq WHERE c.fts @@ tq),
        COALESCE(array_length(tok_queries, 1), 0)
    FROM cerefox_chunks c
    JOIN cerefox_documents d ON d.id = c.document_id
    JOIN cerefox_document_projects dp ON dp.document_id = d.id AND dp.project_id = p_project_id
    WHERE c.version_id IS NULL AND d.deleted_at IS NULL;
END;
$$;
