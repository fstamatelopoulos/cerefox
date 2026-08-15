-- 0027_drop_archived_search_artifacts.sql — archived chunks carry no search
-- artifacts (#216).
--
-- Search is current-chunks-only by design (every search index is partial on
-- version_id IS NULL), version reconstruction and diffs read `content`, and
-- restoring an old version is deliberately manual re-ingest (which
-- re-embeds). Embeddings and fts on archived chunks were therefore never
-- readable by anything — pure storage cost, measured at ~30-45% of the chunk
-- relation on long-lived stores — and after a reindex they are stale for the
-- current embedder besides. cerefox_snapshot_version now nulls them at
-- archive time (ships via rpcs.sql on this deploy); this migration makes
-- embedding_primary nullable and back-fills the invariant onto existing
-- archived rows. There is no config and no maintenance command: with nothing
-- able to read the artifacts, this is an invariant, not a policy.
--
-- Space note: Postgres frees the bytes for REUSE via autovacuum rather than
-- shrinking files immediately — growth stops even if the reported database
-- size does not drop the same day.
--
-- Schema version 0.12.2 → 0.13.0.

ALTER TABLE cerefox_chunks ALTER COLUMN embedding_primary DROP NOT NULL;

DO $$
DECLARE
    v_rows  INT;
    v_bytes BIGINT;
BEGIN
    SELECT count(*),
           COALESCE(SUM(pg_column_size(embedding_primary))
                  + SUM(COALESCE(pg_column_size(embedding_upgrade), 0))
                  + SUM(COALESCE(pg_column_size(fts), 0)), 0)
    INTO v_rows, v_bytes
    FROM cerefox_chunks
    WHERE version_id IS NOT NULL
      AND (embedding_primary IS NOT NULL OR embedding_upgrade IS NOT NULL OR fts IS NOT NULL);

    UPDATE cerefox_chunks
    SET embedding_primary = NULL,
        embedding_upgrade = NULL,
        fts = NULL
    WHERE version_id IS NOT NULL
      AND (embedding_primary IS NOT NULL OR embedding_upgrade IS NOT NULL OR fts IS NOT NULL);

    RAISE NOTICE
        'Migration 0027: stripped search artifacts from % archived chunk row(s), freeing ~% for reuse. Archived content is untouched; current chunks keep their embeddings.',
        v_rows, pg_size_pretty(v_bytes);
END $$;
