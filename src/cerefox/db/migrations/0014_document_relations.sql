-- 0014_document_relations.sql — typed edges between documents (iteration 29).
--
-- Adds the relation graph on top of the existing document model:
--   * cerefox_document_relations — typed, directed edges (source → target)
--   * cerefox_documents.lifecycle_status — 'active' | 'superseded' | 'stale' | 'archived'
--
-- Design: docs/research/document-relations-and-semantic-graph.md §2.2, §3.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS cerefox_document_relations (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id    UUID        NOT NULL REFERENCES cerefox_documents(id) ON DELETE CASCADE,
    target_id    UUID        NOT NULL REFERENCES cerefox_documents(id) ON DELETE CASCADE,
    -- Free-text by design: agents define new types without a migration. The
    -- type dictionary (in the RPCs) gives known types behaviour; unknown types
    -- are stored and returned, just without special handling.
    rel_type     TEXT        NOT NULL,
    metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    author       TEXT        NOT NULL DEFAULT 'unknown',
    author_type  TEXT        NOT NULL DEFAULT 'agent',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- One edge of a given type per ordered pair; different types may coexist.
    UNIQUE (source_id, target_id, rel_type),
    -- A document relating to itself is always a mistake, and self-edges would
    -- make traversal loop.
    CONSTRAINT cerefox_relations_no_self_edge CHECK (source_id <> target_id)
);

CREATE INDEX IF NOT EXISTS idx_cerefox_relations_source ON cerefox_document_relations(source_id);
CREATE INDEX IF NOT EXISTS idx_cerefox_relations_target ON cerefox_document_relations(target_id);
CREATE INDEX IF NOT EXISTS idx_cerefox_relations_type   ON cerefox_document_relations(rel_type);

-- Lifecycle status: how a document stands relative to the rest of the graph.
-- Distinct from review_status (editorial state) and deleted_at (existence).
ALTER TABLE cerefox_documents
    ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_cerefox_docs_lifecycle
    ON cerefox_documents(lifecycle_status)
    WHERE lifecycle_status <> 'active';

-- Data-API grants for the new table (migration 0013 / #26: privileges are
-- explicit now, and a new table gets none by default).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE
            ON TABLE public.cerefox_document_relations TO service_role;
    END IF;
END
$$;

-- Relation writes are auditable operations; widen the audit-log constraint.
ALTER TABLE cerefox_audit_log DROP CONSTRAINT IF EXISTS cerefox_audit_log_operation_check;
ALTER TABLE cerefox_audit_log ADD CONSTRAINT cerefox_audit_log_operation_check CHECK (
    operation IN ('create', 'update-content', 'update-metadata', 'delete',
                  'status-change', 'archive', 'unarchive', 'restore',
                  'relation-set', 'relation-delete')
);
