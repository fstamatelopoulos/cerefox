-- 0036_metadata_revision.sql — a concurrency token and a history for metadata
-- (schema 0.21.0, #333).
--
-- Optimistic concurrency covered the body only: content_hash does not move on
-- a metadata change, and no metadata write checked a token, so two writers
-- setting the same key, a `replace`, or a content update carrying metadata
-- could silently overwrite another writer's change. Metadata also had no
-- history: content versions never captured it and audit entries recorded only
-- key counts.
--
-- 1. cerefox_documents.metadata_revision: the metadata's own token, bumped by a
--    trigger whenever metadata actually changes (every writer is covered).
-- 2. cerefox_audit_log.metadata_before / metadata_after: written on
--    'update-metadata' entries, so any change can be reconstructed.
--
-- The RPCs that check the token and write the history ship in rpcs.sql.
-- Idempotent: safe to re-run.

ALTER TABLE cerefox_documents
    ADD COLUMN IF NOT EXISTS metadata_revision INT NOT NULL DEFAULT 1;

ALTER TABLE cerefox_audit_log
    ADD COLUMN IF NOT EXISTS metadata_before JSONB,
    ADD COLUMN IF NOT EXISTS metadata_after  JSONB;

CREATE OR REPLACE FUNCTION cerefox_bump_metadata_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    IF NEW.metadata IS DISTINCT FROM OLD.metadata THEN
        NEW.metadata_revision := OLD.metadata_revision + 1;
    ELSE
        NEW.metadata_revision := OLD.metadata_revision;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trig_cerefox_documents_metadata_revision
    BEFORE UPDATE ON cerefox_documents
    FOR EACH ROW EXECUTE FUNCTION cerefox_bump_metadata_revision();
