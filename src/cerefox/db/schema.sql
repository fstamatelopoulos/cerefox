-- Cerefox Database Schema
-- Run via: python scripts/db_deploy.py
-- Or manually in Supabase SQL Editor.
--
-- Requires extensions: vector (pgvector), uuid-ossp
-- These are enabled at the top of db_deploy.py before this file is applied.
--
-- @version: 0.12.1
-- The `@version` marker above is read by the schema-version-mismatch banner
-- (see /api/v1/schema-version). Bump it whenever schema.sql OR rpcs.sql
-- changes in a way that requires `cerefox server deploy` to be re-run —
-- schema and RPCs deploy together, so this version covers both. You MUST
-- bump it in lockstep with the `cerefox_schema_version()` literal at the
-- bottom of rpcs.sql (the deployed value); `cut_release.ts` fails the cut if
-- `src/cerefox/db/` changed without this bump, or if the two disagree.

-- ── Projects ──────────────────────────────────────────────────────────────────
-- Lightweight user-defined categories. No predefined taxonomy.
-- A document can belong to many projects (see cerefox_document_projects).

CREATE TABLE IF NOT EXISTS cerefox_projects (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    description TEXT,
    metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT cerefox_projects_name_unique UNIQUE (name)
);

-- ── Documents ─────────────────────────────────────────────────────────────────
-- One row per ingested document (markdown file, paste, agent write-back, etc.)
-- Project assignment lives in the cerefox_document_projects junction table.
-- Full content lives exclusively in cerefox_chunks — there is no content column here.

CREATE TABLE IF NOT EXISTS cerefox_documents (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT        NOT NULL,
    source          TEXT        NOT NULL DEFAULT 'manual',
    -- source values: 'file' | 'paste' | 'agent' | 'url' | 'manual'
    source_path     TEXT,
    -- SHA-256 of raw markdown content; used for deduplication
    content_hash    TEXT        NOT NULL,
    metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    chunk_count     INT         NOT NULL DEFAULT 0,
    total_chars     INT         NOT NULL DEFAULT 0,
    -- review_status: human governance flag. 'approved' = validated by human,
    -- 'pending_review' = modified by agent, not yet reviewed.
    -- Content is searchable in both states.
    review_status   TEXT        NOT NULL DEFAULT 'approved',
    -- lifecycle_status: where this document stands relative to the graph —
    -- 'active' | 'superseded' | 'stale' | 'archived'. Distinct from
    -- review_status (editorial state) and deleted_at (existence). Maintained by
    -- the relation RPCs (e.g. `supersedes` marks its target superseded).
    lifecycle_status TEXT       NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Soft delete: NULL = active, timestamp = deleted (recoverable).
    -- Search indexes exclude soft-deleted docs. Purge does the real CASCADE DELETE.
    deleted_at      TIMESTAMPTZ DEFAULT NULL,

    CONSTRAINT cerefox_documents_hash_unique UNIQUE (content_hash),
    CONSTRAINT cerefox_documents_review_status_check CHECK (review_status IN ('approved', 'pending_review'))
);

CREATE INDEX IF NOT EXISTS idx_documents_deleted_at
    ON cerefox_documents (deleted_at) WHERE deleted_at IS NOT NULL;

-- ── Document versions ──────────────────────────────────────────────────────────
-- One row per archived version of a document. Created automatically before each
-- content update (accidental-deletion protection).
--
-- Versions do NOT store a content snapshot — full content is reconstructed from
-- cerefox_chunks WHERE version_id = <this version's id>.
--
-- version_number is sequential per document (1, 2, 3 …), unique per document.
-- Cascade delete: deleting a document removes all its versions, which cascades
-- further to any chunks archived under those versions.

