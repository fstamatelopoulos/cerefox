-- Migration 0030 — cerefox_rename_document (schema 0.15.0, iteration 39)
--
-- Title renames become atomic: row update + chunk-FTS refresh (title
-- boosting) + audit entry in one transaction. Replaces client-side
-- sequencing that could commit the rename, fail the FTS refresh, and leave
-- the document ranking under its old title with no retry path. The web
-- editor had additionally NEVER refreshed FTS on rename (since iter-24E).
--
-- Body carried verbatim from rpcs.sql (repair-path closure, as 0027-0029),
-- plus the standard ACL lockdown. Re-runnable.

CREATE OR REPLACE FUNCTION cerefox_rename_document(
    p_document_id UUID,
    p_new_title   TEXT,
    p_author      TEXT DEFAULT 'unknown',
    p_author_type TEXT DEFAULT 'user'
)
RETURNS TABLE (renamed BOOLEAN, old_title TEXT, new_title TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_old TEXT;
    v_new TEXT := BTRIM(p_new_title);
BEGIN
    IF NULLIF(v_new, '') IS NULL THEN
        RAISE EXCEPTION 'Title cannot be empty' USING ERRCODE = '22023';
    END IF;

    SELECT d.title INTO v_old
    FROM cerefox_documents d
    WHERE d.id = p_document_id AND d.deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Document not found (or in the trash): %', p_document_id
            USING ERRCODE = '22023';
    END IF;

    IF v_old = v_new THEN
        RETURN QUERY SELECT FALSE, v_old, v_old;
        RETURN;
    END IF;

    UPDATE cerefox_documents SET title = v_new, updated_at = NOW()
    WHERE id = p_document_id;

    -- Same transaction: the FTS vectors and the title row can never disagree.
    PERFORM cerefox_update_chunk_fts(p_document_id, v_new);

    PERFORM cerefox_create_audit_entry(
        p_document_id := p_document_id,
        p_operation   := 'update-metadata',
        p_author      := p_author,
        p_author_type := p_author_type,
        p_description := 'Title changed: ''' || v_old || ''' → ''' || v_new || ''''
    );
    RETURN QUERY SELECT TRUE, v_old, v_new;
END;
$$;

DO $$
DECLARE
  r TEXT;
BEGIN
  REVOKE EXECUTE ON FUNCTION cerefox_rename_document(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION cerefox_rename_document(UUID, TEXT, TEXT, TEXT) FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION cerefox_rename_document(UUID, TEXT, TEXT, TEXT) TO service_role;
  END IF;
END $$;

DO $$
BEGIN
    RAISE NOTICE 'Migration 0030: title renames are atomic (row + FTS refresh + audit in one transaction).';
END $$;
