-- 0027_drop_archived_search_artifacts.sql — archived chunks carry no search
-- artifacts (#216). THE CANONICAL RATIONALE LIVES HERE; code comments
-- reference it.
--
-- Search is current-chunks-only by design (every search index is partial on
-- version_id IS NULL), version reconstruction and diffs read `content`, and
-- restoring an old version is deliberately manual re-ingest (which
-- re-embeds). Embeddings and fts on archived chunks were therefore never
-- readable by anything — pure storage cost, measured at ~30-45% of the chunk
-- relation on long-lived stores — and after a reindex they are stale for the
-- current embedder besides. There is no config and no maintenance command:
-- with nothing able to read the artifacts, this is an invariant, not a
-- policy. The archived content — the actual safety copy — is untouched.
--
-- Four parts:
--   1. embedding_primary becomes nullable, WITH a replacement guard: a CHECK
--      that a CURRENT chunk always carries an embedding. Without it, a short
--      embedding-API response could insert a silently search-invisible chunk
--      where the old NOT NULL failed loudly (review round 6).
--   2. The NEW cerefox_snapshot_version ships INSIDE this migration (repo
--      precedent: 0005-0008, 0011, 0025 carry function bodies). This closes
--      two windows where the OLD snapshot could keep archiving WITH
--      artifacts after 0027 was stamped: `bun scripts/db_migrate.ts` (which
--      never refreshes rpcs.sql), and a `server deploy` that failed between
--      the migration step and the RPC refresh.
--   3. Back-fill: strip artifacts from existing archived rows, reporting
--      rows and bytes. embedder_upgrade is nulled with its vector;
--      embedder_primary is deliberately kept (NOT NULL, harmless provenance).
--   4. Space note: Postgres frees the bytes for REUSE via autovacuum rather
--      than shrinking files immediately — growth stops even if the reported
--      database size does not drop the same day.
--
-- Schema version 0.12.2 → 0.13.0.

ALTER TABLE cerefox_chunks ALTER COLUMN embedding_primary DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'cerefox_chunks_current_has_embedding'
    ) THEN
        ALTER TABLE cerefox_chunks
            ADD CONSTRAINT cerefox_chunks_current_has_embedding
            CHECK (version_id IS NOT NULL OR embedding_primary IS NOT NULL);
    END IF;
END $$;

-- The new snapshot (identical to the rpcs.sql copy this release ships):

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

    -- Archive all current chunks by pointing them at the new version, and
    -- NULL their search artifacts in the same write (0.13.0, #216 — full
    -- rationale in migration 0027). The content — the actual safety copy —
    -- is untouched. embedder_upgrade is nulled with its vector;
    -- embedder_primary is deliberately KEPT (it is NOT NULL, and the label
    -- is harmless provenance for a vector that no longer exists — nothing
    -- reads embedder columns without a version_id IS NULL filter).
    UPDATE cerefox_chunks c
    SET version_id = v_version_id,
        embedding_primary = NULL,
        embedding_upgrade = NULL,
        embedder_upgrade = NULL,
        fts = NULL
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

DO $$
DECLARE
    v_rows  INT;
    v_bytes BIGINT;
BEGIN
    SELECT count(*),
           COALESCE(SUM(COALESCE(pg_column_size(embedding_primary), 0))
                  + SUM(COALESCE(pg_column_size(embedding_upgrade), 0))
                  + SUM(COALESCE(pg_column_size(fts), 0)), 0)
    INTO v_rows, v_bytes
    FROM cerefox_chunks
    WHERE version_id IS NOT NULL
      AND (embedding_primary IS NOT NULL OR embedding_upgrade IS NOT NULL OR fts IS NOT NULL);

    UPDATE cerefox_chunks
    SET embedding_primary = NULL,
        embedding_upgrade = NULL,
        embedder_upgrade = NULL,
        fts = NULL
    WHERE version_id IS NOT NULL
      AND (embedding_primary IS NOT NULL OR embedding_upgrade IS NOT NULL OR fts IS NOT NULL);

    RAISE NOTICE
        'Migration 0027: stripped search artifacts from % archived chunk row(s), freeing ~% for reuse. Archived content is untouched; current chunks keep their embeddings.',
        v_rows, pg_size_pretty(v_bytes);
END $$;
