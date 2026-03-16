-- Cerefox Database Schema
-- Run via: python scripts/db_deploy.py
-- Or manually in Supabase SQL Editor.
--
-- Requires extensions: vector (pgvector), uuid-ossp
-- These are enabled at the top of db_deploy.py before this file is applied.

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

CREATE TABLE IF NOT EXISTS cerefox_documents (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    title        TEXT        NOT NULL,
    source       TEXT        NOT NULL DEFAULT 'manual',
    -- source values: 'file' | 'paste' | 'agent' | 'url' | 'manual'
    source_path  TEXT,
    -- SHA-256 of raw markdown content; used for deduplication
    content_hash TEXT        NOT NULL,
    metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    chunk_count  INT         NOT NULL DEFAULT 0,
    total_chars  INT         NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT cerefox_documents_hash_unique UNIQUE (content_hash)
);

-- ── Document ↔ Project junction ───────────────────────────────────────────────
-- Many-to-many: one document can belong to zero or more projects.

CREATE TABLE IF NOT EXISTS cerefox_document_projects (
    document_id UUID NOT NULL REFERENCES cerefox_documents(id) ON DELETE CASCADE,
    project_id  UUID NOT NULL REFERENCES cerefox_projects(id)  ON DELETE CASCADE,
    PRIMARY KEY (document_id, project_id)
);

-- ── Chunks ────────────────────────────────────────────────────────────────────
-- One row per chunk of a document. Embeddings and FTS live here.

CREATE TABLE IF NOT EXISTS cerefox_chunks (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID        NOT NULL REFERENCES cerefox_documents(id) ON DELETE CASCADE,
    chunk_index     INT         NOT NULL,
    -- heading_path: the heading hierarchy at this chunk, e.g. ARRAY['Overview', 'Architecture']
    heading_path    TEXT[]      NOT NULL DEFAULT '{}',
    heading_level   INT,
    -- title: the deepest heading at this chunk (for display and FTS boosting)
    title           TEXT,
    content         TEXT        NOT NULL,
    char_count      INT         NOT NULL,

    -- Primary embedding: always computed, cloud API (default: OpenAI text-embedding-3-small)
    embedding_primary  VECTOR(768) NOT NULL,
    -- Upgrade embedding: optional, alternative model (Fireworks, Vertex, etc.)
    embedding_upgrade  VECTOR(768),

    -- Track which model produced each embedding
    -- Note: DDL default is 'all-mpnet-base-v2' for historical reasons; new chunks
    -- use the embedder name from config (e.g. 'text-embedding-3-small').
    embedder_primary   TEXT        NOT NULL DEFAULT 'all-mpnet-base-v2',
    embedder_upgrade   TEXT,

    -- Full-text search vector (generated, always kept in sync)
    fts TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
        setweight(to_tsvector('english', content), 'B')
    ) STORED,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT cerefox_chunks_doc_idx_unique UNIQUE (document_id, chunk_index)
);

-- ── Migration tracking ────────────────────────────────────────────────────────
-- Records which migration files have been applied (used by db_migrate.py).

CREATE TABLE IF NOT EXISTS cerefox_migrations (
    id         SERIAL      PRIMARY KEY,
    filename   TEXT        NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Full-text search
CREATE INDEX IF NOT EXISTS idx_cerefox_chunks_fts
    ON cerefox_chunks USING GIN(fts);

-- Vector similarity — primary embedding (HNSW for fast ANN search)
CREATE INDEX IF NOT EXISTS idx_cerefox_chunks_emb_primary
    ON cerefox_chunks USING hnsw (embedding_primary vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Vector similarity — upgrade embedding (only created, not always used)
CREATE INDEX IF NOT EXISTS idx_cerefox_chunks_emb_upgrade
    ON cerefox_chunks USING hnsw (embedding_upgrade vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Document lookup by chunk
CREATE INDEX IF NOT EXISTS idx_cerefox_chunks_document
    ON cerefox_chunks(document_id, chunk_index);

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

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cerefox_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
