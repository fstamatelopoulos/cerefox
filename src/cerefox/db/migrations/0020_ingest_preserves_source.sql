-- 0020_ingest_preserves_source.sql — stop content updates from silently
-- overwriting a document's provenance (#191, reported by @tdebasis).
--
-- `cerefox_ingest_document`'s UPDATE branch assigned the source column
-- unconditionally:
--
--     source      = p_source                              -- unconditional
--     source_path = COALESCE(p_source_path, source_path)  -- preserved
--     metadata    = COALESCE(p_metadata, metadata)        -- preserved
--
-- with `p_source TEXT DEFAULT 'agent'` in the signature. The two columns either
-- side of it already implement the "absent means keep" rule — metadata got it in
-- v0.11.1, after content updates without metadata were found to be wiping tags.
-- source was left out of that fix.
--
-- Two consequences, both silent:
--
--   * Any caller that updates a document without passing p_source rewrites that
--     document's source to the parameter default 'agent'. Nothing in the RPC's
--     output, the audit entry, or the version row records that it happened: the
--     audit operation is 'update-content', and version rows carry their own
--     source label rather than the document's prior value.
--   * `cerefox server migrate-format` hit this at corpus scale. It hardcoded
--     source: "migrate-format" for every document it converted, even though it
--     reads each document first and cerefox_get_document returns doc_source. A
--     format conversion is not a change of origin, so every converted document
--     lost the label it came in with.
--
-- Reported impact on one store: 1,317 documents rewritten to 'migrate-format' in
-- a single run, 201 of which carried no metadata.source_agent and so had no
-- other provenance field to fall back on. A second store on the same instance
-- independently reported 509 of 553. Recovery required a point-in-time dump from
-- before the run.
--
-- Fix: p_source defaults to NULL and the UPDATE branch coalesces, matching
-- metadata and source_path exactly. The CREATE path keeps 'agent' as its
-- concrete fallback via COALESCE(p_source, 'agent'), so new documents are
-- unchanged. An explicit value still relabels, so deliberate callers are
-- unaffected.
--
-- Note the distinction this preserves: p_source is the document's origin, while
-- p_source_label records how a particular write was triggered and is stored on
-- the version row. migrate-format now passes the document's own source for the
-- former and keeps "migrate-format" for the latter, so the version history still
-- shows which run performed the conversion.
--
-- Lives in rpcs.sql, which `cerefox server deploy` re-applies. This migration
-- exists so the schema version moves and operators are told to redeploy.
--
-- Idempotent: safe to re-run.

DO $$
BEGIN
    RAISE NOTICE
        'Migration 0020: cerefox_ingest_document now preserves a document''s '
        'source when p_source is omitted. Before this, any content update '
        'without an explicit source silently rewrote provenance to ''agent'', '
        'and migrate-format relabelled every document it converted (#191).';
END $$;
