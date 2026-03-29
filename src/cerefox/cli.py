"""Cerefox command-line interface.

Usage::

    cerefox ingest my-note.md --project "personal"
    cerefox ingest --title "My Thought" --paste   # reads from stdin
    cerefox search "my query" --mode hybrid
    cerefox list-docs
    cerefox list-docs --project "personal"
    cerefox delete-doc <document-id>
    cerefox list-projects
    cerefox list-metadata-keys                    # discover metadata keys
    cerefox web                                   # start the web UI
"""

from __future__ import annotations

import sys

import click

from cerefox.config import Settings


# ── Root group ────────────────────────────────────────────────────────────────


@click.group()
@click.version_option()
def cli() -> None:
    """Cerefox — personal second brain knowledge backend."""


# ── Helpers ───────────────────────────────────────────────────────────────────


def _get_client(settings: Settings):
    """Return an initialised CerefoxClient, exiting cleanly if not configured."""
    from cerefox.db.client import CerefoxClient  # noqa: PLC0415

    if not settings.is_supabase_configured():
        click.echo(
            "❌  Supabase is not configured.\n"
            "    Set CEREFOX_SUPABASE_URL and CEREFOX_SUPABASE_KEY in your .env file.",
            err=True,
        )
        sys.exit(1)
    return CerefoxClient(settings)


def _get_embedder(settings: Settings):
    """Return the configured CloudEmbedder instance."""
    import sys  # noqa: PLC0415

    from cerefox.embeddings.cloud import CloudEmbedder  # noqa: PLC0415

    api_key = settings.get_embedder_api_key()
    if not api_key:
        provider = "OPENAI" if settings.embedder == "openai" else "FIREWORKS"
        click.echo(
            f"❌  Embedding API key not set.\n"
            f"    Set CEREFOX_{provider}_API_KEY in your .env file.",
            err=True,
        )
        sys.exit(1)

    return CloudEmbedder(
        api_key=api_key,
        base_url=settings.get_embedder_base_url(),
        model=settings.get_embedder_model(),
        dimensions=settings.get_embedder_dimensions(),
    )


# ── ingest ────────────────────────────────────────────────────────────────────


@cli.command()
@click.argument("path", required=False, type=click.Path(exists=True, dir_okay=False))
@click.option("--title", "-t", default=None, help="Document title (defaults to filename stem).")
@click.option("--project", "-p", default=None, help="Project name to assign the document to.")
@click.option(
    "--paste",
    is_flag=True,
    default=False,
    help="Read markdown from stdin instead of a file.  --title is required.",
)
@click.option(
    "--metadata",
    "-m",
    default=None,
    help="Extra metadata as a JSON string, e.g. '{\"tags\":[\"work\"]}'.",
)
@click.option(
    "--update",
    is_flag=True,
    default=False,
    help=(
        "Update an existing document instead of creating a new one. "
        "Matches by source path (for files) or title (for --paste). "
        "Falls through to a normal create when no match is found."
    ),
)
def ingest(
    path: str | None,
    title: str | None,
    project: str | None,
    paste: bool,
    metadata: str | None,
    update: bool,
) -> None:
    """Ingest a markdown, PDF, or DOCX file (or stdin) into the knowledge base."""
    import json  # noqa: PLC0415

    from cerefox.chunking.converters import convert_to_markdown  # noqa: PLC0415
    from cerefox.ingestion.pipeline import IngestionPipeline  # noqa: PLC0415

    # Validate inputs before touching external services.
    if paste and not title:
        click.echo("❌  --title is required when using --paste.", err=True)
        sys.exit(1)
    if not paste and not path:
        click.echo("❌  Provide a file PATH or use --paste to read from stdin.", err=True)
        sys.exit(1)

    settings = Settings()
    client = _get_client(settings)
    embedder = _get_embedder(settings)
    pipeline = IngestionPipeline(client, embedder, settings)

    # Parse metadata JSON if supplied.
    extra_meta: dict = {}
    if metadata:
        try:
            extra_meta = json.loads(metadata)
        except json.JSONDecodeError as exc:
            click.echo(f"❌  Invalid --metadata JSON: {exc}", err=True)
            sys.exit(1)

    if paste:
        text = sys.stdin.read()
        result = pipeline.ingest_text(
            text=text, title=title, source="paste", project_name=project,
            metadata=extra_meta, update_existing=update,
        )
    else:
        from pathlib import Path as _Path  # noqa: PLC0415

        p = _Path(path)
        if p.suffix.lower() in (".pdf", ".docx"):
            try:
                text = convert_to_markdown(p)
            except ImportError as exc:
                click.echo(f"❌  {exc}", err=True)
                sys.exit(1)
            result = pipeline.ingest_text(
                text=text,
                title=title or p.stem,
                source="file",
                source_path=str(p),
                project_name=project,
                metadata=extra_meta,
                update_existing=update,
            )
        else:
            result = pipeline.ingest_file(
                path=path, title=title, project_name=project, metadata=extra_meta,
                update_existing=update,
            )

    if result.skipped:
        click.echo(f"⏭  Skipped (already ingested): {result.title}")
    elif result.reindexed:
        click.echo(
            f"✓  Updated: {result.title}\n"
            f"   Document ID : {result.document_id}\n"
            f"   Chunks      : {result.chunk_count}\n"
            f"   Total chars : {result.total_chars:,}"
        )
        if result.project_ids:
            click.echo(f"   Project IDs : {', '.join(result.project_ids)}")
    else:
        click.echo(
            f"✓  Ingested: {result.title}\n"
            f"   Document ID : {result.document_id}\n"
            f"   Chunks      : {result.chunk_count}\n"
            f"   Total chars : {result.total_chars:,}"
        )
        if result.project_ids:
            click.echo(f"   Project IDs : {', '.join(result.project_ids)}")


