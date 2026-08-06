-- 0015_conflict_errcode_pt409.sql — stop a permanent conflict masquerading as
-- a retryable one.
--
-- `cerefox_ingest_document` raised CEREFOX_CONFLICT under SQLSTATE '40001'
-- (serialization_failure). In PostgreSQL, 40001 is the one class that promises
-- "this failure was transient — retry the transaction and it may succeed", and
-- PostgREST maps it to a retryable HTTP status. But an optimistic-concurrency
-- conflict is DETERMINISTIC: the same request, carrying the same stale token,
-- fails identically forever. Retry-aware infrastructure took the promise at
-- face value and looped with no exit condition.
--
-- Measured on a live project before the fix:
--
--   * ONE HTTP request with a stale token executed the function 68,825 times
--     in 125 seconds, then returned 504 Gateway Timeout.
--   * The loop OUTLIVED the client: it kept running after the 504, passing
--     153,000 executions before the backend was terminated by hand.
--   * A contributor hit the same loop for roughly a day: ~47 MILLION calls,
--     which exhausted their project's Disk IO budget and required killing a
--     hung connection to stop.
--   * The identical probe raising PT409 executed exactly ONCE and returned
--     409 Conflict in 636 ms.
--
-- Two changes, both in `cerefox_ingest_document`:
--
--   1. Conflicts now raise SQLSTATE 'PT409'. PostgREST's PTxxx convention maps
--      it to HTTP 409 Conflict, which nothing retries.
--   2. A blank (empty or whitespace) expected_content_hash is treated as
--      ABSENT rather than stale, so it raises CEREFOX_TOKEN_REQUIRED (400)
--      instead of a conflict. '' is not NULL, so it used to slip past the
--      absent-token branch into the conflict branch — and could never match a
--      real hash, making it a permanent failure. That is the exact shape that
--      triggered the incident.
--
-- Client detection is unaffected: every transport matches on the
-- `CEREFOX_CONFLICT:` / `CEREFOX_TOKEN_REQUIRED:` message prefix, never on the
-- SQLSTATE.
--
-- This migration only re-applies `rpcs.sql`, which `cerefox server deploy`
-- does anyway. It exists so the schema version moves and operators are told to
-- redeploy — the fix is inert until the RPC is replaced.
--
-- Idempotent: safe to re-run.

DO $$
BEGIN
    RAISE NOTICE
        'Migration 0015: CEREFOX_CONFLICT now raises PT409 (HTTP 409) instead of 40001. '
        'The change lives in rpcs.sql, which is re-applied by `cerefox server deploy`. '
        'Until that runs, stale-token conflicts remain retryable by infrastructure.';
END $$;
