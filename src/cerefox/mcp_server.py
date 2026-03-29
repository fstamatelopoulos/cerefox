"""Cerefox MCP server (local stdio).

The remote ``cerefox-mcp`` Supabase Edge Function (Streamable HTTP) is the easiest
setup -- no Python install, no local repo clone. But this local server has its own
advantages: zero Supabase Edge Function invocations (relevant for free-tier limits),
lower latency (no HTTPS round-trip), and offline capability.

Both paths expose the same
``cerefox_search``, ``cerefox_ingest``, ``cerefox_list_metadata_keys``,
``cerefox_get_document``, ``cerefox_list_versions``, ``cerefox_get_audit_log``,
``cerefox_list_projects``, and ``cerefox_metadata_search`` tools as the remote
Edge Function.

Run via::

    cerefox mcp

Claude Desktop config (~/.../claude_desktop_config.json)::

    {
      "mcpServers": {
        "cerefox": {
          "command": "uv",
          "args": ["--directory", "/path/to/cerefox", "run", "cerefox", "mcp"]
        }
      }
    }

The server reads CEREFOX_* settings from .env (same as the CLI).
No extra credentials or tokens needed — uses the local Python SDK directly.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import mcp.server.stdio
import mcp.types as types
from mcp.server import NotificationOptions, Server
from mcp.server.models import InitializationOptions

log = logging.getLogger(__name__)

server = Server("cerefox")


# ── Lazy dependency initialisation ────────────────────────────────────────────

_deps: dict[str, Any] | None = None


def _get_deps() -> dict[str, Any]:
    global _deps
    if _deps is not None:
        return _deps

    from cerefox.config import Settings
    from cerefox.db.client import CerefoxClient
    from cerefox.embeddings.cloud import CloudEmbedder
    from cerefox.ingestion.pipeline import IngestionPipeline

    settings = Settings()
    client = CerefoxClient(settings)
    embedder = CloudEmbedder(
        api_key=settings.get_embedder_api_key(),
        base_url=settings.get_embedder_base_url(),
        model=settings.get_embedder_model(),
        dimensions=settings.get_embedder_dimensions(),
    )
    pipeline = IngestionPipeline(client, embedder, settings)

    _deps = {
        "settings": settings,
        "client": client,
        "embedder": embedder,
        "pipeline": pipeline,
    }
    return _deps


# ── Tool definitions ───────────────────────────────────────────────────────────


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="cerefox_search",
            description=(
                "Search the Cerefox personal knowledge base. "
                "Returns complete documents ranked by hybrid (FTS + semantic) relevance. "
                "Always call this before answering questions about the user's notes, ideas, "
                "or stored knowledge."
            ),
            inputSchema={
                "type": "object",
                "required": ["query"],
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Natural-language search query",
                    },
                    "match_count": {
                        "type": "integer",
                        "default": 5,
                        "description": "Maximum number of documents to return",
                    },
                    "project_name": {
                        "type": "string",
                        "description": "Optional: filter results to a specific project",
                    },
                    "metadata_filter": {
                        "type": "object",
                        "description": (
                            "Optional JSONB containment filter. Only documents whose metadata "
                            "contains ALL specified key-value pairs are returned. "
                            'Example: {"type": "decision", "status": "active"}. '
                            "Call cerefox_list_metadata_keys first to discover available keys. "
                            "Omit to search all documents."
                        ),
                        "additionalProperties": {"type": "string"},
                    },
                    "max_bytes": {
                        "type": "integer",
                        "description": (
                            "Optional response size budget in bytes. Results are dropped whole "
                            "until the budget is satisfied; a truncated note is appended when "
                            "results are dropped. Defaults to the server maximum configured via "
                            "CEREFOX_MAX_RESPONSE_BYTES (default 200000). Pass a smaller value "
                            "if your context window is limited. Values above the server maximum "
                            "are silently capped."
                        ),
                    },
                    "requestor": {
                        "type": "string",
                        "description": (
                            'Name of the agent or user making this request (e.g., "Claude Code", '
                            '"archiver"). Recorded in the usage log. Defaults to "mcp-agent".'
                        ),
                    },
                },
            },
        ),
        types.Tool(
            name="cerefox_ingest",
            description=(
                "Save a note or document to the Cerefox knowledge base. "
                "Use this when the user asks you to remember something for future conversations."
            ),
            inputSchema={
                "type": "object",
                "required": ["title", "content"],
                "properties": {
                    "title": {"type": "string", "description": "Document title"},
                    "content": {
                        "type": "string",
                        "description": "Markdown content to store",
                    },
                    "project_name": {
                        "type": "string",
                        "description": "Optional: assign to a project (created if it doesn't exist)",
                    },
                    "source": {
                        "type": "string",
                        "default": "agent",
                        "description": "Origin label (default: 'agent')",
                    },
                    "metadata": {
                        "type": "object",
                        "description": "Optional arbitrary JSON metadata (e.g. tags)",
                    },
                    "update_if_exists": {
                        "type": "boolean",
                        "default": False,
                        "description": (
                            "When true, update an existing document with the same title "
                            "instead of creating a new one. Useful for keeping notes in sync "
                            "across multiple agent sessions."
                        ),
                    },
                    "author": {
                        "type": "string",
                        "description": (
                            'Name of the agent or tool performing the ingestion (e.g., "Claude Code", '
                            '"Cursor"). Recorded in the audit log for attribution. '
                            'Defaults to "mcp-agent" if not provided.'
                        ),
                    },
                },
            },
        ),
        types.Tool(
            name="cerefox_list_metadata_keys",
            description=(
                "List all metadata keys currently in use across documents in the "
                "Cerefox knowledge base. Returns each key with its document count "
                "and up to 5 example values. Useful for discovering what metadata "
                "fields exist before searching or ingesting."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "requestor": {
                        "type": "string",
                        "description": 'Name of the agent/user. Recorded in the usage log. Defaults to "mcp-agent".',
                    },
                },
            },
        ),
        types.Tool(
            name="cerefox_get_document",
            description=(
                "Retrieve the full content of a specific document by its ID. "
                "Optionally specify a version_id to retrieve an archived (previous) version. "
                "Use cerefox_list_versions first to see available versions. "
                "When search results show version_count > 0, the document has previous versions."
            ),
            inputSchema={
                "type": "object",
                "required": ["document_id"],
                "properties": {
                    "document_id": {
                        "type": "string",
                        "description": "UUID of the document to retrieve",
                    },
                    "version_id": {
                        "type": "string",
                        "description": (
                            "Optional UUID of an archived version. "
                            "Omit to get the current version."
                        ),
                    },
                    "requestor": {
                        "type": "string",
                        "description": 'Name of the agent/user. Recorded in the usage log. Defaults to "mcp-agent".',
                    },
                },
            },
        ),
        types.Tool(
            name="cerefox_list_versions",
            description=(
                "List all archived versions of a document. "
                "Returns version_number, version_id, source, size, and timestamp for each version. "
                "Pass version_id to cerefox_get_document to retrieve a specific version's content."
            ),
            inputSchema={
                "type": "object",
                "required": ["document_id"],
                "properties": {
                    "document_id": {
                        "type": "string",
                        "description": "UUID of the document",
                    },
                    "requestor": {
                        "type": "string",
                        "description": 'Name of the agent/user. Recorded in the usage log. Defaults to "mcp-agent".',
                    },
                },
            },
        ),
        types.Tool(
            name="cerefox_get_audit_log",
            description=(
                "Retrieve audit log entries showing who changed what and when. "
                "Supports filtering by document, author, operation type, and time range. "
                "Returns entries with document titles, author attribution, size changes, "
                "and descriptions."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "document_id": {
                        "type": "string",
                        "description": "Filter by document UUID (optional)",
                    },
                    "author": {
                        "type": "string",
                        "description": "Filter by author name (optional)",
                    },
                    "operation": {
                        "type": "string",
                        "description": (
                            "Filter by operation type: create, update-content, "
                            "update-metadata, delete, status-change, archive, "
                            "unarchive (optional)"
                        ),
                    },
                    "since": {
                        "type": "string",
                        "description": (
                            "ISO timestamp lower bound for temporal queries (optional)"
                        ),
                    },
                    "limit": {
                        "type": "integer",
                        "description": (
                            "Maximum number of entries to return (default: 50, max: 200)"
                        ),
                    },
                    "requestor": {
                        "type": "string",
                        "description": 'Name of the agent/user. Recorded in the usage log. Defaults to "mcp-agent".',
                    },
                },
            },
        ),
        types.Tool(
            name="cerefox_list_projects",
            description=(
                "List all projects with their names and IDs. Use this to discover "
                "available projects before filtering by project_name in other tools."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "requestor": {
                        "type": "string",
                        "description": 'Name of the agent/user. Recorded in the usage log. Defaults to "mcp-agent".',
                    },
                },
            },
        ),
        types.Tool(
            name="cerefox_metadata_search",
            description=(
                "Find documents by metadata key-value criteria without a text search term. "
                "Use to discover documents tagged with specific attributes, browse by "
                "taxonomy, or retrieve messages/tasks by type and status."
            ),
            inputSchema={
                "type": "object",
                "required": ["metadata_filter"],
                "properties": {
                    "metadata_filter": {
                        "type": "object",
                        "description": (
                            "Key-value pairs; ALL must match (AND semantics). "
                            'Example: {"type": "decision", "status": "active"}. '
                            "Call cerefox_list_metadata_keys first to discover available keys."
                        ),
                        "additionalProperties": {"type": "string"},
                    },
                    "project_name": {
                        "type": "string",
                        "description": "Restrict to a project by name (optional)",
                    },
                    "updated_since": {
                        "type": "string",
                        "description": "ISO-8601 timestamp; only docs updated on/after (optional)",
                    },
                    "created_since": {
                        "type": "string",
                        "description": "ISO-8601 timestamp; only docs created on/after (optional)",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results (default 10)",
                    },
                    "include_content": {
                        "type": "boolean",
                        "description": "Include full document text (default false)",
                    },
                    "max_bytes": {
                        "type": "integer",
                        "description": (
                            "Soft cap on total response bytes when include_content is true. "
                            "Defaults to server maximum."
                        ),
                    },
                    "requestor": {
                        "type": "string",
                        "description": 'Name of the agent/user. Recorded in the usage log. Defaults to "mcp-agent".',
                    },
                },
            },
        ),
    ]


# ── Tool execution ─────────────────────────────────────────────────────────────


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    deps = _get_deps()
    client = deps["client"]
    embedder = deps["embedder"]
    pipeline = deps["pipeline"]
    settings = deps["settings"]

    if name == "cerefox_search":
        return await _handle_search(client, embedder, settings, arguments)
    elif name == "cerefox_ingest":
        return await _handle_ingest(client, pipeline, arguments)
    elif name == "cerefox_list_metadata_keys":
        return await _handle_list_metadata_keys(client, arguments)
    elif name == "cerefox_get_document":
        return await _handle_get_document(client, arguments)
    elif name == "cerefox_list_versions":
        return await _handle_list_versions(client, arguments)
    elif name == "cerefox_get_audit_log":
        return await _handle_get_audit_log(client, arguments)
    elif name == "cerefox_list_projects":
        return await _handle_list_projects(client, arguments)
    elif name == "cerefox_metadata_search":
        return await _handle_metadata_search(client, settings, arguments)
    else:
        raise ValueError(f"Unknown tool: {name}")


async def _handle_search(
    client: Any, embedder: Any, settings: Any, arguments: dict
) -> list[types.TextContent]:
    query: str = arguments["query"]
    match_count: int = int(arguments.get("match_count", 5))
    project_name: str | None = arguments.get("project_name")
    metadata_filter: dict | None = arguments.get("metadata_filter") or None

    # Agent-requested limit capped at the server maximum (CEREFOX_MAX_RESPONSE_BYTES).
    # Agents may pass a smaller value to fit their context budget; they cannot exceed
    # the server ceiling. When not provided, the server maximum is used.
    server_max: int = settings.max_response_bytes
    requested: int | None = arguments.get("max_bytes")
    max_bytes: int = min(int(requested), server_max) if requested is not None else server_max

    # Resolve project name → ID if provided
    project_id: str | None = None
    if project_name:
        projects = client.list_projects()
        for p in projects:
            if p["name"].lower() == project_name.lower():
                project_id = p["id"]
                break
        if project_id is None:
            return [
                types.TextContent(
                    type="text",
                    text=f"Project not found: {project_name}",
                )
            ]

    # Embed the query
    embedding = embedder.embed(query)

    # Call the document-level hybrid search RPC
    rows = client.search_docs(
        query_text=query,
        query_embedding=embedding,
        match_count=match_count,
        alpha=0.7,
        project_id=project_id,
        min_score=settings.min_search_score,
        metadata_filter=metadata_filter,
    )

    if not rows:
        return [types.TextContent(type="text", text="No results found.")]

    # Format results: full document content with title/score header, capped at max_bytes.
    parts: list[str] = []
    total_bytes = 0
    truncated = False

    for row in rows:
        partial_note = (
            f" — partial ({row['chunk_count']} of {row['total_chars']:,} chars)"
            if row.get("is_partial")
            else ""
        )
        block = f"## {row['doc_title']} (score: {row['best_score']:.3f}{partial_note})\n\n{row['full_content']}"
        block_bytes = len(block.encode())
        if total_bytes + block_bytes > max_bytes:
            truncated = True
            break
        parts.append(block)
        total_bytes += block_bytes

    text = "\n\n---\n\n".join(parts)
    if truncated:
        text += f"\n\n[Results truncated at {total_bytes:,} bytes — response size limit reached. Use a more specific query, reduce match_count, or pass a larger max_bytes if your context allows.]"

    client.log_usage(
        operation="search", access_path="local-mcp", requestor=arguments.get("requestor") or "mcp-agent",
        query_text=query, project_id=project_id, result_count=len(parts),
    )

    return [types.TextContent(type="text", text=text)]


async def _handle_ingest(client: Any, pipeline: Any, arguments: dict) -> list[types.TextContent]:
    author = arguments.get("author") or "mcp-agent"
    result = pipeline.ingest_text(
        text=arguments["content"],
        title=arguments["title"],
        source=arguments.get("source", "agent"),
        project_name=arguments.get("project_name"),
        metadata=arguments.get("metadata") or {},
        update_existing=bool(arguments.get("update_if_exists", False)),
        author=author,
        author_type="agent",
    )

    if result.action == "skipped":
        msg = f"Skipped — identical content already in Cerefox: {result.title}"
    elif result.action == "updated" and result.reindexed:
        msg = (
            f"Updated (re-indexed): {result.title}\n"
            f"Document ID: {result.document_id}\n"
            f"Chunks: {result.chunk_count}\n"
            f"Total chars: {result.total_chars:,}"
        )
        if result.project_ids:
            msg += f"\nProject IDs: {', '.join(result.project_ids)}"
    elif result.action == "updated":
        msg = (
            f"Updated (metadata/title only — no re-index needed): {result.title}\n"
            f"Document ID: {result.document_id}\n"
            f"Chunks: {result.chunk_count}\n"
            f"Total chars: {result.total_chars:,}"
        )
        if result.project_ids:
            msg += f"\nProject IDs: {', '.join(result.project_ids)}"
    else:  # action == "created"
        msg = (
            f"Created: {result.title}\n"
            f"Document ID: {result.document_id}\n"
            f"Chunks: {result.chunk_count}\n"
            f"Total chars: {result.total_chars:,}"
        )
        if result.project_ids:
            msg += f"\nProject IDs: {', '.join(result.project_ids)}"

    if result.action != "skipped":
        client.log_usage(
            operation="ingest", access_path="local-mcp", requestor=author,
            document_id=result.document_id, result_count=result.chunk_count,
        )

    return [types.TextContent(type="text", text=msg)]


async def _handle_get_document(client: Any, arguments: dict) -> list[types.TextContent]:
    document_id = arguments.get("document_id", "")
    version_id = arguments.get("version_id")
    if not document_id:
        return [types.TextContent(type="text", text="Error: document_id is required.")]
    doc = client.get_document_content(document_id, version_id=version_id)
    if doc is None:
        label = f" (version {version_id})" if version_id else ""
        return [types.TextContent(type="text", text=f"Document{label} not found: {document_id}")]
    client.log_usage(
        operation="get_document", access_path="local-mcp", requestor=arguments.get("requestor") or "mcp-agent",
        document_id=document_id, result_count=1,
    )
    lines = [
        f"# {doc.get('doc_title', 'Untitled')}",
        f"source: {doc.get('doc_source', '')} | "
        f"chunks: {doc.get('chunk_count', 0)} | chars: {doc.get('total_chars', 0)}",
        "",
        doc.get("full_content") or "",
    ]
    return [types.TextContent(type="text", text="\n".join(lines))]


async def _handle_list_versions(client: Any, arguments: dict) -> list[types.TextContent]:
    document_id = arguments.get("document_id", "")
    if not document_id:
        return [types.TextContent(type="text", text="Error: document_id is required.")]
    versions = client.list_document_versions(document_id)
    client.log_usage(
        operation="list_versions", access_path="local-mcp", requestor=arguments.get("requestor") or "mcp-agent",
        document_id=document_id, result_count=len(versions),
    )
    if not versions:
        return [types.TextContent(type="text", text="No archived versions found for this document.")]
    lines = [f"Versions for document {document_id}:", ""]
    for v in versions:
        lines.append(
            f"  v{v['version_number']} — {v['created_at']} | source: {v['source']} | "
            f"{v['chunk_count']} chunks | {v['total_chars']} chars | id: {v['version_id']}"
        )
    return [types.TextContent(type="text", text="\n".join(lines))]


async def _handle_list_metadata_keys(client: Any, arguments: dict = {}) -> list[types.TextContent]:
    keys = client.list_metadata_keys()
    client.log_usage(
        operation="list_metadata_keys", access_path="local-mcp", requestor=arguments.get("requestor") or "mcp-agent",
        result_count=len(keys),
    )
    if not keys:
        return [types.TextContent(type="text", text="No metadata keys found across documents.")]
    return [types.TextContent(type="text", text=json.dumps(keys, indent=2))]


async def _handle_get_audit_log(client: Any, arguments: dict) -> list[types.TextContent]:
    document_id = arguments.get("document_id")
    author = arguments.get("author")
    operation = arguments.get("operation")
    since = arguments.get("since")
    limit = min(int(arguments.get("limit") or 50), 200)

    entries = client.list_audit_entries(
        document_id=document_id,
        author=author,
        operation=operation,
        since=since,
        limit=limit,
    )
    client.log_usage(
        operation="get_audit_log", access_path="local-mcp", requestor=arguments.get("requestor") or "mcp-agent",
        result_count=len(entries),
    )
    if not entries:
        return [types.TextContent(type="text", text="No audit log entries found.")]

    lines = [f"Audit log ({len(entries)} entries):", ""]
    for e in entries:
        doc_title = e.get("doc_title") or e.get("document_id") or "(deleted)"
        size_info = ""
        if e.get("size_before") is not None or e.get("size_after") is not None:
            size_info = f" | size: {e.get('size_before', '?')} -> {e.get('size_after', '?')}"
        lines.append(
            f"  [{e['created_at']}] {e['operation']} | {doc_title} | "
            f"by {e['author']} ({e['author_type']}){size_info}"
        )
        if e.get("description"):
            lines.append(f"    {e['description']}")
    return [types.TextContent(type="text", text="\n".join(lines))]


async def _handle_list_projects(client: Any, arguments: dict = {}) -> list[types.TextContent]:
    projects = client.list_projects_rpc()
    client.log_usage(
        operation="list_projects", access_path="local-mcp", requestor=arguments.get("requestor") or "mcp-agent",
        result_count=len(projects),
    )
    if not projects:
        return [types.TextContent(type="text", text="No projects found.")]
    lines = [f"Projects ({len(projects)}):", ""]
    for p in projects:
        desc = f" -- {p['description']}" if p.get("description") else ""
        lines.append(f"  - {p['name']} (id: {p['id']}){desc}")
    return [types.TextContent(type="text", text="\n".join(lines))]


async def _handle_metadata_search(
    client: Any, settings: Any, arguments: dict
) -> list[types.TextContent]:
    metadata_filter = arguments.get("metadata_filter")
    if not metadata_filter or not isinstance(metadata_filter, dict):
        return [types.TextContent(type="text", text="Error: metadata_filter is required (JSON object).")]

    project_name: str | None = arguments.get("project_name")
    project_id: str | None = None
    if project_name:
        projects = client.list_projects()
        for p in projects:
            if p["name"].lower() == project_name.lower():
                project_id = p["id"]
                break
        if project_id is None:
            return [types.TextContent(type="text", text=f"Project not found: {project_name}")]

    include_content = bool(arguments.get("include_content", False))
    server_max: int = settings.max_response_bytes
    requested: int | None = arguments.get("max_bytes")
    max_bytes: int | None = (
        min(int(requested), server_max) if requested is not None else server_max
    ) if include_content else None

    rows = client.metadata_search(
        metadata_filter=metadata_filter,
        project_id=project_id,
        updated_since=arguments.get("updated_since"),
        created_since=arguments.get("created_since"),
        limit=int(arguments.get("limit", 10)),
        include_content=include_content,
        max_bytes=max_bytes,
    )

    client.log_usage(
        operation="metadata_search", access_path="local-mcp", requestor=arguments.get("requestor") or "mcp-agent",
        query_text=json.dumps(metadata_filter), project_id=project_id,
        result_count=len(rows),
    )

    if not rows:
        return [types.TextContent(type="text", text="No documents match the metadata filter.")]

    parts: list[str] = []
    for row in rows:
        proj_names = row.get("project_names") or []
        projects_str = f" | projects: {', '.join(proj_names)}" if proj_names else ""
        meta = ", ".join(f"{k}={v}" for k, v in (row.get("doc_metadata") or {}).items())
        header = (
            f"## {row['title']} [id: {row['document_id']}]\n"
            f"{meta}{projects_str} | {row.get('total_chars', 0)} chars | "
            f"{row.get('review_status', 'approved')} | updated {str(row.get('updated_at', ''))[:10]}"
        )
        if include_content and row.get("content"):
            parts.append(f"{header}\n\n{row['content']}")
        else:
            parts.append(header)

    return [types.TextContent(type="text", text="\n\n---\n\n".join(parts))]


# ── Entry point ────────────────────────────────────────────────────────────────


async def _run() -> None:
    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="cerefox",
                server_version="0.1.0",
                capabilities=server.get_capabilities(
                    notification_options=NotificationOptions(),
                    experimental_capabilities={},
                ),
            ),
        )


def run() -> None:
    """Start the Cerefox MCP server over stdio."""
    asyncio.run(_run())
