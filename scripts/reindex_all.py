#!/usr/bin/env python
"""Reindex all documents with title-boosted embeddings and FTS.

Run this after applying migration 0011 (title boosting) to update existing
documents with the new embedding format (title prefix) and FTS formula
(document title at weight A).

New documents ingested after migration 0011 are already correct -- this
script is only needed for documents that existed before the migration.

Usage::

    uv run python scripts/reindex_all.py [--dry-run] [--batch N]

Options:
    --dry-run   Show counts without making any changes.
    --batch N   Number of chunks to embed per API call (default: 50).

The script is resumable: if interrupted, re-running it will skip chunks
already embedded with the current model (unless --all was passed to the
underlying cerefox reindex command).
"""

import subprocess
import sys


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="Preview without changes.")
    parser.add_argument("--batch", type=int, default=50, help="Chunks per embedding API call (default: 50).")
    args = parser.parse_args()

    cmd = [
        "uv", "run", "cerefox", "reindex",
        "--all",
        f"--batch={args.batch}",
    ]
    if args.dry_run:
        cmd.append("--dry-run")

    print("Running:", " ".join(cmd))
    result = subprocess.run(cmd)
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
