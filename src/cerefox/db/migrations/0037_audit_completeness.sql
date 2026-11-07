-- 0037_audit_completeness.sql — a complete and accurate audit log
-- (schema 0.22.0, iteration 51).
--
-- 1. Audit entries keep their document and version ids forever. The foreign
--    keys were ON DELETE SET NULL, so purging a document cleared the id on its
--    purge entry and on every earlier entry for it, and retention pruning did
--    the same to version ids. Entries already cleared cannot be repaired; their
--    description still names the document.
-- 2. `details` holds structured before/after for operations that are not
--    metadata (project memberships, restore, retention, reindex).
-- 3. `txid` records the writing transaction, so a reader following the log
--    can page without ever skipping an entry that commits late
--    (cerefox_audit_changes in rpcs.sql). Existing entries stay NULL: the
--    column gets its default only after it exists, or every old row would
--    share this migration's transaction id.
-- 4. New operations: 'purge' (a permanent delete was logged as 'delete'),
--    'projects-change', 'backup-restore', 'version-prune', 'reindex'.
--
-- The RPCs that write them ship in rpcs.sql. Idempotent: safe to re-run.

ALTER TABLE cerefox_audit_log
    DROP CONSTRAINT IF EXISTS cerefox_audit_log_document_id_fkey,
    DROP CONSTRAINT IF EXISTS cerefox_audit_log_version_id_fkey;

ALTER TABLE cerefox_audit_log
    ADD COLUMN IF NOT EXISTS details JSONB,
    ADD COLUMN IF NOT EXISTS txid    XID8;

ALTER TABLE cerefox_audit_log
    ALTER COLUMN txid SET DEFAULT pg_current_xact_id();

CREATE INDEX IF NOT EXISTS idx_cerefox_audit_log_txid
    ON cerefox_audit_log(txid)
    WHERE txid IS NOT NULL;

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
                      'project-delete',
                      'purge', 'projects-change', 'backup-restore',
                      'version-prune', 'reindex')
    );
