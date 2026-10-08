-- 0034_drop_vector_indexes.sql — drop the unused HNSW vector indexes (schema
-- 0.19.0, release 1.18.0).
--
-- Since 0.18.1 the hybrid search RPCs rank vector candidates by an exact scan
-- (`ORDER BY vec_score DESC`, see cerefox_hybrid_search in rpcs.sql), because
-- the HNSW index answered the bare-distance ordering with at most
-- `hnsw.ef_search` (40) rows, and on a store with heavy version churn those
-- were mostly not the nearest ones. The two indexes have served no query since,
-- while every chunk write still paid to maintain them and their quality kept
-- degrading.
--
-- The exact scan is fast at knowledge-base scale: measured on a 1-CPU / 1 GB
-- Postgres with 768-dim vectors, top-500 candidates took 2 ms at 2k chunks,
-- 56 ms at 50k and 181 ms at 100k. A default-configured HNSW index was slower
-- than that from 50k chunks and recalled 27% of the true top-250 at 100k.
-- `cerefox doctor` reports the current chunk count and warns past 100k; a
-- tuned index path for stores that large is tracked separately.
--
-- Idempotent: safe to re-run.

DROP INDEX IF EXISTS idx_cerefox_chunks_emb_primary;
DROP INDEX IF EXISTS idx_cerefox_chunks_emb_upgrade;
