-- 0013_explicit_grants.sql — issue #26: explicit Data API grants for service_role
-- (Supabase implicit-grant removal). Idempotent; safe on existing deployments.

-- ── Explicit Data API grants (issue #26; schema 0.8.2) ─────────────────────────
-- Supabase is removing the implicit privileges the Data API roles get on
-- `public` tables (default for projects created after 2026-05-30; enforced on
-- existing projects 2026-10-30). Without explicit GRANTs a table is invisible
-- to PostgREST even for service_role (42501). Cerefox grants ONLY service_role
-- (the CLI / MCP / web all use service-role-equivalent keys; anon/authenticated
-- deliberately get nothing, matching the RPC EXECUTE posture from iter-28B).
-- Guarded: on the local (World B) stack this file deploys BEFORE roles.sql
-- creates service_role, so missing-role must be a no-op (roles.sql re-runs the
-- grants implicitly via its own PostgREST wiring; the next deploy picks them up).
DO $$
DECLARE t TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT USAGE ON SCHEMA public TO service_role;
        FOREACH t IN ARRAY ARRAY[
            'cerefox_projects', 'cerefox_documents', 'cerefox_document_versions',
            'cerefox_audit_log', 'cerefox_document_projects', 'cerefox_chunks',
            'cerefox_migrations', 'cerefox_config', 'cerefox_usage_log'
        ] LOOP
            IF to_regclass('public.' || t) IS NOT NULL THEN
                EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
            END IF;
        END LOOP;
        -- Future cerefox_* tables created by the deploying role keep working.
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
            GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
    END IF;
END $$;