# ── ingest-dir ────────────────────────────────────────────────────────────────


@cli.command("ingest-dir")
@click.argument("directory", type=click.Path(exists=True, file_okay=False, dir_okay=True))
@click.option(
    "--pattern",
    default="*.md",
    show_default=True,
    help="Glob pattern for files to ingest (e.g. '*.md', '**/*.md', '*.pdf').",
)
@click.option("--project", "-p", default=None, help="Project name to assign all documents to.")
@click.option(
    "--recursive/--no-recursive",
    default=False,
    show_default=True,
    help="Recurse into sub-directories.",
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Print files that would be ingested without actually ingesting them.",
)
@click.option(
    "--update",
    is_flag=True,
    default=False,
    help=(
        "Update existing documents by source path instead of creating new ones. "
        "Useful for re-ingesting a directory after editing files."
    ),
)
def ingest_dir(
    directory: str,
    pattern: str,
    project: str | None,
    recursive: bool,
    dry_run: bool,
    update: bool,
) -> None:
    """Ingest all matching files in a directory."""
    from pathlib import Path as _Path  # noqa: PLC0415

    from cerefox.chunking.converters import convert_to_markdown  # noqa: PLC0415
    from cerefox.ingestion.pipeline import IngestionPipeline  # noqa: PLC0415

    d = _Path(directory)
    glob_fn = d.rglob if recursive else d.glob
    files = sorted(glob_fn(pattern))

    if not files:
        click.echo(f"No files matching '{pattern}' found in {directory}")
        return

    click.echo(f"Found {len(files)} file(s).")

    if dry_run:
        for f in files:
            click.echo(f"  {f}")
        return

    settings = Settings()
    client = _get_client(settings)
    embedder = _get_embedder(settings)
    pipeline = IngestionPipeline(client, embedder, settings)

    ingested = updated = skipped = errors = 0
    for f in files:
        try:
            if f.suffix.lower() in (".pdf", ".docx"):
                text = convert_to_markdown(f)
                result = pipeline.ingest_text(
                    text=text,
                    title=f.stem,
                    source="file",
                    source_path=str(f),
                    project_name=project,
                    update_existing=update,
                )
            else:
                result = pipeline.ingest_file(
                    path=str(f), project_name=project, update_existing=update
                )

            if result.skipped:
                click.echo(f"  ⏭  {f.name}  (already ingested)")
                skipped += 1
            elif result.reindexed:
                click.echo(f"  ↑  {f.name}  ({result.chunk_count} chunks, updated)")
                updated += 1
            else:
                click.echo(f"  ✓  {f.name}  ({result.chunk_count} chunks)")
                ingested += 1
        except Exception as exc:
            click.echo(f"  ❌  {f.name}: {exc}", err=True)
            errors += 1

    click.echo(
        f"\nDone. Ingested={ingested}  Updated={updated}  Skipped={skipped}  Errors={errors}"
    )


