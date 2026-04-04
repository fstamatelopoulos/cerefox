-- Migration 0011: Title Boosting for FTS and Semantic Search
--
-- Changes the fts column on cerefox_chunks from GENERATED ALWAYS AS to a
-- regular tsvector column. This allows the document title (from
-- cerefox_documents) to be included at weight A in the FTS index, which
-- is impossible with a GENERATED column (cannot reference other tables).
--
-- After this migration, fts is set by the ingestion pipeline:
--   setweight(to_tsvector('english', doc_title),   'A')  -- document title
--   || setweight(to_tsvector('english', chunk_title), 'A')  -- heading title
--   || setweight(to_tsvector('english', content),    'B')  -- body content
--
-- The cerefox_ingest_document RPC computes this automatically for all new
-- or updated documents. The cerefox_update_chunk_fts RPC handles the
-- title-change path (title changed but content unchanged).
--
-- Existing chunks retain their old tsvectors (computed without doc title).
-- New ingestion automatically uses the new formula. Running
-- scripts/reindex_all.py updates all existing chunks (optional but
-- recommended for complete title-boosted search coverage).
--
-- Applied by: uv run python scripts/db_migrate.py

-- Step 1: Drop the GENERATED expression on fts.
-- The column stays as a regular tsvector; existing values are preserved.
ALTER TABLE cerefox_chunks ALTER COLUMN fts DROP EXPRESSION;

-- Step 2: Add cerefox_update_chunk_fts RPC.
-- Called when a document title changes (content unchanged) to refresh the
-- FTS index for all current chunks without creating a version snapshot.
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
