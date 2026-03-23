-- Migration 0004: Add audit log table, review_status column, archived flag
--
-- Adds:
--   1. cerefox_audit_log table (immutable, append-only)
--   2. review_status column on cerefox_documents (approved | pending_review)
--   3. archived boolean on cerefox_document_versions (protection from cleanup)
--   4. Indexes for audit log queries (temporal, author, document, FTS on description)
--   5. RLS on cerefox_audit_log

-- ── 1. Audit log table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cerefox_audit_log (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID        REFERENCES cerefox_documents(id) ON DELETE SET NULL,
    version_id      UUID        REFERENCES cerefox_document_versions(id) ON DELETE SET NULL,
    operation       TEXT        NOT NULL,
    author          TEXT        NOT NULL DEFAULT 'unknown',
    author_type     TEXT        NOT NULL DEFAULT 'user',
    size_before     INT,
    size_after      INT,
    description     TEXT        NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT cerefox_audit_log_operation_check CHECK (
        operation IN ('create', 'update-content', 'update-metadata', 'delete',
                      'status-change', 'archive', 'unarchive')
    ),
    CONSTRAINT cerefox_audit_log_author_type_check CHECK (author_type IN ('user', 'agent'))
);

-- ── 2. Review status on documents ───────────────────────────────────────────

ALTER TABLE cerefox_documents
    ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved';

-- Add check constraint (idempotent: drop if exists, then add)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'cerefox_documents_review_status_check'
    ) THEN
        ALTER TABLE cerefox_documents
            ADD CONSTRAINT cerefox_documents_review_status_check
            CHECK (review_status IN ('approved', 'pending_review'));
    END IF;
END $$;

-- ── 3. Archived flag on versions ────────────────────────────────────────────

ALTER TABLE cerefox_document_versions
    ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 4. Indexes for audit log ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_cerefox_audit_log_created
    ON cerefox_audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cerefox_audit_log_document
    ON cerefox_audit_log(document_id, created_at DESC)
    WHERE document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cerefox_audit_log_author
    ON cerefox_audit_log(author, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cerefox_audit_log_desc_fts
    ON cerefox_audit_log USING GIN(to_tsvector('english', description));

-- ── 5. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE cerefox_audit_log ENABLE ROW LEVEL SECURITY;
