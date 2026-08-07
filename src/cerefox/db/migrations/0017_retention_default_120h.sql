-- 0017_retention_default_120h.sql — raise the built-in version-retention window
-- from 48 to 120 hours.
--
-- 48 hours does not survive a weekend: a bad edit made on Friday afternoon is
-- unrecoverable by Monday morning, which is exactly when someone would look for
-- it. 120 hours (5 days) covers that gap while still bounding growth — versions
-- carry embeddings and are the largest rows in a busy store.
--
-- This is only the FALLBACK used when the store has expressed no preference. An
-- explicit `version_retention_hours` in cerefox_config is untouched, as is the
-- `version_cleanup_enabled=false` fail-safe that migration 0016 seeds on
-- existing stores.
--
-- Unchanged: cleanup never deletes the most recent version, nor any version
-- marked `archived`.
--
-- The value lives in `rpcs.sql`, which `cerefox server deploy` re-applies. This
-- migration exists so the schema version moves and operators are told to
-- redeploy.
--
-- Idempotent: safe to re-run.

DO $$
BEGIN
    RAISE NOTICE
        'Migration 0017: default version retention is now 120 hours (was 48). '
        'An explicit version_retention_hours setting is unaffected.';
END $$;
