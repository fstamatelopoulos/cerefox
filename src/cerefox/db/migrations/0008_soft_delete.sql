-- Migration 0008: Soft delete for documents
--
-- Adds deleted_at column to cerefox_documents. "Delete" sets the timestamp
-- instead of cascade-deleting. Search indexes exclude soft-deleted docs.
-- A separate "purge" operation does the real cascade delete.
-- Recovery is just clearing the deleted_at timestamp.

-- 1. Add deleted_at column (nullable, default NULL = not deleted)
ALTER TABLE cerefox_documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- 1b. Add 'restore' to the audit log operation CHECK constraint
ALTER TABLE cerefox_audit_log DROP CONSTRAINT IF EXISTS cerefox_audit_log_operation_check;
ALTER TABLE cerefox_audit_log ADD CONSTRAINT cerefox_audit_log_operation_check CHECK (
    operation IN ('create', 'update-content', 'update-metadata', 'delete',
                  'status-change', 'archive', 'unarchive', 'restore')
);

-- 2. Index for finding soft-deleted documents efficiently
CREATE INDEX IF NOT EXISTS idx_documents_deleted_at
    ON cerefox_documents (deleted_at) WHERE deleted_at IS NOT NULL;

-- 3. Update cerefox_delete_document to soft-delete instead of cascade-delete.
-- The old RPC did: audit entry + CASCADE DELETE.
-- The new RPC does: audit entry + SET deleted_at = NOW().
-- Drop the old signature first (it takes different params across versions).

DROP FUNCTION IF EXISTS cerefox_delete_document(UUID);

CREATE OR REPLACE FUNCTION cerefox_delete_document(
    p_document_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_title TEXT;
    v_total_chars INT;
BEGIN
    -- Get document info for audit entry
    SELECT title, total_chars INTO v_title, v_total_chars
    FROM cerefox_documents WHERE id = p_document_id;

    IF v_title IS NULL THEN
        RETURN;  -- Document doesn't exist
    END IF;

    -- Soft delete: set deleted_at timestamp
    UPDATE cerefox_documents SET deleted_at = NOW() WHERE id = p_document_id;

    -- Audit entry
    INSERT INTO cerefox_audit_log (
        document_id, operation, author, author_type,
        size_before, size_after, description
    ) VALUES (
        p_document_id, 'delete', 'unknown', 'user',
        v_total_chars, 0,
        format('Soft-deleted document: %s (%s chars)', v_title, v_total_chars)
    );
END;
$$;

-- 4. New RPC: restore a soft-deleted document
CREATE OR REPLACE FUNCTION cerefox_restore_document(
    p_document_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_title TEXT;
    v_total_chars INT;
BEGIN
    SELECT title, total_chars INTO v_title, v_total_chars
    FROM cerefox_documents WHERE id = p_document_id AND deleted_at IS NOT NULL;

    IF v_title IS NULL THEN
        RETURN;  -- Not found or not deleted
    END IF;

    UPDATE cerefox_documents SET deleted_at = NULL WHERE id = p_document_id;

    INSERT INTO cerefox_audit_log (
        document_id, operation, author, author_type,
        size_before, size_after, description
    ) VALUES (
        p_document_id, 'restore', 'unknown', 'user',
        0, v_total_chars,
        format('Restored document: %s', v_title)
    );
END;
$$;

-- 5. New RPC: permanently purge a soft-deleted document
CREATE OR REPLACE FUNCTION cerefox_purge_document(
    p_document_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_title TEXT;
    v_total_chars INT;
BEGIN
    SELECT title, total_chars INTO v_title, v_total_chars
    FROM cerefox_documents WHERE id = p_document_id AND deleted_at IS NOT NULL;

    IF v_title IS NULL THEN
        RETURN;  -- Not found or not soft-deleted (can only purge soft-deleted docs)
    END IF;

    -- Audit entry BEFORE delete (FK will SET NULL on the audit entry's document_id)
    INSERT INTO cerefox_audit_log (
        document_id, operation, author, author_type,
        size_before, size_after, description
    ) VALUES (
        p_document_id, 'delete', 'unknown', 'user',
        v_total_chars, 0,
        format('Permanently deleted document: %s (%s chars)', v_title, v_total_chars)
    );

    -- Real cascade delete
    DELETE FROM cerefox_documents WHERE id = p_document_id;
END;
$$;
