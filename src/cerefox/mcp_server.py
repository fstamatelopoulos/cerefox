"""Cerefox MCP server (local stdio) — legacy fallback.

The **recommended** MCP path is the remote ``cerefox-mcp`` Supabase Edge Function
(Streamable HTTP). It requires no Python install, no local repo clone, and works
from Claude Code, Cursor, Claude Desktop (via supergateway), and other remote-
capable MCP clients.

This local stdio server is kept as a **legacy fallback** for environments where
a remote connection is not available or practical. It exposes the same
``cerefox_search``, ``cerefox_ingest``, and ``cerefox_list_metadata_keys``
tools as the remote Edge Function.

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
                "properties": {},
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
        return await _handle_list_metadata_keys(client)
    elif name == "cerefox_get_document":
        return await _handle_get_document(client, arguments)
    elif name == "cerefox_list_versions":
        return await _handle_list_versions(client, arguments)
    else:
        raise ValueError(f"Unknown tool: {name}")


async def _handle_search(
    client: Any, embedder: Any, settings: Any, arguments: dict
) -> list[types.TextContent]:
    query: str = arguments["query"]
    match_count: int = int(arguments.get("match_count", 5))
    project_name: str | None = arguments.get("project_name")

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
    )

    if not rows:
        return [types.TextContent(type="text", text="No results found.")]

    # Format results: full document content with title/score header
    parts: list[str] = []
    total_bytes = 0
    max_bytes = settings.max_response_bytes

    for row in rows:
        partial_note = (
            f" — partial ({row['chunk_count']} of {row['total_chars']:,} chars)"
            if row.get("is_partial")
            else ""
        )
        block = f"## {row['doc_title']} (score: {row['best_score']:.3f}{partial_note})\n\n{row['full_content']}"
        block_bytes = len(block.encode())
        if total_bytes + block_bytes > max_bytes:
            parts.append(f"## {row['doc_title']}\n[truncated — response size limit reached]")
            break
        parts.append(block)
        total_bytes += block_bytes

    return [types.TextContent(type="text", text="\n\n---\n\n".join(parts))]


async def _handle_ingest(client: Any, pipeline: Any, arguments: dict) -> list[types.TextContent]:
    result = pipeline.ingest_text(
        text=arguments["content"],
        title=arguments["title"],
        source=arguments.get("source", "agent"),
        project_name=arguments.get("project_name"),
        metadata=arguments.get("metadata") or {},
        update_existing=bool(arguments.get("update_if_exists", False)),
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
    if not versions:
        return [types.TextContent(type="text", text="No archived versions found for this document.")]
    lines = [f"Versions for document {document_id}:", ""]
    for v in versions:
        lines.append(
            f"  v{v['version_number']} — {v['created_at']} | source: {v['source']} | "
            f"{v['chunk_count']} chunks | {v['total_chars']} chars | id: {v['version_id']}"
        )
    return [types.TextContent(type="text", text="\n".join(lines))]


async def _handle_list_metadata_keys(client: Any) -> list[types.TextContent]:
    keys = client.list_metadata_keys()
    if not keys:
        return [types.TextContent(type="text", text="No metadata keys found across documents.")]
    return [types.TextContent(type="text", text=json.dumps(keys, indent=2))]


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
