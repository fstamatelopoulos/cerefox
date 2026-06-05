-- Local PostgREST roles — mirror Supabase's Data API role model for a self-hosted
-- Cerefox (design: docs/research/local-cerefox-design.md §5.2).
--
-- Run AFTER the schema + RPCs are deployed (bun scripts/db_deploy.ts), as the DB
-- owner/superuser (the `cerefox` role created by the compose Postgres).
--
-- Why these roles: in the cloud, PostgREST connects as `authenticator` and SET ROLEs
-- to anon / authenticated / service_role based on the JWT. Cerefox's clients
-- (CLI / MCP / web) use the SERVICE-ROLE key, so they act as `service_role`, which
-- has full table access and BYPASSRLS. The SECURITY DEFINER RPCs run as the owner
-- regardless. So `service_role` is all the spike needs; anon/authenticated are
-- created for fidelity + future LAN/JWT use.
--
-- DEV-ONLY credentials. Localhost-bound only.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'authenticator'; -- DEV ONLY
  end if;
end
$$;

-- authenticator may become any of the API roles (PostgREST SET ROLE).
grant anon, authenticated, service_role to authenticator;

grant usage on schema public to anon, authenticated, service_role;

-- service_role = full access (the key the CLI / MCP / web use). BYPASSRLS already set.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- anon / authenticated: may execute the SECURITY DEFINER RPCs (matches cloud agent
-- access); direct table access stays RLS-denied (no policies).
grant execute on all functions in schema public to anon, authenticated;

-- Objects created by later deploys (new tables/funcs) inherit the same grants.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role, anon, authenticated;
