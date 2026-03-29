-- Migration 0009: Add 'restore' to audit log operation CHECK constraint
--
-- The soft delete feature (0008) used 'unarchive' for restore-from-trash
-- operations. This was semantically incorrect -- 'unarchive' is for version
-- archival toggling. This migration adds 'restore' as a proper operation type.
--
-- Safe to re-run: DROP CONSTRAINT IF EXISTS handles idempotency.

ALTER TABLE cerefox_audit_log DROP CONSTRAINT IF EXISTS cerefox_audit_log_operation_check;
ALTER TABLE cerefox_audit_log ADD CONSTRAINT cerefox_audit_log_operation_check CHECK (
    operation IN ('create', 'update-content', 'update-metadata', 'delete',
                  'status-change', 'archive', 'unarchive', 'restore')
);

-- Also fix any existing audit entries that used 'unarchive' for restore-from-trash
-- (they have description starting with 'Restored document:')
UPDATE cerefox_audit_log
SET operation = 'restore'
WHERE operation = 'unarchive'
  AND description LIKE 'Restored document:%';
