#!/usr/bin/env python3
"""Deploy Cerefox schema to a fresh Supabase / Postgres instance.

Usage:
    python scripts/db_deploy.py
    python scripts/db_deploy.py --dry-run
    python scripts/db_deploy.py --reset   # ⚠️  drops all cerefox tables first

Requires CEREFOX_DATABASE_URL in your .env file.
See docs/guides/setup-supabase.md for where to find this value.
"""

import argparse
import sys
from importlib.resources import files
from pathlib import Path

# Make src/ importable when this script is run directly from a repo checkout.
# Once `cerefox` is installed (uv sync, pip install) this sys.path tweak is a
# no-op — the resolved import wins.
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import psycopg2

from cerefox.config import Settings

# SQL files loaded via importlib.resources so this script works whether
# `cerefox` is run from a repo checkout (editable install) or from an
# installed wheel. No more "script reads from src/cerefox/db/" assumption.
_DB_RESOURCES = files("cerefox.db")

# Tables to drop in --reset mode (order matters for FK constraints)
_RESET_SQL = """
DROP TABLE IF EXISTS cerefox_chunks     CASCADE;
DROP TABLE IF EXISTS cerefox_documents  CASCADE;
DROP TABLE IF EXISTS cerefox_projects   CASCADE;
DROP TABLE IF EXISTS cerefox_migrations CASCADE;
DROP FUNCTION IF EXISTS cerefox_set_updated_at CASCADE;
DROP FUNCTION IF EXISTS cerefox_hybrid_search  CASCADE;
DROP FUNCTION IF EXISTS cerefox_fts_search     CASCADE;
DROP FUNCTION IF EXISTS cerefox_semantic_search CASCADE;
DROP FUNCTION IF EXISTS cerefox_reconstruct_doc CASCADE;
"""

_EXTENSIONS_SQL = """
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
"""


def _connect(database_url: str) -> psycopg2.extensions.connection:
    try:
        conn = psycopg2.connect(database_url)
        conn.autocommit = True  # DDL statements run outside transactions
        return conn
    except psycopg2.OperationalError as exc:
        print(f"\n❌  Could not connect to database: {exc}")
        print("\nCheck that CEREFOX_DATABASE_URL is correct in your .env file.")
        print("See docs/guides/setup-supabase.md for help.")
        sys.exit(1)


def _execute_sql(cur: psycopg2.extensions.cursor, sql: str, label: str, dry_run: bool) -> bool:
    if dry_run:
        print(f"\n── {label} (dry-run, not executed) ──")
        print(sql[:500] + ("..." if len(sql) > 500 else ""))
        return True
    try:
        cur.execute(sql)
        return True
    except psycopg2.Error as exc:
        print(f"\n❌  {label} failed: {exc}")
        return False


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Deploy Cerefox schema to a Supabase/Postgres instance."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print SQL that would be executed without running it.",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="⚠️  Drop all Cerefox tables and functions before deploying (DESTRUCTIVE).",
    )
    args = parser.parse_args()

    settings = Settings()

    if not settings.is_db_configured():
        print("❌  CEREFOX_DATABASE_URL is not set.")
        print("\nSet it in your .env file. See docs/guides/setup-supabase.md.")
        sys.exit(1)

    schema_sql = _DB_RESOURCES.joinpath("schema.sql").read_text(encoding="utf-8")
    rpcs_sql = _DB_RESOURCES.joinpath("rpcs.sql").read_text(encoding="utf-8")

    print("╔══════════════════════════════════════╗")
    print("║  Cerefox DB Deploy                   ║")
    print("╚══════════════════════════════════════╝")

    if args.dry_run:
        print("\n⚠️  DRY-RUN mode — no changes will be made.\n")

    if args.reset and not args.dry_run:
        confirm = input(
            "\n⚠️  --reset will DROP all Cerefox tables. "
            "All data will be lost. Type 'yes' to continue: "
        )
        if confirm.strip().lower() != "yes":
            print("Aborted.")
            sys.exit(0)

    print("\nConnecting to database...")
    conn = _connect(settings.database_url)
    cur = conn.cursor()

    steps: list[tuple[str, str]] = []

    if args.reset:
        steps.append((_RESET_SQL, "Reset: drop existing Cerefox objects"))

    # Build stamp SQL: mark all migration files as already applied.
    # These changes are incorporated in schema.sql/rpcs.sql, so db_migrate.py
    # must not re-apply them on an existing database.
    migrations_pkg = files("cerefox.db.migrations")
    migration_files = sorted(
        p.name for p in migrations_pkg.iterdir() if p.name.endswith(".sql")
    )
    if migration_files:
        values = ", ".join(f"('{name}')" for name in migration_files)
        stamp_sql = (
            f"INSERT INTO cerefox_migrations (filename) VALUES {values} "
            f"ON CONFLICT (filename) DO NOTHING;"
        )
    else:
        stamp_sql = None

    steps.extend([
        (_EXTENSIONS_SQL, "Enable extensions (uuid-ossp, vector/pgvector)"),
        (schema_sql, "Apply schema (tables, indexes, triggers)"),
        (rpcs_sql, "Apply RPCs (search functions)"),
    ])
    if stamp_sql:
        steps.append((stamp_sql, "Stamp migration files as already applied"))

    success_count = 0
    for sql, label in steps:
        print(f"\n▶  {label}...")
        ok = _execute_sql(cur, sql, label, args.dry_run)
        if ok:
            print("   ✓  Done")
            success_count += 1
        else:
            print(f"\nDeployment stopped due to error in: {label}")
            sys.exit(1)

    cur.close()
    conn.close()

    print("\n" + "─" * 42)
    if args.dry_run:
        print(f"✓  Dry-run complete. {success_count} steps would have run.")
    else:
        print(f"✓  Deployment complete. {success_count} steps applied.")
        print("\nNext step: verify the schema with:")
        print("    python scripts/db_status.py")


if __name__ == "__main__":
    main()