# ── search ────────────────────────────────────────────────────────────────────


@cli.command()
@click.argument("query")
@click.option(
    "--mode",
    "-m",
    type=click.Choice(["hybrid", "fts", "semantic"], case_sensitive=False),
    default="hybrid",
    show_default=True,
    help="Search mode.",
)
@click.option("--count", "-n", default=10, show_default=True, help="Number of results to request.")
@click.option("--project", "-p", default=None, help="Limit search to a project UUID.")
@click.option("--alpha", default=0.7, show_default=True, help="FTS/semantic weight (hybrid only).")
@click.option(
    "--min-score",
    default=None,
    type=float,
    help=(
        "Minimum relevance score threshold (0.0–1.0). "
        "Overrides CEREFOX_MIN_SEARCH_SCORE. Not applied to FTS."
    ),
)
@click.option(
    "--filter",
    "-f",
    "metadata_filter",
    default=None,
    help=(
        "JSONB metadata containment filter as a JSON string. "
        'Only documents whose metadata contains ALL specified key-value pairs are returned. '
        'Example: \'{"type": "decision", "status": "active"}\'. '
        "Run 'cerefox list-metadata-keys' to discover available keys."
    ),
)
def search(
    query: str,
    mode: str,
    count: int,
    project: str | None,
    alpha: float,
    min_score: float | None,
    metadata_filter: str | None,
) -> None:
    """Search the knowledge base."""
    import json  # noqa: PLC0415

    from cerefox.retrieval.search import SearchClient  # noqa: PLC0415

    # Parse --filter JSON string into a dict
    parsed_filter: dict | None = None
    if metadata_filter:
        try:
            parsed_filter = json.loads(metadata_filter)
            if not isinstance(parsed_filter, dict):
                click.echo("❌  --filter must be a JSON object, e.g. '{\"type\": \"note\"}'.", err=True)
                return
        except json.JSONDecodeError as exc:
            click.echo(f"❌  --filter is not valid JSON: {exc}", err=True)
            return

    settings = Settings()
    if min_score is not None:
        settings.min_search_score = min_score
    client = _get_client(settings)
    embedder = _get_embedder(settings)
    sc = SearchClient(client, embedder, settings)

    # CLI: no max_bytes limit — unbounded results for power users.
    if mode == "hybrid":
        resp = sc.hybrid(query, match_count=count, alpha=alpha, project_id=project,
                         metadata_filter=parsed_filter, max_bytes=None)
    elif mode == "fts":
        resp = sc.fts(query, match_count=count, project_id=project,
                      metadata_filter=parsed_filter, max_bytes=None)
    else:
        resp = sc.semantic(query, match_count=count, project_id=project,
                           metadata_filter=parsed_filter, max_bytes=None)

    if not resp.results:
        click.echo("No results found.")
        return

    click.echo(f"Search: {query!r}  mode={mode}  found={resp.total_found}")
    if resp.truncated:
        click.echo(f"⚠  Response truncated at {resp.response_bytes:,} bytes.")
    click.echo("─" * 80)

    for i, hit in enumerate(resp.results, 1):
        breadcrumb = " › ".join(hit.heading_path) if hit.heading_path else hit.doc_title
        click.echo(f"\n[{i}] {breadcrumb}  (score={hit.score:.3f})")
        click.echo(f"    Doc: {hit.doc_title}  ({hit.doc_source})")
        # Show a preview of the content (first 300 chars).
        preview = hit.content[:300].replace("\n", " ")
        if len(hit.content) > 300:
            preview += "…"
        click.echo(f"    {preview}")

    click.echo(f"\n{len(resp.results)} result(s) shown  ({resp.response_bytes:,} bytes).")

    client.log_usage(
        operation="search", access_path="cli", requestor="user",
        query_text=query, project_id=project_id, result_count=len(resp.results),
    )


