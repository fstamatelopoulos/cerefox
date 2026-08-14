-- 0026_metadata_guard_and_dead_links.sql — #212 metadata type guards +
-- #214 phase-2 dead-link sweep.
--
-- RPC changes ship via rpcs.sql on this deploy: cerefox_ingest_document
-- rejects non-object p_metadata (the MCP layer always did; now every write
-- path agrees), cerefox_set_document_metadata refuses to MERGE onto a
-- non-object stored value (|| would produce an array; only replace=true
-- repairs), and two read-only RPCs arrive: cerefox_find_dead_links (whole-KB
-- [Text](uuid) sweep) and cerefox_metadata_health (rows with non-object
-- metadata, surfaced by doctor).
--
-- Schema version 0.12.1 → 0.12.2. This migration also REPORTS (not repairs)
-- any rows already in the non-object state, so the operator sees them at
-- upgrade time; repair is `cerefox document set-metadata <id> --replace`.

DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT count(*) INTO v_count
    FROM cerefox_documents
    WHERE metadata IS NOT NULL AND jsonb_typeof(metadata) <> 'object';
    IF v_count > 0 THEN
        RAISE NOTICE
            'Migration 0026: % document(s) hold NON-OBJECT metadata (legacy #212 state). List them with cerefox doctor (or SELECT * FROM cerefox_metadata_health()); repair each with cerefox document set-metadata <id> --replace --json ''<object>''.',
            v_count;
    ELSE
        RAISE NOTICE 'Migration 0026: metadata guards + dead-link sweep arrive with rpcs.sql. No non-object metadata rows found. Schema 0.12.2.';
    END IF;
END $$;
