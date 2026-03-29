-- Migration 0007: Rename reader to requestor in cerefox_usage_log
--
-- The usage log tracks ALL operations (both reads and writes), not just reads.
-- The "reader" column name implied read-only tracking. "requestor" is a neutral
-- term that covers both the agent/user performing a search (read) and the
-- agent/user performing an ingest (write).

-- 1. Rename the column
ALTER TABLE cerefox_usage_log RENAME COLUMN reader TO requestor;

-- 2. Rename the index (Postgres doesn't have RENAME INDEX, so drop and recreate)
DROP INDEX IF EXISTS idx_usage_log_reader;
CREATE INDEX IF NOT EXISTS idx_usage_log_requestor
    ON cerefox_usage_log (requestor) WHERE requestor IS NOT NULL;

-- 3. Drop and recreate cerefox_log_usage with renamed parameter
DROP FUNCTION IF EXISTS cerefox_log_usage(TEXT, TEXT, TEXT, UUID, UUID, TEXT, INT, JSONB);

CREATE OR REPLACE FUNCTION cerefox_log_usage(
    p_operation    TEXT,
    p_access_path  TEXT,
    p_requestor    TEXT        DEFAULT NULL,
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
        RETURN;
    END IF;

    INSERT INTO cerefox_usage_log (
        operation, access_path, requestor, document_id, project_id,
        query_text, result_count, extra
    ) VALUES (
        p_operation, p_access_path, p_requestor, p_document_id, p_project_id,
        p_query_text, p_result_count, p_extra
    );
END;
$$;

-- 4. Drop and recreate cerefox_list_usage_log with renamed column
DROP FUNCTION IF EXISTS cerefox_list_usage_log(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, UUID, INT);

CREATE OR REPLACE FUNCTION cerefox_list_usage_log(
    p_start       TIMESTAMPTZ DEFAULT NULL,
    p_end         TIMESTAMPTZ DEFAULT NULL,
    p_operation   TEXT        DEFAULT NULL,
    p_access_path TEXT        DEFAULT NULL,
    p_requestor   TEXT        DEFAULT NULL,
    p_project_id  UUID        DEFAULT NULL,
    p_limit       INT         DEFAULT 100
)
RETURNS TABLE (
    id           UUID,
    logged_at    TIMESTAMPTZ,
    operation    TEXT,
    access_path  TEXT,
    requestor    TEXT,
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
        ul.requestor,
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
      AND (p_requestor IS NULL   OR ul.requestor = p_requestor)
      AND (p_project_id IS NULL  OR ul.project_id = p_project_id)
    ORDER BY ul.logged_at DESC
    LIMIT p_limit;
$$;

-- 5. Drop and recreate cerefox_usage_summary with renamed field
DROP FUNCTION IF EXISTS cerefox_usage_summary(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT);

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
        SELECT DATE(logged_at) AS day, COUNT(*) AS count
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
        SELECT f.document_id, d.title AS doc_title, COUNT(*) AS count
        FROM filtered f
        JOIN cerefox_documents d ON f.document_id = d.id
        WHERE f.document_id IS NOT NULL
        GROUP BY f.document_id, d.title
        ORDER BY count DESC
        LIMIT 10
    ),
    top_requestors AS (
        SELECT requestor, COUNT(*) AS count
        FROM filtered
        WHERE requestor IS NOT NULL
        GROUP BY requestor
        ORDER BY count DESC
        LIMIT 10
    )
    SELECT json_build_object(
        'total_count', (SELECT COUNT(*) FROM filtered),
        'ops_by_day', COALESCE((SELECT json_agg(json_build_object('day', day, 'count', count)) FROM ops_by_day), '[]'::JSON),
        'ops_by_operation', COALESCE((SELECT json_agg(json_build_object('operation', operation, 'count', count)) FROM ops_by_operation), '[]'::JSON),
        'ops_by_access_path', COALESCE((SELECT json_agg(json_build_object('access_path', access_path, 'count', count)) FROM ops_by_access_path), '[]'::JSON),
        'top_documents', COALESCE((SELECT json_agg(json_build_object('document_id', document_id, 'doc_title', doc_title, 'count', count)) FROM top_documents), '[]'::JSON),
        'top_requestors', COALESCE((SELECT json_agg(json_build_object('requestor', requestor, 'count', count)) FROM top_requestors), '[]'::JSON)
    ) INTO v_result;

    RETURN v_result;
END;
$$;
