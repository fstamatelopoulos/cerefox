-- 0031_review_workflow_toggle.sql — make the review workflow optional (#241,
-- schema 0.16.0, iteration 44).
--
-- New config key `review_workflow_enabled`. Fresh installs get 'false' from
-- schema.sql; this migration runs only on stores that predate the flag and
-- seeds 'true' there, so upgrading never changes what a store does. Neither
-- write ever overrides a value an operator has set (ON CONFLICT DO NOTHING).
--
-- The decision "agent write → pending_review" moves out of the six client call
-- sites and into cerefox_ingest_document. That RPC lives in rpcs.sql, which
-- `cerefox server deploy` re-applies. (0.16.0 also had the RPC read this flag
-- on write and store 'approved' for everyone while off; 0.16.1 removed that —
-- the flag governs visibility only, the stored value follows author_type.)
--
-- #240: cerefox_hybrid_search / cerefox_search_docs gain p_review_status so a
-- filtered search is applied before the limit, not after. A new argument is a
-- new overload; the old ones must go or PostgREST calls become ambiguous
-- (PGRST203). Same DROPs sit at the top of rpcs.sql for the fresh path.
--
-- Idempotent: safe to re-run.

INSERT INTO cerefox_config (key, value)
VALUES ('review_workflow_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

DROP FUNCTION IF EXISTS cerefox_hybrid_search(TEXT, VECTOR(768), INT, FLOAT, BOOLEAN, UUID, FLOAT, JSONB, FLOAT);
DROP FUNCTION IF EXISTS cerefox_search_docs(TEXT, VECTOR(768), INT, FLOAT, UUID, FLOAT, INT, INT, JSONB, FLOAT);

-- The allow-list in cerefox_set_config grows by one key. Same signature, so
-- OR REPLACE is enough (no overload to drop). Carried here as well as in
-- rpcs.sql so `db_migrate` alone leaves the key settable; the unit test
-- `rpc-guard-invariants` pins the two lists to each other.
CREATE OR REPLACE FUNCTION cerefox_set_config(
    p_key         TEXT,
    p_value       TEXT,
    p_author      TEXT DEFAULT 'unknown',
    p_author_type TEXT DEFAULT 'user'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_allowed TEXT[] := ARRAY[
        'usage_tracking_enabled', 'require_requestor_identity', 'requestor_identity_format',
        'min_search_score', 'min_term_coverage', 'search_alpha',
        'version_retention_hours', 'version_cleanup_enabled',
        'relations_enabled',
        'review_workflow_enabled',
        'document_size_warning_chars'
    ];
    v_old TEXT;
BEGIN
    IF NOT (p_key = ANY(v_allowed)) THEN
        RAISE EXCEPTION 'Unknown config key: %. Allowed keys: %', p_key, v_allowed;
    END IF;

    SELECT value INTO v_old FROM cerefox_config WHERE key = p_key;

    INSERT INTO cerefox_config (key, value)
    VALUES (p_key, p_value)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

    PERFORM cerefox_create_audit_entry(
        p_operation   := 'config-change',
        p_author      := p_author,
        p_author_type := p_author_type,
        p_description := 'config: ' || p_key || ': '
            || COALESCE('''' || v_old || '''', '(unset)')
            || ' → ''' || p_value || ''''
    );
END;
$$;
