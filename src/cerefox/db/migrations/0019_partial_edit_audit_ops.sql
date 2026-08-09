-- 0019_partial_edit_audit_ops.sql — make partial edits auditable (iteration 33).
--
-- `cerefox_audit_log.operation` is CHECK-constrained, so the partial-edit
-- operations need to be admitted before `cerefox_ingest_document` can record
-- them. Three new values:
--
--     insert            -- cerefox_insert, and insert operations inside cerefox_edit
--     replace-section   -- cerefox_edit
--     delete-section    -- cerefox_edit
--
-- Why distinct values rather than logging everything as 'update-content': the
-- audit trail exists to answer "what did someone do to this document", and
-- *added a paragraph*, *rewrote a section* and *removed a section* are
-- different answers even though all three are implemented with the same ingest
-- primitive underneath. A trail that flattens them cannot distinguish an agent
-- that appended from one that re-sent the whole document and dropped half of
-- it, which is much of what the trail is for. Design:
-- docs/specs/partial-document-edits-design.md §6.1.
--
-- Three values, not one per position: whether an insert landed at
-- `end_of_document` or `end_of_section` is detail about the same intent and
-- lives in the entry's description, so adding a position later never needs a
-- schema change.
--
-- The constraint stays the allow-list. A handler label that drifts from this
-- set aborts its transaction rather than silently recording an operation the
-- readers of the trail cannot interpret.
--
-- Idempotent: drops and re-adds the constraint.

ALTER TABLE cerefox_audit_log
    DROP CONSTRAINT IF EXISTS cerefox_audit_log_operation_check;

ALTER TABLE cerefox_audit_log
    ADD CONSTRAINT cerefox_audit_log_operation_check CHECK (
        operation IN ('create', 'update-content', 'update-metadata', 'delete',
                      'status-change', 'archive', 'unarchive', 'restore',
                      'relation-set', 'relation-delete',
                      'insert', 'replace-section', 'delete-section')
    );

DO $$
BEGIN
    RAISE NOTICE
        'Migration 0019: audit log accepts insert / replace-section / '
        'delete-section (iteration 33, partial document edits). '
        'cerefox_ingest_document also now returns content_hash on create (#189) '
        'and a size_warning flag; both arrive with rpcs.sql on this deploy.';
END $$;
