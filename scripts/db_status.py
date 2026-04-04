#!/usr/bin/env python3
"""Verify Cerefox schema health and report table statistics.

Usage:
    python scripts/db_status.py

Requires CEREFOX_DATABASE_URL in your .env file.
Exits with code 0 if everything looks good, 1 if something is missing.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import psycopg2

from cerefox.config import Settings

# Objects we expect to exist after a successful db_deploy.py run
_EXPECTED_TABLES = [
    "cerefox_projects",
    "cerefox_documents",
    "cerefox_document_versions",
    "cerefox_audit_log",
    "cerefox_document_projects",
    "cerefox_chunks",
    "cerefox_migrations",
]

_EXPECTED_FUNCTIONS = [
    "cerefox_set_updated_at",
    "cerefox_hybrid_search",
    "cerefox_fts_search",
    "cerefox_semantic_search",
    "cerefox_reconstruct_doc",
    "cerefox_save_note",
    "cerefox_search_docs",
    "cerefox_context_expand",
    "cerefox_list_metadata_keys",
    "cerefox_snapshot_version",
    "cerefox_get_document",
    "cerefox_list_document_versions",
    "cerefox_create_audit_entry",
    "cerefox_list_audit_entries",
    "cerefox_ingest_document",
    "cerefox_delete_document",
    "cerefox_update_chunk_fts",
]

_EXPECTED_EXTENSIONS = ["uuid-ossp", "vector"]

_EXPECTED_INDEXES = [
    "idx_cerefox_chunks_fts",
    "idx_cerefox_chunks_emb_primary",
    "idx_cerefox_chunks_emb_upgrade",
    "idx_cerefox_chunks_current_unique",
    "idx_cerefox_chunks_version",
    "idx_cerefox_docs_metadata",
    "idx_cerefox_docs_hash",
    "idx_cerefox_document_projects_doc",
    "idx_cerefox_document_projects_project",
    "idx_cerefox_document_versions_doc",
]


def _connect(database_url: str) -> psycopg2.extensions.connection:
    try:
        conn = psycopg2.connect(database_url)
        conn.autocommit = True
        return conn
    except psycopg2.OperationalError as exc:
        print(f"❌  Could not connect: {exc}")
        sys.exit(1)


def check_extensions(cur: psycopg2.extensions.cursor) -> list[str]:
    cur.execute(
        "SELECT extname FROM pg_extension WHERE extname = ANY(%s)",
        (_EXPECTED_EXTENSIONS,),
    )
    return [row[0] for row in cur.fetchall()]


def check_tables(cur: psycopg2.extensions.cursor) -> list[str]:
    cur.execute(
        """
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename = ANY(%s)
        """,
        (_EXPECTED_TABLES,),
    )
    return [row[0] for row in cur.fetchall()]


def check_functions(cur: psycopg2.extensions.cursor) -> list[str]:
    cur.execute(
        """
        SELECT routine_name FROM information_schema.routines
        WHERE routine_schema = 'public'
          AND routine_name = ANY(%s)
        """,
        (_EXPECTED_FUNCTIONS,),
    )
    return [row[0] for row in cur.fetchall()]


def check_indexes(cur: psycopg2.extensions.cursor) -> list[str]:
    cur.execute(
        """
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = ANY(%s)
        """,
        (_EXPECTED_INDEXES,),
    )
    return [row[0] for row in cur.fetchall()]


def get_row_counts(cur: psycopg2.extensions.cursor) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in (
        "cerefox_projects",
        "cerefox_documents",
        "cerefox_document_versions",
        "cerefox_document_projects",
        "cerefox_chunks",
    ):
        try:
            cur.execute(f"SELECT COUNT(*) FROM {table}")  # noqa: S608
            counts[table] = cur.fetchone()[0]
        except psycopg2.Error:
            counts[table] = -1
    return counts


def main() -> None:
    settings = Settings()

    if not settings.is_db_configured():
        print("❌  CEREFOX_DATABASE_URL is not set in .env")
        sys.exit(1)

    print("╔══════════════════════════════════════╗")
    print("║  Cerefox DB Status                   ║")
    print("╚══════════════════════════════════════╝\n")

    conn = _connect(settings.database_url)
    cur = conn.cursor()

    all_ok = True

    # ── Extensions ─────────────────────────────────────────────────────────────
    print("Extensions:")
    found_exts = check_extensions(cur)
    for ext in _EXPECTED_EXTENSIONS:
        ok = ext in found_exts
        print(f"  {'✓' if ok else '✗'}  {ext}")
        if not ok:
            all_ok = False

    # ── Tables ─────────────────────────────────────────────────────────────────
    print("\nTables:")
    found_tables = check_tables(cur)
    for table in _EXPECTED_TABLES:
        ok = table in found_tables
        print(f"  {'✓' if ok else '✗'}  {table}")
        if not ok:
            all_ok = False

    # ── Functions / RPCs ───────────────────────────────────────────────────────
    print("\nFunctions / RPCs:")
    found_funcs = check_functions(cur)
    for func in _EXPECTED_FUNCTIONS:
        ok = func in found_funcs
        print(f"  {'✓' if ok else '✗'}  {func}()")
        if not ok:
            all_ok = False

    # ── Indexes ────────────────────────────────────────────────────────────────
    print("\nIndexes:")
    found_idxs = check_indexes(cur)
    for idx in _EXPECTED_INDEXES:
        ok = idx in found_idxs
        print(f"  {'✓' if ok else '✗'}  {idx}")
        if not ok:
            all_ok = False

    # ── Row counts ─────────────────────────────────────────────────────────────
    print("\nRow counts:")
    counts = get_row_counts(cur)
    for table, count in counts.items():
        if count == -1:
            print(f"  ?  {table}: (table missing)")
        else:
            print(f"  ℹ  {table}: {count:,} rows")

    cur.close()
    conn.close()

    print("\n" + "─" * 42)
    if all_ok:
        print("✓  All checks passed. Schema looks healthy.")
    else:
        print("✗  Some checks failed. Run db_deploy.py to fix missing objects.")
        print("   See docs/guides/setup-supabase.md for help.")

    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
