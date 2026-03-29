-- Migration 0006: Usage tracking + config table (Iteration 16C)
--
-- New tables:
--   cerefox_config       -- key-value config (e.g., usage_tracking_enabled)
--   cerefox_usage_log    -- read operation log for analytics
--
-- New RPCs:
--   cerefox_get_config, cerefox_set_config
--   cerefox_log_usage
--   cerefox_list_usage_log
--   cerefox_usage_summary

-- ── 1. Config table ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cerefox_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- RLS: deny direct access; all access goes through SECURITY DEFINER RPCs
ALTER TABLE cerefox_config ENABLE ROW LEVEL SECURITY;

-- Seed default config
INSERT INTO cerefox_config (key, value)
VALUES ('usage_tracking_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- ── 2. Usage log table ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cerefox_usage_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    logged_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    operation    TEXT NOT NULL,
    access_path  TEXT NOT NULL,
    reader       TEXT,
    document_id  UUID REFERENCES cerefox_documents(id) ON DELETE SET NULL,
    project_id   UUID REFERENCES cerefox_projects(id) ON DELETE SET NULL,
    query_text   TEXT,
    result_count INT,
    extra        JSONB DEFAULT '{}'::JSONB
);

-- RLS: deny direct access
ALTER TABLE cerefox_usage_log ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_usage_log_logged_at
    ON cerefox_usage_log (logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_log_operation_logged_at
    ON cerefox_usage_log (operation, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_log_access_path
    ON cerefox_usage_log (access_path);
CREATE INDEX IF NOT EXISTS idx_usage_log_reader
    ON cerefox_usage_log (reader) WHERE reader IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_log_document_id
    ON cerefox_usage_log (document_id) WHERE document_id IS NOT NULL;

-- ── 3. Config RPCs ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cerefox_get_config(p_key TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
    SELECT value FROM cerefox_config WHERE key = p_key;
$$;

CREATE OR REPLACE FUNCTION cerefox_set_config(p_key TEXT, p_value TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_allowed TEXT[] := ARRAY['usage_tracking_enabled'];
BEGIN
    IF NOT (p_key = ANY(v_allowed)) THEN
        RAISE EXCEPTION 'Unknown config key: %. Allowed keys: %', p_key, v_allowed;
    END IF;

    INSERT INTO cerefox_config (key, value)
    VALUES (p_key, p_value)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END;
$$;

-- ── 4. Log usage RPC ─────────────────────────────────────────────────────────
-- Checks config first; no-op if tracking is disabled.

CREATE OR REPLACE FUNCTION cerefox_log_usage(
    p_operation    TEXT,
    p_access_path  TEXT,
    p_reader       TEXT        DEFAULT NULL,
    p_document_id  UUID        DEFAULT NULL,
    p_project_id   UUID        DEFAULT NULL,
    p_query_text   TEXT        DEFAULT NULL,
    p_result_count INT         DEFAULT NULL,
    p_extra        JSONB       DEFAULT '{}'::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_enabled TEXT;
BEGIN
    SELECT value INTO v_enabled FROM cerefox_config WHERE key = 'usage_tracking_enabled';
    IF v_enabled IS NULL OR v_enabled != 'true' THEN
        RETURN;  -- tracking disabled; no-op
    END IF;

    INSERT INTO cerefox_usage_log (
        operation, access_path, reader, document_id, project_id,
        query_text, result_count, extra
    ) VALUES (
        p_operation, p_access_path, p_reader, p_document_id, p_project_id,
        p_query_text, p_result_count, p_extra
    );
END;
$$;

-- ── 5. List usage log RPC ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cerefox_list_usage_log(
    p_start       TIMESTAMPTZ DEFAULT NULL,
    p_end         TIMESTAMPTZ DEFAULT NULL,
    p_operation   TEXT        DEFAULT NULL,
    p_access_path TEXT        DEFAULT NULL,
    p_reader      TEXT        DEFAULT NULL,
    p_project_id  UUID        DEFAULT NULL,
    p_limit       INT         DEFAULT 100
)
RETURNS TABLE (
    id           UUID,
    logged_at    TIMESTAMPTZ,
    operation    TEXT,
    access_path  TEXT,
    reader       TEXT,
    document_id  UUID,
    doc_title    TEXT,
    project_id   UUID,
    query_text   TEXT,
    result_count INT,
    extra        JSONB
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
    SELECT
        ul.id,
        ul.logged_at,
        ul.operation,
        ul.access_path,
        ul.reader,
        ul.document_id,
        d.title AS doc_title,
        ul.project_id,
        ul.query_text,
        ul.result_count,
        ul.extra
    FROM cerefox_usage_log ul
    LEFT JOIN cerefox_documents d ON ul.document_id = d.id
    WHERE (p_start IS NULL       OR ul.logged_at >= p_start)
      AND (p_end IS NULL         OR ul.logged_at <= p_end)
      AND (p_operation IS NULL   OR ul.operation = p_operation)
      AND (p_access_path IS NULL OR ul.access_path = p_access_path)
      AND (p_reader IS NULL      OR ul.reader = p_reader)
      AND (p_project_id IS NULL  OR ul.project_id = p_project_id)
    ORDER BY ul.logged_at DESC
    LIMIT p_limit;
$$;

-- ── 6. Usage summary RPC ─────────────────────────────────────────────────────
-- Returns a JSON object with aggregated stats for the analytics page.

CREATE OR REPLACE FUNCTION cerefox_usage_summary(
    p_start       TIMESTAMPTZ DEFAULT NULL,
    p_end         TIMESTAMPTZ DEFAULT NULL,
    p_project_id  UUID        DEFAULT NULL,
    p_access_path TEXT        DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_result JSON;
BEGIN
    WITH filtered AS (
        SELECT *
        FROM cerefox_usage_log ul
        WHERE (p_start IS NULL       OR ul.logged_at >= p_start)
          AND (p_end IS NULL         OR ul.logged_at <= p_end)
          AND (p_project_id IS NULL  OR ul.project_id = p_project_id)
          AND (p_access_path IS NULL OR ul.access_path = p_access_path)
    ),
    ops_by_day AS (
        SELECT
            DATE(logged_at) AS day,
            COUNT(*) AS count
        FROM filtered
        GROUP BY DATE(logged_at)
        ORDER BY day
    ),
    ops_by_operation AS (
        SELECT operation, COUNT(*) AS count
        FROM filtered
        GROUP BY operation
        ORDER BY count DESC
    ),
    ops_by_access_path AS (
        SELECT access_path, COUNT(*) AS count
        FROM filtered
        GROUP BY access_path
        ORDER BY count DESC
    ),
    top_documents AS (
        SELECT
            f.document_id,
            d.title AS doc_title,
            COUNT(*) AS count
        FROM filtered f
        JOIN cerefox_documents d ON f.document_id = d.id
        WHERE f.document_id IS NOT NULL
        GROUP BY f.document_id, d.title
        ORDER BY count DESC
        LIMIT 10
    ),
    top_readers AS (
        SELECT reader, COUNT(*) AS count
        FROM filtered
        WHERE reader IS NOT NULL
        GROUP BY reader
        ORDER BY count DESC
        LIMIT 10
    )
    SELECT json_build_object(
        'total_count', (SELECT COUNT(*) FROM filtered),
        'ops_by_day', COALESCE((SELECT json_agg(json_build_object('day', day, 'count', count)) FROM ops_by_day), '[]'::JSON),
        'ops_by_operation', COALESCE((SELECT json_agg(json_build_object('operation', operation, 'count', count)) FROM ops_by_operation), '[]'::JSON),
        'ops_by_access_path', COALESCE((SELECT json_agg(json_build_object('access_path', access_path, 'count', count)) FROM ops_by_access_path), '[]'::JSON),
        'top_documents', COALESCE((SELECT json_agg(json_build_object('document_id', document_id, 'doc_title', doc_title, 'count', count)) FROM top_documents), '[]'::JSON),
        'top_readers', COALESCE((SELECT json_agg(json_build_object('reader', reader, 'count', count)) FROM top_readers), '[]'::JSON)
    ) INTO v_result;

    RETURN v_result;
END;
$$;
