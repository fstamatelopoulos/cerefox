-- 0033_trash_auto_purge.sql — opt-in auto-purge of expired trash (#251,
-- schema 0.17.0, iteration 47). Design: docs/specs/trash-auto-purge.md.
--
-- Two config keys, OFF by default on every store (a fresh install gets the
-- same seeds from schema.sql; neither write overrides an operator's value).
-- cerefox_purge_expired_trash is new; cerefox_delete_document calls it after a
-- real soft delete and reports `auto_purged`; cerefox_set_config allows the
-- two keys. All three are also in rpcs.sql, which `cerefox server deploy`
-- re-applies; carried here so `db_migrate` alone leaves the store complete.
--
-- Idempotent: safe to re-run.

INSERT INTO cerefox_config (key, value)
VALUES ('trash_auto_purge_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
INSERT INTO cerefox_config (key, value)
VALUES ('trash_retention_days', '60')
ON CONFLICT (key) DO NOTHING;

-- ── cerefox_purge_expired_trash (#251, 0.17.0) ───────────────────────────────
-- Permanently purges documents that have been in the trash longer than
-- `trash_retention_days`, when `trash_auto_purge_enabled` is exactly 'true'.
-- Called by cerefox_delete_document after every real soft delete: the write
-- that adds to the trash also sweeps it. There is no scheduler, by decision
-- (docs/specs/trash-auto-purge.md): the trash only grows through deletes, so
-- this keeps it bounded on every deployment without pg_cron or a daemon.
--
-- Safeguards, each load-bearing:
--   * at most p_max documents per call, oldest first (partial index on
--     deleted_at), so a large first backlog drains over several deletes;
--   * FOR UPDATE SKIP LOCKED, so concurrent deletes sweep disjoint rows;
--   * an unparsable or < 1 retention purges NOTHING (never "purge everything");
--   * one audit entry per purge, authored 'trash-retention' / 'user': the
--     authority is the operator's setting, not whoever's delete triggered it.
-- Not exposed on MCP, the Edge Functions or the CLI: there is still no
-- agent-callable purge (access-paths.md → trust model).
CREATE OR REPLACE FUNCTION cerefox_purge_expired_trash(
    p_max INT DEFAULT 100
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_enabled  TEXT;
    v_days_txt TEXT;
    v_days     INT;
    v_cutoff   TIMESTAMPTZ;
    v_count    INT := 0;
    r          RECORD;
BEGIN
    SELECT value INTO v_enabled FROM cerefox_config WHERE key = 'trash_auto_purge_enabled';
    IF v_enabled IS DISTINCT FROM 'true' THEN
        RETURN 0;
    END IF;

    SELECT value INTO v_days_txt FROM cerefox_config WHERE key = 'trash_retention_days';
    IF v_days_txt IS NULL OR BTRIM(v_days_txt) !~ '^[0-9]{1,6}$' THEN
        RETURN 0;
    END IF;
    v_days := BTRIM(v_days_txt)::INT;
    IF v_days < 1 THEN
        RETURN 0;
    END IF;
    v_cutoff := NOW() - make_interval(days => v_days);

    FOR r IN
        SELECT id, title, total_chars, deleted_at
        FROM cerefox_documents
        WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff
        ORDER BY deleted_at
        LIMIT GREATEST(COALESCE(p_max, 0), 0)
        FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM cerefox_create_audit_entry(
            p_document_id := r.id,
            p_operation   := 'delete',
            p_author      := 'trash-retention',
            p_author_type := 'user',
            p_size_before := r.total_chars,
            p_size_after  := 0,
            p_description := 'Auto-purged from the trash (trash_retention_days = ' || v_days ||
                             '; trashed ' || to_char(r.deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') ||
                             '): ' || COALESCE(r.title, '(untitled)') ||
                             ' (' || COALESCE(r.total_chars, 0) || ' chars)'
        );
        DELETE FROM cerefox_documents WHERE id = r.id;
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

DROP FUNCTION IF EXISTS cerefox_delete_document(UUID, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS cerefox_delete_document(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS cerefox_delete_document(UUID);
CREATE FUNCTION cerefox_delete_document(
    p_document_id           UUID,
    p_author                TEXT    DEFAULT 'unknown',
    p_author_type           TEXT    DEFAULT 'user',
    p_expected_content_hash TEXT    DEFAULT NULL,
    p_reason                TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_title        TEXT;
    v_total_chars  INT;
    v_current_hash TEXT;
    v_deleted_at   TIMESTAMPTZ;
    v_auto_purged  INT := 0;
BEGIN
    -- FOR UPDATE: makes the hash check atomic with the delete — a concurrent
    -- content update serializes here, and a stale deleter sees its hash.
    SELECT title, total_chars, content_hash, deleted_at
    INTO v_title, v_total_chars, v_current_hash, v_deleted_at
    FROM cerefox_documents WHERE id = p_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Document % not found', p_document_id
            USING ERRCODE = '22023';  -- invalid_parameter_value
    END IF;

    -- Optimistic concurrency: blank is ABSENT, not stale (same rule and same
    -- reason as cerefox_ingest_document — '' can never equal a real hash, so
    -- classifying it as a conflict would be a permanent failure reported as a
    -- resolvable one).
    -- Compare TRIMMED, matching the presence check: a correct hash with a
    -- stray trailing newline must not be misreported as a stale-hash
    -- conflict — that reads as "changed since it was read" with two hashes
    -- that look identical, and re-reading can never fix it.
    -- Validated BEFORE the already-deleted no-op: "a delete proves a read"
    -- has to hold for trashed documents too, or a garbage hash gets reported
    -- as a successful no-op and the caller learns nothing.
    IF NULLIF(BTRIM(p_expected_content_hash), '') IS NOT NULL
       AND BTRIM(p_expected_content_hash) <> v_current_hash THEN
        RAISE EXCEPTION
            'CEREFOX_CONFLICT: document % changed since it was read (expected hash %, current hash %). Re-read the document, check it still warrants deletion, and retry with the new hash.',
            p_document_id, p_expected_content_hash, v_current_hash
            USING ERRCODE = 'PT409';  -- deterministic conflict; see ingest CAS
    END IF;

    IF v_deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'document_id', p_document_id,
            'title', v_title,
            'total_chars', v_total_chars,
            'deleted_at', v_deleted_at,
            'already_deleted', TRUE
        );
    END IF;

    UPDATE cerefox_documents SET deleted_at = NOW()
    WHERE id = p_document_id
    RETURNING deleted_at INTO v_deleted_at;

    PERFORM cerefox_create_audit_entry(
        p_document_id := p_document_id,
        p_operation := 'delete',
        p_author := p_author,
        p_author_type := p_author_type,
        p_size_before := v_total_chars,
        p_size_after := 0,
        p_description := 'Soft-deleted document: ' || COALESCE(v_title, '(untitled)') ||
                         ' (' || COALESCE(v_total_chars, 0) || ' chars)' ||
                         COALESCE('; reason: ' || NULLIF(BTRIM(p_reason), ''), '')
    );

    BEGIN
        v_auto_purged := cerefox_purge_expired_trash(100);
    EXCEPTION WHEN OTHERS THEN
        v_auto_purged := 0;
        RAISE WARNING 'cerefox: trash auto-purge skipped after deleting %: % (%)',
            p_document_id, SQLERRM, SQLSTATE;
    END;

    RETURN jsonb_build_object(
        'document_id', p_document_id,
        'title', v_title,
        'total_chars', v_total_chars,
        'deleted_at', v_deleted_at,
        'already_deleted', FALSE,
        'auto_purged', v_auto_purged
    );
END;
$$;

DROP FUNCTION IF EXISTS cerefox_set_config(TEXT, TEXT);
DROP FUNCTION IF EXISTS cerefox_set_config(TEXT, TEXT, TEXT, TEXT);

CREATE FUNCTION cerefox_set_config(
    p_key         TEXT,
    p_value       TEXT,
    -- 0.14.0: config changes are governance decisions ("who turned retention
    -- off, and when?") and belong in the audit trail like any other write.
    p_author      TEXT DEFAULT 'unknown',
    p_author_type TEXT DEFAULT 'user'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    -- Retrieval tunables (#133) join the governance keys: setting one here
    -- governs EVERY access path (CLI, local + remote MCP, Edge Functions, web),
    -- because they all resolve through these RPCs.
    v_allowed TEXT[] := ARRAY[
        'usage_tracking_enabled', 'require_requestor_identity', 'requestor_identity_format',
        'min_search_score', 'min_term_coverage', 'search_alpha',
        -- Version retention: a property of the STORE, not of whichever client
        -- happens to write. Previously passed per-call from client env, so the
        -- surviving history depended on who saved last.
        'version_retention_hours', 'version_cleanup_enabled',
        -- Optional features, off by default (iteration 29).
        'relations_enabled',
        -- #241: the review workflow. Off on fresh installs, on for stores that
        -- predate the flag. Read by cerefox_ingest_document on every write.
        'review_workflow_enabled',
        -- Iteration 33: flag writes that push a document past this many chars
        -- (0 = off). Partial edits make writes cheap, so an insert-only agent
        -- never assembles the document and never sees it grow past its split
        -- point. A signal in the write's response, never a refusal.
        'document_size_warning_chars',
        -- #251: trash auto-purge, off by default; read by
        -- cerefox_purge_expired_trash on every soft delete.
        'trash_auto_purge_enabled', 'trash_retention_days'
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

    -- Same-transaction audit entry (document_id NULL — a store-level write).
    -- A no-op set (same value) is still recorded: "checked and confirmed" is
    -- itself a governance action, and skipping it would make the trail lie by
    -- omission when someone re-asserts a setting.
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

-- Lock the three functions down. A freshly CREATEd function gets Postgres'
-- default EXECUTE-to-PUBLIC, and the blanket REVOKE/GRANT loop lives at the
-- bottom of rpcs.sql, which `db_migrate.ts` alone never applies (nor does a
-- deploy that fails between the migration and the RPC refresh). Without this
-- the anon/publishable key could soft-delete any document, or trigger a purge.
-- Same guarded shape as 0028 (safe on non-Supabase Postgres).
DO $$
DECLARE
  fn TEXT;
  r  TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'cerefox_purge_expired_trash(INT)',
    'cerefox_delete_document(UUID, TEXT, TEXT, TEXT, TEXT)',
    'cerefox_set_config(TEXT, TEXT, TEXT, TEXT)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', fn, r);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;
END $$;
