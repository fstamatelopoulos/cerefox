-- Migration 0028 — store-level writes join the audit trail (schema 0.14.0)
--
-- WHY (canonical rationale — other docs reference this header):
--
-- The audit log covered every *document* write but nothing store-level, so the
-- two questions that motivated this release were unanswerable from the trail:
-- "who changed this config value, and when?" (cerefox_config has no
-- timestamps) and "when was this project created/renamed/removed?" (#147).
-- Both are governance decisions of exactly the kind an append-only trail
-- exists to answer.
--
-- This migration:
--   1. Extends the cerefox_audit_log.operation allow-list with the four
--      store-level operations: 'config-change', 'project-create',
--      'project-edit', 'project-delete'. These entries carry document_id NULL
--      — the same shape as rows a purge cascade orphans, so every existing
--      reader (CLI, web, EF) already tolerates them.
--   2. Replaces cerefox_set_config with the 4-arg auditing version and DROPs
--      the old 2-arg signature (CREATE OR REPLACE never removes a grown-out
--      overload; a survivor makes named PostgREST calls ambiguous — PGRST203,
--      the v1.7.0 purge/restore lesson). The full new body ships INSIDE this
--      migration so neither `db_migrate.ts` alone nor a deploy that fails
--      between the migration step and the RPC refresh can leave the old,
--      non-auditing function behind while 0028 is stamped applied (same
--      repair-path closure as 0027).
--   3. Drops the dead V1 RPCs cerefox_save_note and cerefox_context_expand:
--      Python-era tools with zero callers since the TS rewrite, never exposed
--      by any CLI command, MCP tool, Edge Function, or web route.
--
-- Project create/edit/delete audit entries are written client-side by the
-- callers (project CRUD is plain table access with no RPC); this migration
-- only has to let those operation values through the CHECK.
--
-- Re-runnable: every statement is guarded or idempotent.

-- 1. Operation allow-list. Constraint swap is atomic within the migration's
--    transaction; the list must stay in lockstep with schema.sql.
ALTER TABLE cerefox_audit_log
    DROP CONSTRAINT IF EXISTS cerefox_audit_log_operation_check;
ALTER TABLE cerefox_audit_log
    ADD CONSTRAINT cerefox_audit_log_operation_check CHECK (
        operation IN ('create', 'update-content', 'update-metadata', 'delete',
                      'status-change', 'archive', 'unarchive', 'restore',
                      'relation-set', 'relation-delete',
                      'insert', 'replace-section', 'delete-section',
                      'rename-section',
                      'config-change', 'project-create', 'project-edit',
                      'project-delete')
    );

-- 2. Auditing cerefox_set_config (and the old signature's removal).
DROP FUNCTION IF EXISTS cerefox_set_config(TEXT, TEXT);

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

-- 3. Dead V1 RPCs.
DROP FUNCTION IF EXISTS cerefox_save_note(TEXT, TEXT, TEXT, UUID, JSONB);
DROP FUNCTION IF EXISTS cerefox_context_expand(UUID[], INT);

DO $$
BEGIN
    RAISE NOTICE
        'Migration 0028: audit trail now covers store-level writes (config-change, project-create/edit/delete). Dropped retired V1 RPCs cerefox_save_note and cerefox_context_expand.';
END $$;
