-- 0016_retention_config.sql — version retention becomes a property of the
-- store, not of whichever client happens to write.
--
-- `cerefox_snapshot_version` took `p_retention_hours` / `p_cleanup_enabled` as
-- parameters, and every client filled them from its own environment
-- (`CEREFOX_VERSION_RETENTION_HOURS`, `CEREFOX_VERSION_CLEANUP_ENABLED`). The
-- surviving version history therefore depended on **which client wrote last**:
-- an operator could set "keep everything" on their machine and still lose
-- versions the moment an agent running defaults saved a document. Retention
-- describes the data, so it belongs to the data.
--
-- Both parameters now default to NULL, meaning "read the store's policy":
--
--   version_retention_hours   (default 48)
--   version_cleanup_enabled   (default true)
--
-- Passing an explicit value still overrides, for deliberate one-off admin
-- operations — but no caller supplies one by accident any more.
--
-- Adds `cerefox_config_int` / `cerefox_config_bool`, the integer and boolean
-- companions to the existing `cerefox_config_float`. Same contract: fall back
-- to the caller's default when the key is unset or unparseable, so a malformed
-- config row can never break a write path.
--
-- Unchanged, and worth restating because it bounds the risk of a long window:
-- cleanup NEVER deletes the most recent version, and never deletes a version
-- marked `archived`. Turning cleanup off keeps everything forever; leaving it
-- on with a long window still guarantees at least the latest version survives.
--
-- The functions live in `rpcs.sql`, which `cerefox server deploy` re-applies.
-- This migration exists so the schema version moves and operators are told to
-- redeploy — the change is inert until the RPCs are replaced.
--
-- Idempotent: safe to re-run.

-- ── Fail-safe for EXISTING stores ────────────────────────────────────────────
--
-- Upgrading silently changes where retention comes from. An operator running
-- `CEREFOX_VERSION_CLEANUP_ENABLED=false` (or a long window) would, on their
-- very next save, fall back to the 48-hour default and lose the history they had
-- deliberately kept. The env var stops being read the moment the client updates,
-- which is before anyone reads a release note.
--
-- So this migration disables pruning on existing stores. Nothing is deleted;
-- cleanup simply does not run until the operator states a policy. Pruning is
-- irreversible and not-pruning is not, so the safe default during an unattended
-- upgrade is to do nothing. `cerefox doctor` and the Settings page both show the
-- value, and turning it back on is one command.
--
-- Only existing databases get this. A fresh deploy STAMPS migrations as applied
-- rather than running them (see `_shared/db-deploy`), so new installs keep the
-- ordinary bounded default (48h, cleanup on) — there is no history there to
-- lose, and unbounded version growth is a poor default to saddle them with.
--
-- ON CONFLICT DO NOTHING: if the operator has already chosen a policy, this must
-- never overwrite it, including on a re-run.
INSERT INTO cerefox_config (key, value)
VALUES ('version_cleanup_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
    RAISE NOTICE
        'Migration 0016: version retention now reads cerefox_config '
        '(version_retention_hours, version_cleanup_enabled). The CEREFOX_VERSION_* '
        'environment variables are no longer read. Version pruning has been DISABLED '
        'on this store as an upgrade precaution — nothing was deleted. Set your policy '
        'with `cerefox config set version_cleanup_enabled true` or the Settings page.';
END $$;