# ── list-docs ─────────────────────────────────────────────────────────────────


@cli.command("list-docs")
@click.option("--project", "-p", default=None, help="Filter by project ID or name.")
@click.option("--limit", "-n", default=20, show_default=True, help="Maximum rows to show.")
def list_docs(project: str | None, limit: int) -> None:
    """List documents in the knowledge base."""
    settings = Settings()
    client = _get_client(settings)
    docs = client.list_documents(project_id=project, limit=limit)

    if not docs:
        click.echo("No documents found.")
        return

    click.echo(f"{'ID':<38}  {'Chunks':>6}  {'Chars':>8}  Title")
    click.echo("─" * 80)
    for doc in docs:
        click.echo(
            f"{doc['id']:<38}  {doc.get('chunk_count', 0):>6}  "
            f"{doc.get('total_chars', 0):>8,}  {doc['title']}"
        )
    click.echo(f"\n{len(docs)} document(s) shown.")


# ── delete-doc ────────────────────────────────────────────────────────────────


@cli.command("delete-doc")
@click.argument("document_id")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation prompt.")
def delete_doc(document_id: str, yes: bool) -> None:
    """Delete a document and all its chunks by ID."""
    settings = Settings()
    client = _get_client(settings)

    if not yes:
        click.confirm(
            f"Delete document {document_id} and all its chunks?", default=False, abort=True
        )

    client.delete_document(document_id)
    click.echo(f"✓  Deleted document {document_id}")


# ── list-projects ─────────────────────────────────────────────────────────────


@cli.command("list-projects")
def list_projects() -> None:
    """List all projects."""
    settings = Settings()
    client = _get_client(settings)
    projects = client.list_projects()

    if not projects:
        click.echo("No projects found.")
        return

    click.echo(f"{'ID':<38}  Name")
    click.echo("─" * 60)
    for proj in projects:
        click.echo(f"{proj['id']:<38}  {proj['name']}")
    click.echo(f"\n{len(projects)} project(s).")


# ── list-metadata-keys ────────────────────────────────────────────────────────


@cli.command("list-metadata-keys")
def list_metadata_keys() -> None:
    """Show metadata keys discovered across all documents.

    Scans doc_metadata JSONB on every document and reports each key with the
    number of documents using it and up to 5 example values.
    """
    settings = Settings()
    client = _get_client(settings)
    keys = client.list_metadata_keys()

    if not keys:
        click.echo("No metadata keys found across documents.")
        return

    click.echo(f"{'Key':<25}  {'Docs':>5}  Example values")
    click.echo("─" * 80)
    for k in keys:
        examples = ", ".join(k.get("example_values") or []) or "—"
        click.echo(f"{k['key']:<25}  {k.get('doc_count', 0):>5}  {examples}")
    click.echo(f"\n{len(keys)} key(s) found.")


