-- 0025_drop_orphaned_overloads.sql — remove pre-author-era 1-arg overloads.
--
-- cerefox_purge_document(UUID) and cerefox_restore_document(UUID) survived
-- every CREATE OR REPLACE since their signatures grew (OR REPLACE only
-- replaces the SAME signature), leaving long-lived databases with BOTH
-- overloads. A named 1-arg call is then ambiguous — PostgREST PGRST203
-- ("could not choose the best candidate") — which is how the first
-- production acceptance run failed to purge its fixtures (v1.7.0).
-- Fresh databases never had the old signatures and are unaffected.
--
-- Schema version 0.12.0 → 0.12.1. The DROPs also run from rpcs.sql on every
-- deploy; this migration makes the version advance signal the redeploy.

DROP FUNCTION IF EXISTS cerefox_purge_document(UUID);
DROP FUNCTION IF EXISTS cerefox_restore_document(UUID);
