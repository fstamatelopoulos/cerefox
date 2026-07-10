-- Migration 0012: content_format on cerefox_chunks (iter-28D)
--
-- Records how each chunk's content reconstructs into full document text:
--   1 = legacy    — chunk contents were trimmed sections; reconstruction re-joins
--                   them with E'\n\n' (the pre-28D behaviour). All existing chunks.
--   2 = blind-stitch — chunk contents are an exact, gapless partition of the
--                   document; reconstruction is a plain concatenation (no separator
--                   synthesized on read). Written by the exact-partition chunker.
--
-- Placed on the CHUNK (not the document) so an archived version reconstructs with
-- its OWN format, since Cerefox uses chunks-anchored versioning
-- (cerefox_chunks.version_id). The reconstruction RPCs branch on
-- MAX(content_format) >= 2 per aggregated group.
--
-- Adding a NOT NULL column with a constant default is a metadata-only change in
-- PostgreSQL 11+ (no rewrite of the chunks table). Existing rows read back as 1.
-- Explanation for users: docs/guides/content-format.md.

ALTER TABLE cerefox_chunks
    ADD COLUMN IF NOT EXISTS content_format SMALLINT NOT NULL DEFAULT 1;