@cli.command("metadata-search")
@click.option("--filter", "filter_json", required=True, help="JSON metadata filter, e.g. '{\"type\":\"decision\"}'")
@click.option("--project", "project_name", default=None, help="Filter by project name")
@click.option("--updated-since", default=None, help="ISO-8601 timestamp lower bound for updated_at")
@click.option("--created-since", default=None, help="ISO-8601 timestamp lower bound for created_at")
@click.option("--limit", default=10, help="Max results (default: 10)")
@click.option("--include-content", is_flag=True, help="Include full document text")
def metadata_search(
    filter_json: str,
    project_name: str | None,
    updated_since: str | None,
    created_since: str | None,
    limit: int,
    include_content: bool,
) -> None:
    """Search documents by metadata key-value criteria."""
    import json as json_mod

    try:
        metadata_filter = json_mod.loads(filter_json)
    except json_mod.JSONDecodeError as exc:
        click.echo(f"Invalid JSON filter: {exc}", err=True)
        raise SystemExit(1)

    if not isinstance(metadata_filter, dict) or not metadata_filter:
        click.echo("metadata_filter must be a non-empty JSON object", err=True)
        raise SystemExit(1)

    settings = Settings()
    client = _get_client(settings)

    project_id: str | None = None
    if project_name:
        projects = client.list_projects()
        for p in projects:
            if p["name"].lower() == project_name.lower():
                project_id = p["id"]
                break
        if project_id is None:
            click.echo(f"Project not found: {project_name}", err=True)
            raise SystemExit(1)

    rows = client.metadata_search(
        metadata_filter=metadata_filter,
        project_id=project_id,
        updated_since=updated_since,
        created_since=created_since,
        limit=limit,
        include_content=include_content,
    )

    if not rows:
        click.echo("No documents match the metadata filter.")
        return

    for row in rows:
        proj_names = row.get("project_names") or []
        projects_str = f"  projects: {', '.join(proj_names)}" if proj_names else ""
        click.echo(f"  {row['title']}  (id: {row['document_id']})")
        click.echo(f"    {row.get('total_chars', 0)} chars | {row.get('review_status', 'approved')} | updated {str(row.get('updated_at', ''))[:10]}{projects_str}")
        if include_content and row.get("content"):
            click.echo(f"    ---\n{row['content'][:500]}{'...' if len(row.get('content', '')) > 500 else ''}")
        click.echo()
    click.echo(f"{len(rows)} document(s) found.")


@cli.command("config-get")
@click.argument("key")
def config_get(key: str) -> None:
    """Read a config value (e.g., usage_tracking_enabled)."""
    settings = Settings()
    client = _get_client(settings)
    value = client.get_config(key)
    if value is None:
        click.echo(f"{key}: (not set)")
    else:
        click.echo(f"{key}: {value}")


@cli.command("config-set")
@click.argument("key")
@click.argument("value")
def config_set(key: str, value: str) -> None:
    """Set a config value (e.g., cerefox config-set usage_tracking_enabled true)."""
    settings = Settings()
    client = _get_client(settings)
    try:
        client.set_config(key, value)
        click.echo(f"{key} = {value}")
    except Exception as exc:
        click.echo(f"Error: {exc}", err=True)
        raise SystemExit(1)


# ── reindex ───────────────────────────────────────────────────────────────────


@cli.command("reindex")
@click.option(
    "--batch",
    default=50,
    show_default=True,
    help="Number of chunks to embed per API call.",
)
@click.option(
    "--all",
    "reindex_all",
    is_flag=True,
    default=False,
    help="Re-embed every chunk, even those already embedded with the current model.",
)
def reindex(batch: int, reindex_all: bool) -> None:
    """Re-embed all chunks with the currently configured embedder.

    Use this after switching embedders (e.g. from OpenAI to Fireworks) to migrate
    existing content. By default, skips chunks already embedded by the current
    model. Use --all to force re-embedding of everything.
    """
    settings = Settings()
    client = _get_client(settings)
    embedder = _get_embedder(settings)

    skip_model = None if reindex_all else embedder.model_name
    chunks = client.list_all_chunks(embedder_not=skip_model)

    if not chunks:
        click.echo("✓  Nothing to reindex — all chunks already use the current embedder.")
        return

    click.echo(
        f"Reindexing {len(chunks)} chunk(s) with {embedder.model_name} "
        f"(batch size {batch})…"
    )

    updated = 0
    failed = 0
    for i in range(0, len(chunks), batch):
        chunk_batch = chunks[i : i + batch]
        texts = [c["content"] for c in chunk_batch]
        try:
            embeddings = embedder.embed_batch(texts)
        except Exception as exc:
            click.echo(f"  ⚠  Embedding batch {i // batch + 1} failed: {exc}", err=True)
            failed += len(chunk_batch)
            continue

        for chunk, embedding in zip(chunk_batch, embeddings):
            try:
                client.update_chunk_embedding(chunk["id"], embedding, embedder.model_name)
                updated += 1
            except Exception as exc:
                click.echo(f"  ⚠  Failed to update chunk {chunk['id']}: {exc}", err=True)
                failed += 1

        click.echo(f"  {updated}/{len(chunks)} chunks done…", nl=False)
        click.echo("\r", nl=False)

    click.echo(f"✓  Reindex complete: {updated} updated, {failed} failed.")


