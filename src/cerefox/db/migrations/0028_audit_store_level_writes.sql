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
--   3. Drops the dead V1 RPC cerefox_save_note: a Python-era tool with zero
--      callers since the TS rewrite — no CLI command, MCP tool, Edge
--      Function, web route, or SQL function references it. (Its sibling
--      cerefox_context_expand looked identical but is load-bearing:
--      cerefox_search_docs calls it for small-to-big retrieval, so it stays.)
--
-- Project create/edit/delete write through three new RPCs
-- (cerefox_create_project / cerefox_update_project / cerefox_delete_project)
-- that audit IN-TRANSACTION, exactly like cerefox_set_config — the
-- single-implementation principle applies the moment a write carries a side
-- effect (#219; an earlier draft audited client-side at every call site and
-- review caught two forgotten paths before it ever shipped). This migration
-- carries their bodies too (repair-path closure), plus their ACL lockdown.
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

-- 2b. Lock the new signature down. A freshly CREATEd function gets Postgres'
--     default EXECUTE-to-PUBLIC, and the repo's blanket REVOKE/GRANT loop
--     lives at the bottom of rpcs.sql — which `db_migrate.ts` alone never
--     applies, and which a deploy failing between the migration step and the
--     RPC refresh also misses. Without this, the anon/publishable key could
--     call the one function that WRITES store governance. Same guarded shape
--     as the rpcs.sql block (safe on non-Supabase Postgres).
DO $$
DECLARE
  r TEXT;