CREATE TABLE IF NOT EXISTS cerefox_document_versions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID        NOT NULL REFERENCES cerefox_documents(id) ON DELETE CASCADE,
    version_number  INT         NOT NULL,
    source          TEXT        NOT NULL DEFAULT 'manual',
    -- Stats snapshotted at archive time (chunk_count and total_chars of the archived content)
    chunk_count     INT         NOT NULL DEFAULT 0,
    total_chars     INT         NOT NULL DEFAULT 0,
    -- archived: when true, this version is protected from retention cleanup.
    -- Set via the version archival API. Default: false (eligible for cleanup).
    archived        BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT cerefox_document_versions_doc_num_unique UNIQUE (document_id, version_number)
);

-- ── Audit log ────────────────────────────────────────────────────────────────
-- Immutable, append-only record of all write operations against the knowledge base.
-- No UPDATE or DELETE allowed (enforced by RLS policy with no update/delete grants).
-- Audit entries persist regardless of version cleanup.
--
-- document_id is nullable to support logging operations on deleted documents
-- (the audit entry survives the document deletion).
-- version_id links to the version snapshot created by the operation (if any).

CREATE TABLE IF NOT EXISTS cerefox_audit_log (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID        REFERENCES cerefox_documents(id) ON DELETE SET NULL,
    version_id      UUID        REFERENCES cerefox_document_versions(id) ON DELETE SET NULL,
    operation       TEXT        NOT NULL,
    -- operation values: 'create', 'update-content', 'update-metadata', 'delete',
    --                   'status-change', 'archive', 'unarchive'
    author          TEXT        NOT NULL DEFAULT 'unknown',
    -- author: human username, agent name/model, or 'system' for automated actions
    author_type     TEXT        NOT NULL DEFAULT 'user',
    -- author_type: 'user' (human via web UI/CLI) or 'agent' (AI via MCP/Edge Function)
    size_before     INT,
    size_after      INT,
    description     TEXT        NOT NULL DEFAULT '',
    -- description: free-text explaining what changed and why.
    -- Auto-generated for system actions (approval, archival, retention cleanup).
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT cerefox_audit_log_operation_check CHECK (
        operation IN ('create', 'update-content', 'update-metadata', 'delete',
                      'status-change', 'archive', 'unarchive', 'restore',
                      -- iteration 29: graph edges are auditable writes too
                      'relation-set', 'relation-delete',
                      -- iteration 33: partial edits. Distinct from 'update-content'
                      -- so the trail separates "added to" from "rewrote" from
                      -- "removed" — one entry per operation in a cerefox_edit batch.
                      'insert', 'replace-section', 'delete-section',
                      -- iteration 35 (#197): renaming a heading is neither a
                      -- rewrite nor a removal, and the trail should say so.
                      'rename-section')
    ),
    CONSTRAINT cerefox_audit_log_author_type_check CHECK (author_type IN ('user', 'agent'))
);

-- ── Document ↔ Project junction ───────────────────────────────────────────────
-- Many-to-many: one document can belong to zero or more projects.

CREATE TABLE IF NOT EXISTS cerefox_document_projects (
    document_id UUID NOT NULL REFERENCES cerefox_documents(id) ON DELETE CASCADE,
    project_id  UUID NOT NULL REFERENCES cerefox_projects(id)  ON DELETE CASCADE,
    PRIMARY KEY (document_id, project_id)
);

-- ── Document relations (iteration 29) ─────────────────────────────────────────
-- Typed, directed edges between documents. rel_type is free text by design so
-- agents can define new types without a migration; the type dictionary lives in
-- the RPCs and gives KNOWN types behaviour (symmetry, lifecycle side effects).
-- Design: docs/research/document-relations-and-semantic-graph.md §2.2.

CREATE TABLE IF NOT EXISTS cerefox_document_relations (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id    UUID        NOT NULL REFERENCES cerefox_documents(id) ON DELETE CASCADE,
    target_id    UUID        NOT NULL REFERENCES cerefox_documents(id) ON DELETE CASCADE,
    rel_type     TEXT        NOT NULL,
    metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    author       TEXT        NOT NULL DEFAULT 'unknown',
    author_type  TEXT        NOT NULL DEFAULT 'agent',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_id, target_id, rel_type),
    CONSTRAINT cerefox_relations_no_self_edge CHECK (source_id <> target_id)
);