# ── mcp ───────────────────────────────────────────────────────────────────────


@cli.command("mcp")
def mcp_server() -> None:
    """Start the Cerefox MCP server (stdio transport, legacy fallback).

    Add to Claude Desktop's claude_desktop_config.json:

    \b
    {
      "mcpServers": {
        "cerefox": {
          "command": "uv",
          "args": ["--directory", "/path/to/cerefox", "run", "cerefox", "mcp"]
        }
      }
    }

    Exposes two tools: cerefox_search and cerefox_ingest.
    """
    from cerefox.mcp_server import run  # noqa: PLC0415

    run()


# ── get-doc ───────────────────────────────────────────────────────────────────


@cli.command("get-doc")
@click.argument("document_id")
@click.option(
    "--version",
    "version_id",
    default=None,
    help="UUID of an archived version to retrieve (from 'cerefox list-versions').",
)
def get_doc(document_id: str, version_id: str | None) -> None:
    """Print the full content of a document to stdout.

    Pass --version <uuid> to retrieve an archived (previous) version.
    """
    settings = Settings()
    client = _get_client(settings)
    doc = client.get_document_content(document_id, version_id=version_id)
    if doc is None:
        label = f" (version {version_id})" if version_id else ""
        click.echo(f"Document{label} not found: {document_id}", err=True)
        raise SystemExit(1)
    click.echo(f"# {doc.get('doc_title', 'Untitled')}")
    click.echo(f"source: {doc.get('doc_source')} | chunks: {doc.get('chunk_count')} | chars: {doc.get('total_chars')}")
    click.echo("")
    click.echo(doc.get("full_content") or "")

    client.log_usage(
        operation="get_document", access_path="cli", requestor="user",
        document_id=document_id, result_count=1,
    )


# ── list-versions ─────────────────────────────────────────────────────────────


@cli.command("list-versions")
@click.argument("document_id")
def list_versions(document_id: str) -> None:
    """List all archived versions of a document.

    Each row shows the version number, UUID, source, size, and timestamp.
    Use the version UUID with 'cerefox get-doc --version <uuid>' to retrieve
    the content of a specific version.
    """
    settings = Settings()
    client = _get_client(settings)
    versions = client.list_document_versions(document_id)
    if not versions:
        click.echo("No archived versions found.")
        return
    click.echo(f"Versions for document {document_id}:")
    click.echo(f"{'v#':<4}  {'created_at':<27}  {'source':<10}  {'chunks':>6}  {'chars':>8}  version_id")
    click.echo("-" * 90)
    for v in versions:
        click.echo(
            f"v{v['version_number']:<3}  {v['created_at']:<27}  {v['source']:<10}  "
            f"{v['chunk_count']:>6}  {v['total_chars']:>8}  {v['version_id']}"
        )

    client.log_usage(
        operation="list_versions", access_path="cli", requestor="user",
        document_id=document_id, result_count=len(versions),
    )


# ── web ───────────────────────────────────────────────────────────────────────


@cli.command("web")
@click.option("--host", default="127.0.0.1", show_default=True, help="Bind address.")
@click.option("--port", default=8000, show_default=True, help="Port to listen on.")
@click.option("--reload", is_flag=True, default=False, help="Enable auto-reload (development).")
def web(host: str, port: int, reload: bool) -> None:
    """Start the Cerefox web UI."""
    import uvicorn

    click.echo(f"Starting Cerefox web UI at http://{host}:{port}")
    uvicorn.run(
        "cerefox.api.app:app",
        host=host,
        port=port,
        reload=reload,
    )
