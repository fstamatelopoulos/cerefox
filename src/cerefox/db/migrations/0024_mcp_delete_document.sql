-- 0024_mcp_delete_document.sql — MCP soft-delete parity (#208).
--
-- Reworks cerefox_delete_document: optional CAS via p_expected_content_hash
-- (CEREFOX_CONFLICT / PT409 on mismatch, same pattern as the ingest CAS),
-- p_reason appended to the audit description, JSONB return instead of VOID,
-- and idempotent re-delete (original deleted_at preserved, no duplicate audit
-- entry). No table DDL: the function itself ships in rpcs.sql, which
-- `cerefox server deploy` re-applies wholesale. This migration exists so the
-- schema version advances in step, which is what tells an existing deployment
-- it needs that redeploy.
--
-- Schema version 0.11.3 → 0.12.0. Purely additive; restore and purge remain
-- web-UI-only (the trust-model tier 3 is unchanged).

DO $$
BEGIN
    RAISE NOTICE
        'Migration 0024: cerefox_delete_document rework arrives with rpcs.sql '
        'on this deploy — CAS, p_reason, JSONB return, idempotent re-delete. '
        'Backs the new cerefox_delete_document MCP tool. Schema version 0.12.0.';
END $$;
