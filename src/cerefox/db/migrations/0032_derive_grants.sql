-- 0032_derive_grants.sql — derive the Data API grant list instead of listing it
--
-- Issue: the explicit-grant block (0013, #26) names its tables in a hand-written
-- ARRAY. That array has to match the set of `cerefox_*` tables, and it drifted:
-- `cerefox_document_relations` was added to schema.sql and never added to the
-- array. On an UPGRADE path that table is fine (0014 grants it inline), and on
-- the self-hosted stack `roles.sql` grants broadly via its own PostgREST wiring
-- — so the gap is invisible everywhere except the case nobody runs by hand: a
-- FRESH cloud deploy, where `ALTER DEFAULT PRIVILEGES` cannot help because it
-- only affects tables created AFTER it runs.
--
-- From 2026-10-30 Supabase stops granting Data API access to new tables in
-- `public` automatically, so a missing grant stops being cosmetic and becomes a
-- 42501 the first time anything reaches that table over PostgREST.
--
-- The fix is the one this project keeps arriving at: derive the list. Every
-- `cerefox_*` table in `public` is granted, so a new table cannot be forgotten.
-- Idempotent and safe to re-run.
--
-- `anon` and `authenticated` still get NOTHING, deliberately: every Cerefox
-- client authenticates with a service-role-equivalent key, and the RPCs are
-- SECURITY DEFINER. Supabase's migration note suggests granting all three
-- roles; doing so here would widen the surface for no caller.

DO $$
DECLARE t TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        RAISE NOTICE 'service_role absent (self-hosted stack) — grants skipped; roles.sql wires PostgREST';
        RETURN;
    END IF;

    GRANT USAGE ON SCHEMA public TO service_role;

    -- Derived from the catalogue, not from a list someone has to remember.
    FOR t IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname LIKE 'cerefox\_%'
    LOOP
        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t
        );
    END LOOP;

    -- Tables created LATER by the deploying role inherit the same grants. This
    -- is belt-and-braces next to the loop above, not a substitute for it: it
    -- cannot retro-grant anything that already exists, which is exactly how
    -- cerefox_document_relations slipped through.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
END $$;