CREATE INDEX IF NOT EXISTS idx_cerefox_relations_source ON cerefox_document_relations(source_id);
CREATE INDEX IF NOT EXISTS idx_cerefox_relations_target ON cerefox_document_relations(target_id);
CREATE INDEX IF NOT EXISTS idx_cerefox_relations_type   ON cerefox_document_relations(rel_type);
CREATE INDEX IF NOT EXISTS idx_cerefox_docs_lifecycle
    ON cerefox_documents(lifecycle_status)
    WHERE lifecycle_status <> 'active';

-- ── Chunks ────────────────────────────────────────────────────────────────────
-- One row per chunk of a document. Embeddings and FTS live here.
--
-- version_id discriminates between current and archived chunks:
--   NULL         → current version (searchable, indexed by HNSW and GIN)
--   non-NULL     → archived under that version (excluded from search indexes,
--                  lazily deleted with their parent version row)
--
-- When a document is updated, all current chunks (version_id IS NULL) are
-- archived by setting version_id to the new version row's UUID. New chunks are
-- then inserted with version_id = NULL.

CREATE TABLE IF NOT EXISTS cerefox_chunks (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID        NOT NULL REFERENCES cerefox_documents(id) ON DELETE CASCADE,
    -- version_id: NULL = current; non-NULL = archived under this version
    version_id      UUID        REFERENCES cerefox_document_versions(id) ON DELETE CASCADE,
    chunk_index     INT         NOT NULL,
    -- heading_path: the heading hierarchy at this chunk, e.g. ARRAY['Overview', 'Architecture']
    heading_path    TEXT[]      NOT NULL DEFAULT '{}',
    heading_level   INT,
    -- title: the deepest heading at this chunk (for display and FTS boosting)
    title           TEXT,
    content         TEXT        NOT NULL,
    char_count      INT         NOT NULL,
    -- content_format: how this chunk's content reconstructs into full document text
    -- (iter-28D). 1 = legacy (chunk contents re-joined with E'\n\n' on read); 2 =
    -- blind-stitch (chunk contents are an exact, gapless partition, reconstructed by
    -- plain concat). It lives on the chunk (not the document) so an archived version
    -- reconstructs with its OWN format. See docs/guides/content-format.md.
    content_format  SMALLINT    NOT NULL DEFAULT 1,

    -- Primary embedding: always computed, cloud API (default: OpenAI text-embedding-3-small)
    embedding_primary  VECTOR(768) NOT NULL,
    -- Upgrade embedding: optional, alternative model (Fireworks, Vertex, etc.)
    embedding_upgrade  VECTOR(768),

    -- Track which model produced each embedding
    embedder_primary   TEXT        NOT NULL DEFAULT 'text-embedding-3-small',
    embedder_upgrade   TEXT,

    -- Full-text search vector: document title (A) + chunk heading (A) + body content (B).
    -- Set explicitly at ingestion time by cerefox_ingest_document RPC (Option B: computed in
    -- the RPC using p_title, which is already a parameter). Not GENERATED because a generated
    -- column cannot reference cerefox_documents.title (cross-table reference forbidden).
    -- Updated by cerefox_update_chunk_fts RPC when document title changes without content change.
    fts TSVECTOR,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- NOTE: no UNIQUE (document_id, chunk_index) table constraint here.
    -- Uniqueness of current chunks is enforced by the partial index below.
);

-- ── Migration tracking ────────────────────────────────────────────────────────
-- Records which migration files have been applied (used by db_migrate.py).

