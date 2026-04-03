#!/usr/bin/env python3
"""Sync Cerefox project documentation into the knowledge base.

Ingests README.md and every Markdown file under docs/ (including docs/research/)
into the specified project, updating existing documents in-place so their content
stays current. Run this any time after editing documentation.

Usage:
    python scripts/sync_docs.py
    python scripts/sync_docs.py --dry-run
    python scripts/sync_docs.py --project "My Project"

Requires CEREFOX_SUPABASE_URL, CEREFOX_SUPABASE_KEY, and an embedding API key
(OPENAI_API_KEY or CEREFOX_FIREWORKS_API_KEY) in your .env file.
"""

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from cerefox.config import Settings
from cerefox.db.client import CerefoxClient
from cerefox.embeddings.cloud import CloudEmbedder
from cerefox.ingestion.pipeline import IngestionPipeline

# Files / directories to sync, relative to the repo root.
_TARGETS = [
    "README.md",          # project overview
    "AGENT_GUIDE.md",     # comprehensive agent reference for using Cerefox tools
    "CEREFOX_SKILL.md",   # minimal quick reference card for AI agents
    "docs/",              # all guides, plans, specs, and research notes (recursively)
]


def _extract_title(content: str, fallback: str) -> str:
    """Return the first H1 heading from content, or fallback if none found."""
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    return fallback


def _collect_files(repo_root: Path) -> list[tuple[Path, str]]:
    """Return (absolute_path, relative_source_path) pairs to sync."""
    files: list[tuple[Path, str]] = []

    # Root-level Markdown files
    for root_file in ["README.md", "AGENT_GUIDE.md", "CEREFOX_SKILL.md"]:
        path = repo_root / root_file
        if path.exists():
            files.append((path, root_file))

    docs_dir = repo_root / "docs"
    if docs_dir.is_dir():
        for md in sorted(docs_dir.rglob("*.md")):
            rel = str(md.relative_to(repo_root))
            files.append((md, rel))

    return files


def _make_embedder(settings: Settings) -> CloudEmbedder:
    api_key = settings.get_embedder_api_key()
    if not api_key:
        provider = "OPENAI" if settings.embedder == "openai" else "FIREWORKS"
        print(f"❌  Embedding API key not set. Set CEREFOX_{provider}_API_KEY in your .env file.")
        sys.exit(1)
    return CloudEmbedder(
        api_key=api_key,
        base_url=settings.get_embedder_base_url(),
        model=settings.get_embedder_model(),
        dimensions=settings.get_embedder_dimensions(),
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sync project docs (README.md + docs/) into the Cerefox knowledge base.",
    )
    parser.add_argument(
        "--project", "-p",
        default="cerefox",
        help='Project name to assign documents to (default: "cerefox").',
    )
    parser.add_argument(
        "--dry-run", "-n",
        action="store_true",
        help="List files that would be synced without ingesting anything.",
    )
    args = parser.parse_args()

    settings = Settings()
    if not settings.is_supabase_configured():
        print("❌  CEREFOX_SUPABASE_URL and CEREFOX_SUPABASE_KEY must be set.")
        sys.exit(1)

    client = CerefoxClient(settings)

    # Resolve the project by name (case-insensitive).
    projects = client.list_projects()
    project = next((p for p in projects if p["name"].lower() == args.project.lower()), None)
    if not project:
        names = ", ".join(f'"{p["name"]}"' for p in projects) or "(none)"
        print(f'❌  Project "{args.project}" not found.')
        print(f'   Available projects: {names}')
        print(f'   Create it first:    uv run cerefox create-project "{args.project}"')
        sys.exit(1)

    project_id = project["id"]
    project_name = project["name"]

    repo_root = Path(__file__).parent.parent
    files = _collect_files(repo_root)

    print(f'Syncing {len(files)} file(s) → project "{project_name}"')
    if args.dry_run:
        print("  (dry run — nothing will be ingested)\n")
        for _, src in files:
            print(f"  {src}")
        return

    embedder = _make_embedder(settings)
    pipeline = IngestionPipeline(client, embedder, settings)

    created = updated = skipped = errors = 0

    for path, source_path in files:
        try:
            content = path.read_text(encoding="utf-8")
        except Exception as exc:
            print(f"  ✗  {source_path}: read error — {exc}")
            errors += 1
            continue

        fallback = re.sub(r"[-_]", " ", path.stem).title()
        title = _extract_title(content, fallback)

        try:
            result = pipeline.ingest_text(
                content,
                title,
                source="file",
                source_path=source_path,
                project_ids=[project_id],
                update_existing=True,
            )
        except Exception as exc:
            print(f"  ✗  {source_path}: ingest error — {exc}")
            errors += 1
            continue

        if result.action == "skipped":
            skipped += 1
            print(f"  =  {source_path}  ({title})")
        elif result.action == "updated":
            updated += 1
            verb = "re-embedded" if result.reindexed else "metadata only"
            print(f"  ↑  {source_path}  ({title}) [{verb}]")
        else:
            created += 1
            print(f"  ✓  {source_path}  ({title}) [new — {result.chunk_count} chunks]")

    print(f"\nDone. {created} new · {updated} updated · {skipped} unchanged · {errors} errors")
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