BEGIN
  REVOKE EXECUTE ON FUNCTION cerefox_set_config(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION cerefox_set_config(TEXT, TEXT, TEXT, TEXT) FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION cerefox_set_config(TEXT, TEXT, TEXT, TEXT) TO service_role;
  END IF;
END $$;

-- 2c. Project write RPCs (bodies identical to rpcs.sql — extracted, not
--     retyped; an invariant test compares them byte-for-byte) and their
--     lockdown, same rationale as 2b.
DROP FUNCTION IF EXISTS cerefox_create_project(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE FUNCTION cerefox_create_project(
    p_name        TEXT,
    p_description TEXT DEFAULT '',
    p_author      TEXT DEFAULT 'unknown',
    p_author_type TEXT DEFAULT 'user',
    -- 'error'  → explicit creation (CLI/web): duplicate name raises.
    -- 'return' → get-or-create (implicit creation during document
    --            assignment): an existing project is returned untouched and
    --            NOT audited — only an actual create writes an entry.
    p_if_exists   TEXT DEFAULT 'error'
)
RETURNS TABLE (
    project_id          UUID,
    project_name        TEXT,
    project_description TEXT,
    created             BOOLEAN,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_row cerefox_projects%ROWTYPE;
BEGIN
    IF NULLIF(BTRIM(p_name), '') IS NULL THEN
        RAISE EXCEPTION 'Project name is required' USING ERRCODE = '22023';
    END IF;
    IF p_if_exists NOT IN ('error', 'return') THEN
        RAISE EXCEPTION 'p_if_exists must be ''error'' or ''return''' USING ERRCODE = '22023';
    END IF;

    IF p_if_exists = 'return' THEN
        -- Case-insensitive, matching the name resolution the assignment
        -- paths have always used. (A case-colliding pair created directly is
        -- pre-existing behavior: the unique constraint is exact-match; this
        -- resolver returns the first match.)
        SELECT p.* INTO v_row
        FROM cerefox_projects p WHERE lower(p.name) = lower(BTRIM(p_name)) LIMIT 1;
        IF v_row.id IS NOT NULL THEN
            RETURN QUERY SELECT v_row.id, v_row.name, v_row.description, FALSE,
                                v_row.created_at, v_row.updated_at;
            RETURN;
        END IF;
    END IF;

    BEGIN
        INSERT INTO cerefox_projects (name, description)
        VALUES (BTRIM(p_name), COALESCE(p_description, ''))
        RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN
        -- TOCTOU (round 4): a concurrent create won the race between the
        -- resolve above and this insert. In 'return' mode that is exactly
        -- the get-or-create contract — hand back the winner, no audit entry
        -- (this call created nothing). In 'error' mode a duplicate is the
        -- caller's error, exactly as if there had been no race.
        IF p_if_exists = 'return' THEN
            SELECT p.* INTO v_row
            FROM cerefox_projects p WHERE lower(p.name) = lower(BTRIM(p_name)) LIMIT 1;
            IF v_row.id IS NOT NULL THEN
                RETURN QUERY SELECT v_row.id, v_row.name, v_row.description, FALSE,
                                    v_row.created_at, v_row.updated_at;
                RETURN;
            END IF;
        END IF;
        RAISE;
    END;

    PERFORM cerefox_create_audit_entry(
        p_operation   := 'project-create',
        p_author      := p_author,
        p_author_type := p_author_type,
        p_description := 'Project ''' || v_row.name || ''' created'
            || CASE WHEN p_if_exists = 'return'
                    THEN ' implicitly (document assignment)' ELSE '' END
    );
    RETURN QUERY SELECT v_row.id, v_row.name, v_row.description, TRUE,
                        v_row.created_at, v_row.updated_at;
END;
$$;

DROP FUNCTION IF EXISTS cerefox_update_project(UUID, TEXT, TEXT, TEXT, TEXT);

CREATE FUNCTION cerefox_update_project(
    p_project_id  UUID,
    -- NULL = keep the current value (the #191/#204 "NULL means not provided"
    -- convention). An explicit empty name is rejected.
    p_name        TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_author      TEXT DEFAULT 'unknown',
    p_author_type TEXT DEFAULT 'user'
)
RETURNS TABLE (
    project_id          UUID,
    project_name        TEXT,
    project_description TEXT,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_old  cerefox_projects%ROWTYPE;
    v_new  cerefox_projects%ROWTYPE;
    v_changes TEXT[] := '{}';
BEGIN
    IF p_name IS NULL AND p_description IS NULL THEN
        RAISE EXCEPTION 'Nothing to update: pass p_name and/or p_description' USING ERRCODE = '22023';
    END IF;
    IF p_name IS NOT NULL AND NULLIF(BTRIM(p_name), '') IS NULL THEN
        RAISE EXCEPTION 'Project name cannot be empty' USING ERRCODE = '22023';
    END IF;

    SELECT p.* INTO v_old FROM cerefox_projects p WHERE p.id = p_project_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project not found: %', p_project_id USING ERRCODE = '22023';
    END IF;

    UPDATE cerefox_projects SET
        name        = COALESCE(BTRIM(p_name), name),
        description = COALESCE(p_description, description),
        updated_at  = NOW()
    WHERE id = p_project_id
    RETURNING * INTO v_new;

    -- The trail records what actually changed, not which arguments arrived.
    IF v_new.name <> v_old.name THEN
        v_changes := v_changes || ('renamed ''' || v_old.name || ''' → ''' || v_new.name || '''');
    END IF;
    IF COALESCE(v_new.description, '') <> COALESCE(v_old.description, '') THEN
        v_changes := v_changes || 'description changed';
    END IF;

    PERFORM cerefox_create_audit_entry(
        p_operation   := 'project-edit',
        p_author      := p_author,
        p_author_type := p_author_type,
        p_description := 'Project ''' || v_new.name || ''' edited ('
            || COALESCE(NULLIF(array_to_string(v_changes, '; '), ''), 'no-op') || ')'
    );
    RETURN QUERY SELECT v_new.id, v_new.name, v_new.description,
                        v_new.created_at, v_new.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION cerefox_delete_project(
    p_project_id  UUID,
    p_author      TEXT DEFAULT 'unknown',
    p_author_type TEXT DEFAULT 'user'
)
RETURNS TABLE (deleted BOOLEAN, project_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_name  TEXT;
    v_links INT;
BEGIN
    -- Lock + read name and link count in one pass: the memberships CASCADE
    -- with the row, so the count must be read pre-DELETE — but the zero-row
    -- path (repeat delete) pays for nothing (round 4).
    SELECT p.name, (SELECT COUNT(*) FROM cerefox_document_projects dp
                    WHERE dp.project_id = p.id)
    INTO v_name, v_links
    FROM cerefox_projects p WHERE p.id = p_project_id FOR UPDATE;

    IF v_name IS NULL THEN
        -- Zero rows: nothing happened, so nothing is audited — the trail
        -- must never assert an event that did not occur. Callers decide
        -- whether "already gone" is an error (CLI) or a 404 (web).
        RETURN QUERY SELECT FALSE, NULL::TEXT;
        RETURN;
    END IF;

    DELETE FROM cerefox_projects WHERE id = p_project_id;

    PERFORM cerefox_create_audit_entry(
        p_operation   := 'project-delete',
        p_author      := p_author,
        p_author_type := p_author_type,
        p_description := 'Project ''' || v_name || ''' deleted ('
            || v_links || ' document link(s) removed)'
    );
    RETURN QUERY SELECT TRUE, v_name;
END;
$$;

DO $$
DECLARE
  fn TEXT;
  r  TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'cerefox_create_project(TEXT, TEXT, TEXT, TEXT, TEXT)',
    'cerefox_update_project(UUID, TEXT, TEXT, TEXT, TEXT)',
    'cerefox_delete_project(UUID, TEXT, TEXT)'
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

-- 3. Dead V1 RPC.
DROP FUNCTION IF EXISTS cerefox_save_note(TEXT, TEXT, TEXT, UUID, JSONB);

DO $$
BEGIN
    RAISE NOTICE
        'Migration 0028: audit trail now covers store-level writes (config-change, project-create/edit/delete). Dropped the retired V1 RPC cerefox_save_note.';
END $$;
