-- 0023_set_document_metadata.sql — metadata-only writes (#204).
--
-- Adds cerefox_set_document_metadata. No table DDL: the function itself ships
-- in rpcs.sql, which `cerefox server deploy` re-applies wholesale. This
-- migration exists so the schema version advances in step, which is what tells
-- an existing deployment it needs that redeploy.
--
-- Schema version 0.11.2 → 0.11.3. Purely additive.

DO $$
BEGIN
    RAISE NOTICE
        'Migration 0023: cerefox_set_document_metadata arrives with rpcs.sql on '
        'this deploy — metadata-only writes, merge by default, JSON null removes '
        'a key (RFC 7386). Schema version 0.11.3.';
END $$;
