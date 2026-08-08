-- 0018_ingest_defers_retention_to_config.sql — make the store's retention policy
-- actually take effect on the write path (#183, reported by @tdebasis).
--
-- v1.1.0 moved version retention into `cerefox_config` and changed
-- `cerefox_snapshot_version` to default its parameters to NULL so that
-- COALESCE(param, config, default) could fall through to the store's policy.
--
-- That half worked. `cerefox_ingest_document` — snapshot_version's ONLY caller —
-- kept the pre-1.1.0 concrete defaults:
--
--     p_retention_hours   INT     DEFAULT 48
--     p_cleanup_enabled   BOOLEAN DEFAULT TRUE
--
-- and passed them straight through. So snapshot_version never once received NULL
-- on a real write, and never once consulted `cerefox_config`. The store-level
-- switch was inert on the only path that matters.
--
-- Consequences, all silent:
--
--   * `version_cleanup_enabled = false` did nothing. Pruning ran anyway.
--   * Migration 0016's fail-safe — which seeds `false` on existing stores during
--     the 1.1.0 upgrade precisely so history could not be quietly discarded —
--     was defeated by this.
--   * `version_retention_hours` did nothing. The window stayed at 48 hours, not
--     the configured value (or the 120h default from migration 0017).
--   * The v1.1.0 release notes promised "Nothing is deleted." That was false.
--
-- The damage is per-document and latent rather than immediate: cleanup only runs
-- for a document when THAT document is next written. So versions older than the
-- window survive until their document is edited, then vanish. On the maintainer's
-- store, 362 of 397 versions were older than 48h and still intact when this was
-- found — every one of them was one edit away from being pruned.
--
-- Fix: `cerefox_ingest_document`'s parameters default to NULL, so the store's
-- policy resolves. An explicit value still overrides for a single call.
--
-- Lives in rpcs.sql, which `cerefox server deploy` re-applies. This migration
-- exists so the schema version moves and operators are told to redeploy.
--
-- Idempotent: safe to re-run.

DO $$
BEGIN
    RAISE NOTICE
        'Migration 0018: cerefox_ingest_document now defers version retention to '
        'cerefox_config. Before this, version_cleanup_enabled and '
        'version_retention_hours were silently ignored on every write (#183).';
END $$;
