-- Migration 0002: Replace metadata key registry with data-driven discovery
--
-- Drops the cerefox_metadata_keys table and its CRUD RPCs.
-- Replaces them with a single cerefox_list_metadata_keys() RPC that derives
-- metadata keys from actual metadata JSONB across all documents.
--
-- This migration is idempotent (safe to run multiple times).

-- ── Drop old registry RPCs ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS cerefox_upsert_metadata_key(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS cerefox_delete_metadata_key(TEXT);
DROP FUNCTION IF EXISTS cerefox_list_metadata_keys();

-- ── Drop old trigger and table ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS trig_cerefox_metadata_keys_updated ON cerefox_metadata_keys;
DROP TABLE IF EXISTS cerefox_metadata_keys;

-- ── Create new data-driven RPC ──────────────────────────────────────────────
CREATE FUNCTION cerefox_list_metadata_keys()
RETURNS TABLE (
    key            TEXT,
    doc_count      BIGINT,
    example_values TEXT[]
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT
        k.key,
        COUNT(DISTINCT d.id)                                    AS doc_count,
        (ARRAY_AGG(DISTINCT d.metadata ->> k.key) FILTER
          (WHERE d.metadata ->> k.key IS NOT NULL))[1:5]   AS example_values
    FROM cerefox_documents d,
         LATERAL jsonb_object_keys(d.metadata) AS k(key)
    WHERE d.metadata IS NOT NULL
      AND d.metadata != '{}'::jsonb
    GROUP BY k.key
    ORDER BY doc_count DESC, k.key;
$$;
