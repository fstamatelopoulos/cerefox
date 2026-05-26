#!/usr/bin/env python3
"""Apply pending database migrations to an existing Cerefox instance.

Migration files live in src/cerefox/db/migrations/ and are named with a
numeric prefix (e.g. 0003_add_versions.sql). They are applied in filename
order. Each file is applied exactly once; applied filenames are recorded in
the cerefox_migrations table so they are never re-applied.

Usage:
    python scripts/db_migrate.py             # apply all pending migrations
    python scripts/db_migrate.py --dry-run   # show what would run, no changes
    python scripts/db_migrate.py --status    # list migrations and their status

When to use this vs db_deploy.py:
    db_deploy.py   — fresh database with no data (full schema from scratch)
    db_migrate.py  — existing database with data (apply only new delta files)

After a fresh db_deploy.py run, all existing migration files are stamped as
applied automatically, so db_migrate.py is a no-op on a freshly deployed DB.

Requires CEREFOX_DATABASE_URL in your .env file.
"""

import argparse
import sys
from importlib.resources import files
from importlib.resources.abc import Traversable
from pathlib import Path

# Make src/ importable when this script is run directly from a repo checkout.
# No-op once `cerefox` is installed.
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import psycopg2

from cerefox.config import Settings

# Migration files via importlib.resources so this script works from any
# working directory and from both editable and installed-wheel modes.
_MIGRATIONS_PKG = files("cerefox.db.migrations")

# Ensure the tracking table exists. Safe to run even before db_deploy.py
# has been called — this is the bootstrap step.
_BOOTSTRAP_SQL = """
CREATE TABLE IF NOT EXISTS cerefox_migrations (
    id         SERIAL      PRIMARY KEY,
    filename   TEXT        NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""


def _connect(database_url: str) -> psycopg2.extensions.connection:
    try:
        conn = psycopg2.connect(database_url)
        conn.autocommit = False  # migrations run in transactions
        return conn
    except psycopg2.OperationalError as exc:
        print(f"\n❌  Could not connect to database: {exc}")
        print("\nCheck that CEREFOX_DATABASE_URL is correct in your .env file.")
        sys.exit(1)


def _applied_migrations(cur: psycopg2.extensions.cursor) -> set[str]:
    cur.execute("SELECT filename FROM cerefox_migrations ORDER BY filename;")
    return {row[0] for row in cur.fetchall()}


def _all_migration_files() -> list[Traversable]:
    return sorted(
        (p for p in _MIGRATIONS_PKG.iterdir() if p.name.endswith(".sql")),
        key=lambda p: p.name,
    )


def cmd_status(cur: psycopg2.extensions.cursor) -> None:
    applied = _applied_migrations(cur)
    files = _all_migration_files()

    if not files:
        print("No migration files found in migrations/.")
        return

    print(f"\n{'Filename':<50}  {'Status'}")
    print("─" * 60)
    for f in files:
        status = "✓  applied" if f.name in applied else "○  pending"
        print(f"  {f.name:<50}  {status}")

    pending = [f for f in files if f.name not in applied]
    print(f"\n{len(files)} total  |  {len(files) - len(pending)} applied  |  {len(pending)} pending")


def cmd_migrate(
    conn: psycopg2.extensions.connection,
    cur: psycopg2.extensions.cursor,
    dry_run: bool,
) -> None:
    applied = _applied_migrations(cur)
    files = _all_migration_files()
    pending = [f for f in files if f.name not in applied]

    if not pending:
        print("✓  No pending migrations — database is up to date.")
        return

    print(f"\n{len(pending)} pending migration(s):")
    for f in pending:
        print(f"  • {f.name}")

    if dry_run:
        print("\n⚠️  Dry-run mode — no changes will be made.")
        for f in pending:
            print(f"\n── {f.name} ──")
            sql = f.read_text()
            print(sql[:600] + ("..." if len(sql) > 600 else ""))
        return

    print()
    for f in pending:
        sql = f.read_text()
        print(f"▶  Applying {f.name}...")
        try:
            cur.execute(sql)
            cur.execute(
                "INSERT INTO cerefox_migrations (filename) VALUES (%s) ON CONFLICT DO NOTHING;",
                (f.name,),
            )
            conn.commit()
            print("   ✓  Done")
        except psycopg2.Error as exc:
            conn.rollback()
            print(f"\n❌  {f.name} failed: {exc}")
            print("\nMigration stopped. Previous migrations in this run were committed.")
            print("Fix the error in the migration file and re-run db_migrate.py.")
            sys.exit(1)

    print(f"\n✓  Applied {len(pending)} migration(s) successfully.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Apply pending Cerefox database migrations."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show pending migrations without applying them.",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Show the status of all migration files and exit.",
    )
    args = parser.parse_args()

    settings = Settings()
    if not settings.is_db_configured():
        print("❌  CEREFOX_DATABASE_URL is not set.")
        print("\nSet it in your .env file. See docs/guides/setup-supabase.md.")
        sys.exit(1)

    print("╔══════════════════════════════════════╗")
    print("║  Cerefox DB Migrate                  ║")
    print("╚══════════════════════════════════════╝")

    conn = _connect(settings.database_url)
    cur = conn.cursor()

    # Bootstrap: ensure the tracking table exists before we query it.
    cur.execute(_BOOTSTRAP_SQL)
    conn.commit()

    if args.status:
        cmd_status(cur)
    else:
        if args.dry_run:
            print("\n⚠️  Dry-run mode — no changes will be made.\n")
        cmd_migrate(conn, cur, dry_run=args.dry_run)

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
