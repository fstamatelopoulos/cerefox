-- Migration 0029 — fix cerefox_update_project's description-change audit
-- (schema 0.14.1)
--
-- v1.9.0's cerefox_update_project appended the audit-diff fragment with
-- `v_changes || 'description changed'`; Postgres resolves the untyped
-- literal via the array||array overload and raises `malformed array
-- literal`, rolling back EVERY project edit that changes a description
-- (rename-only edits worked — their concatenation is typed TEXT). Found
-- live in the v1.9.0 staging dress rehearsal before any production
-- deployment. The fix is array_append on both branches.
--
-- The full corrected body ships inside this migration (repair-path closure,
-- as 0027/0028), plus the same ACL lockdown 0028 gave the original.
-- Re-runnable.

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
    -- array_append, NOT `||`: with an untyped string literal on the right,
    -- `TEXT[] || 'literal'` resolves to the array||array overload and dies
    -- with `malformed array literal` — found LIVE on staging (v1.9.0; every
    -- description-only edit failed; the rename branch only survived because
    -- its parenthesized concatenation is typed TEXT).
    IF v_new.name <> v_old.name THEN
        v_changes := array_append(v_changes, 'renamed ''' || v_old.name || ''' → ''' || v_new.name || '''');
    END IF;
    IF COALESCE(v_new.description, '') <> COALESCE(v_old.description, '') THEN
        v_changes := array_append(v_changes, 'description changed');
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

DO $$
DECLARE
  r TEXT;
BEGIN
  REVOKE EXECUTE ON FUNCTION cerefox_update_project(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION cerefox_update_project(UUID, TEXT, TEXT, TEXT, TEXT) FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION cerefox_update_project(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
  END IF;
END $$;

DO $$
BEGIN
    RAISE NOTICE 'Migration 0029: fixed the project-edit description audit (array_append; description-only edits no longer fail).';
END $$;
