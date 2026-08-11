-- 0022_rls_on_document_relations.sql — close the one-table RLS gap (iteration 36).
--
-- `cerefox_document_relations` was added in iteration 29 and never added to
-- schema.sql's RLS block, so it alone among the ten tables had row-level
-- security disabled. Cerefox's model is "RLS ON with NO policies" — the
-- service-role key bypasses RLS and everything else is denied — so a table
-- without RLS is reachable by any role holding a table grant.
--
-- On projects created before Supabase stopped granting `anon` blanket
-- privileges on `public` (the maintainer's production project is one), `anon`
-- holds SELECT/INSERT/UPDATE/DELETE here. The anon / publishable key is
-- designed to be public, so that means world read AND write on this table.
-- Supabase's advisor flagged it as `rls_disabled_in_public` on 2026-08-09.
--
-- Newer projects grant `anon` nothing, so they were never exposed — which is
-- why the maintainer's staging project showed no privileges while production
-- showed all four. Both get RLS regardless: relying on the absence of a grant
-- is not the same as denying access.
--
-- Impact of the gap: the relations feature is opt-in (`relations_enabled`,
-- default false), so the table is empty on a default install and no document
-- content was ever reachable through it. Content, chunks, versions, audit log
-- and config were correctly protected throughout.
--
-- Idempotent, and safe on a table that already has RLS.

ALTER TABLE cerefox_document_relations ENABLE ROW LEVEL SECURITY;

-- Defence in depth: revoke the legacy blanket grants so the table is denied by
-- privilege as well as by RLS. Harmless where the grants were never made.
REVOKE ALL ON TABLE cerefox_document_relations FROM anon;

DO $$
BEGIN
    RAISE NOTICE
        'Migration 0022: RLS enabled on cerefox_document_relations and anon '
        'grants revoked (Supabase rls_disabled_in_public). Schema version 0.11.2.';
END $$;