CREATE TABLE IF NOT EXISTS cerefox_migrations (
    id         SERIAL      PRIMARY KEY,
    filename   TEXT        NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Full-text search — current chunks only (WHERE version_id IS NULL)
CREATE INDEX IF NOT EXISTS idx_cerefox_chunks_fts
    ON cerefox_chunks USING GIN(fts)
    WHERE version_id IS NULL;

-- Vector similarity — primary embedding, current chunks only
CREATE INDEX IF NOT EXISTS idx_cerefox_chunks_emb_primary
    ON cerefox_chunks USING hnsw (embedding_primary vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE version_id IS NULL;

-- Vector similarity — upgrade embedding, current chunks only
CREATE INDEX IF NOT EXISTS idx_cerefox_chunks_emb_upgrade
    ON cerefox_chunks USING hnsw (embedding_upgrade vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE version_id IS NULL;

-- Partial unique index: enforces (document_id, chunk_index) uniqueness for
-- current chunks. Archived chunks are excluded and may share chunk_index values
-- across versions for the same document.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cerefox_chunks_current_unique
    ON cerefox_chunks(document_id, chunk_index)
    WHERE version_id IS NULL;

-- Archived chunk lookup — ordered retrieval of chunks for a specific version
CREATE INDEX IF NOT EXISTS idx_cerefox_chunks_version
    ON cerefox_chunks(version_id, chunk_index)
    WHERE version_id IS NOT NULL;

-- Document metadata (JSONB) — enables fast filtering by tags, source, etc.
CREATE INDEX IF NOT EXISTS idx_cerefox_docs_metadata
    ON cerefox_documents USING GIN(metadata);

-- Documents by content_hash (unique constraint covers equality; this covers range/prefix)
CREATE INDEX IF NOT EXISTS idx_cerefox_docs_hash
    ON cerefox_documents(content_hash);

-- Junction table lookup — find all projects for a document, and vice-versa
CREATE INDEX IF NOT EXISTS idx_cerefox_document_projects_doc
    ON cerefox_document_projects(document_id);

CREATE INDEX IF NOT EXISTS idx_cerefox_document_projects_project
    ON cerefox_document_projects(project_id);

-- Document versions lookup -- find all versions for a document, ordered by date
CREATE INDEX IF NOT EXISTS idx_cerefox_document_versions_doc
    ON cerefox_document_versions(document_id, created_at DESC);

-- Audit log indexes -- support temporal, author, and document-scoped queries
CREATE INDEX IF NOT EXISTS idx_cerefox_audit_log_created
    ON cerefox_audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cerefox_audit_log_document
    ON cerefox_audit_log(document_id, created_at DESC)
    WHERE document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cerefox_audit_log_author
    ON cerefox_audit_log(author, created_at DESC);

-- Full-text search on audit log descriptions
CREATE INDEX IF NOT EXISTS idx_cerefox_audit_log_desc_fts
    ON cerefox_audit_log USING GIN(to_tsvector('english', description));

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cerefox_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trig_cerefox_projects_updated
    BEFORE UPDATE ON cerefox_projects
    FOR EACH ROW EXECUTE FUNCTION cerefox_set_updated_at();

CREATE OR REPLACE TRIGGER trig_cerefox_documents_updated
    BEFORE UPDATE ON cerefox_documents
    FOR EACH ROW EXECUTE FUNCTION cerefox_set_updated_at();

CREATE OR REPLACE TRIGGER trig_cerefox_chunks_updated
    BEFORE UPDATE ON cerefox_chunks
    FOR EACH ROW EXECUTE FUNCTION cerefox_set_updated_at();


-- ── Live-database migration ───────────────────────────────────────────────────
-- When applying this schema to an existing database that still has the old
-- project_id column on cerefox_documents, drop it and migrate existing
-- document-project associations to the new junction table.
-- Safe to re-run — wrapped in a DO block that checks column existence.

DO $$
BEGIN
    -- Migrate existing project_id → cerefox_document_projects
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cerefox_documents'
          AND column_name = 'project_id'
    ) THEN
        -- Copy existing single-project associations into the junction table.
        -- Ignore duplicates in case of a partial previous migration.
        INSERT INTO cerefox_document_projects (document_id, project_id)
        SELECT id, project_id
        FROM cerefox_documents
        WHERE project_id IS NOT NULL
        ON CONFLICT DO NOTHING;

        -- Drop the old FK column and its index.
        ALTER TABLE cerefox_documents DROP COLUMN project_id;
    END IF;
END;
$$;

-- ── Config table ─────────────────────────────────────────────────────────────
-- Key-value configuration stored in Postgres. Edge Functions and Python read
-- this at call time -- no redeploy needed to toggle settings.
-- Currently used for: usage_tracking_enabled, require_requestor_identity,
-- requestor_identity_format.

CREATE TABLE IF NOT EXISTS cerefox_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Seed default config (idempotent)
INSERT INTO cerefox_config (key, value)
VALUES ('usage_tracking_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
INSERT INTO cerefox_config (key, value)
VALUES ('require_requestor_identity', 'false')
ON CONFLICT (key) DO NOTHING;
INSERT INTO cerefox_config (key, value)
VALUES ('requestor_identity_format', '^[a-zA-Z0-9_:.\- ]+$')
ON CONFLICT (key) DO NOTHING;
-- Document relations ship dormant: the tools stay hidden from agents until a
-- deployment opts in (iteration 29).
INSERT INTO cerefox_config (key, value)
VALUES ('relations_enabled', 'false')
ON CONFLICT (key) DO NOTHING;


-- ── Usage log ────────────────────────────────────────────────────────────────
-- Tracks read operations across all access paths. Opt-in; controlled by
-- cerefox_config 'usage_tracking_enabled'. Feeds the analytics page.

CREATE TABLE IF NOT EXISTS cerefox_usage_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    logged_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    operation    TEXT NOT NULL,
    access_path  TEXT NOT NULL,
    requestor    TEXT,
    document_id  UUID REFERENCES cerefox_documents(id) ON DELETE SET NULL,
    project_id   UUID REFERENCES cerefox_projects(id) ON DELETE SET NULL,
    query_text   TEXT,
    result_count INT,
    extra        JSONB DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS idx_usage_log_logged_at
    ON cerefox_usage_log (logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_log_operation_logged_at
    ON cerefox_usage_log (operation, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_log_access_path
    ON cerefox_usage_log (access_path);
CREATE INDEX IF NOT EXISTS idx_usage_log_requestor
    ON cerefox_usage_log (requestor) WHERE requestor IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_log_document_id
    ON cerefox_usage_log (document_id) WHERE document_id IS NOT NULL;


-- ── Row Level Security ────────────────────────────────────────────────────────
-- Enable RLS on all tables. No permissive policies are added: direct table
-- access via the anon key (PostgREST) is denied by default.
--
-- This does NOT affect the Python application or Edge Functions, which use the
-- service role key (bypasses RLS unconditionally). All search and write
-- operations go through SECURITY DEFINER RPCs (rpcs.sql), which run as the
-- function owner (postgres superuser) and also bypass RLS.
--
-- Safe to re-run — ALTER TABLE ... ENABLE ROW LEVEL SECURITY is idempotent.

ALTER TABLE cerefox_projects              ENABLE ROW LEVEL SECURITY;
ALTER TABLE cerefox_documents             ENABLE ROW LEVEL SECURITY;
ALTER TABLE cerefox_chunks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE cerefox_document_projects     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cerefox_document_versions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cerefox_audit_log              ENABLE ROW LEVEL SECURITY;
ALTER TABLE cerefox_migrations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cerefox_config                ENABLE ROW LEVEL SECURITY;
ALTER TABLE cerefox_usage_log             ENABLE ROW LEVEL SECURITY;
-- iteration 29 added this table and did not add it here, so it stayed
-- world-accessible on any project whose `anon` role holds the legacy
-- GRANT ... ON ALL TABLES IN SCHEMA public. Supabase's linter flagged it as
-- `rls_disabled_in_public` (2026-08-09). Every other table on this list denies
-- anon by having RLS on with NO policies; this one did not, so the model had a
-- hole exactly one table wide. See the guard test in _shared/__tests__.
ALTER TABLE cerefox_document_relations    ENABLE ROW LEVEL SECURITY;

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
