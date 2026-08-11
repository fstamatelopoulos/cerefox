-- 0021_rename_section_audit_op.sql — audit the rename operation (iteration 35, #197).
--
-- `cerefox_audit_log.operation` is CHECK-constrained, so a new partial-edit
-- operation cannot be recorded until the constraint knows about it. Migration
-- 0019 widened it for insert / replace-section / delete-section; this adds
-- rename-section.
--
-- Why the operation exists: there was no way to change a heading's own text.
-- `replace_section` preserves the heading by design, and delete + re-insert
-- sacrifices the section's body and position to fix the heading — an agent hit
-- this on real work (a heading whose date had gone stale), judged that trade
-- wrong, and left the document stale rather than risk the body. Renaming is
-- therefore its own operation, and one that structurally cannot touch a body.
--
-- Schema version 0.11.0 → 0.11.1. Additive: the constraint only widens, so an
-- older client against this database is unaffected, and this database against
-- an older client simply never sees the new value.

ALTER TABLE cerefox_audit_log
    DROP CONSTRAINT IF EXISTS cerefox_audit_log_operation_check;

ALTER TABLE cerefox_audit_log
    ADD CONSTRAINT cerefox_audit_log_operation_check CHECK (
        operation IN ('create', 'update-content', 'update-metadata', 'delete',
                      'status-change', 'archive', 'unarchive', 'restore',
                      'relation-set', 'relation-delete',
                      'insert', 'replace-section', 'delete-section',
                      'rename-section')
    );

DO $$
BEGIN
    RAISE NOTICE
        'Migration 0021: audit log accepts rename-section (iteration 35, #197). '
        'Schema version 0.11.1 — re-apply rpcs.sql on this deploy.';
END $$;
