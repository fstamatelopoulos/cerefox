-- 0024_ingest_requires_object_metadata.sql — metadata must be a JSON object.
--
-- No table DDL: the guard lives inside cerefox_ingest_document, which ships in
-- rpcs.sql and `cerefox server deploy` re-applies wholesale. This migration
-- exists so the schema version advances in step, which is what tells an
-- existing deployment it needs that redeploy.
--
-- Schema version 0.11.3 → 0.11.4. Behaviour change, not purely additive: an
-- ingest whose p_metadata is a JSON string, array or scalar now raises 22023
-- instead of storing a value that every reader treats as an object and that
-- the next metadata edit destroys. NULL is unaffected — it still means "not
-- provided". Existing rows are untouched; this closes the path that creates
-- them rather than repairing what is already stored.
--
-- To find rows already in that state:
--     SELECT id, title FROM cerefox_documents
--      WHERE jsonb_typeof(metadata) <> 'object';
--
-- To repair one, without resending its content:
--     cerefox document set-metadata <id> --replace --json '<the intended object>'
--
-- `--replace` is required. The default merge is `stored || patch`, and
-- Postgres treats a non-object left-hand side as an array, so merging onto a
-- corrupt row yields `[<corrupt value>, {<patch>}]` — still not an object.

DO $$
BEGIN
    RAISE NOTICE
        'Migration 0024: cerefox_ingest_document now refuses non-object metadata '
        '(22023), matching the MCP handler. Existing rows are untouched — find '
        'them with jsonb_typeof(metadata) <> ''object'' and repair with '
        '`cerefox document set-metadata <id> --replace --json ...`. '
        'Schema version 0.11.4.';
END $$;
