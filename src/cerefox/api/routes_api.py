"""JSON API routes for the React SPA frontend.

All endpoints live under /api/v1/ and return JSON responses.
These are consumed by the React frontend (and can be used by any HTTP client).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from cerefox.api.deps import get_client, get_embedder, get_settings
from cerefox.config import Settings
from cerefox.db.client import CerefoxClient
from cerefox.embeddings.base import Embedder
from cerefox.retrieval.search import DocResult, DocSearchResponse, SearchClient

logger = logging.getLogger(__name__)
api_router = APIRouter(prefix="/api/v1", tags=["api"])


# ── Response models ──────────────────────────────────────────────────────────


class DocSearchResultResponse(BaseModel):
    document_id: str
    doc_title: str
    doc_source: str | None
    doc_metadata: dict[str, Any]
    doc_project_ids: list[str]
    best_score: float
    best_chunk_heading_path: list[str]
    full_content: str
    chunk_count: int
    total_chars: int
    doc_updated_at: str | None
    is_partial: bool


class ChunkSearchResultResponse(BaseModel):
    chunk_id: str
    document_id: str
    chunk_index: int
    title: str
    content: str
    heading_path: list[str]
    heading_level: int | None
    score: float
    doc_title: str
    doc_source: str | None
    doc_project_ids: list[str]
    doc_metadata: dict[str, Any]


class SearchResponse(BaseModel):
    results: list[dict[str, Any]]
    query: str
    mode: str
    total_found: int
    response_bytes: int
    truncated: bool


class ProjectResponse(BaseModel):
    id: str
    name: str
    description: str | None
    created_at: str
    updated_at: str


class MetadataKeyResponse(BaseModel):
    key: str
    doc_count: int
    examples: list[str]


class DocumentResponse(BaseModel):
    document_id: str
    full_content: str
    doc_title: str
    doc_source: str | None
    doc_metadata: dict[str, Any]
    total_chars: int
    chunk_count: int


class DocumentVersionResponse(BaseModel):
    version_id: str
    version_number: int
    source: str
    chunk_count: int
    total_chars: int
    created_at: str


# ── Search ───────────────────────────────────────────────────────────────────


@api_router.get("/search")
def api_search(
    q: str = "",
    mode: str = "docs",
    project_id: str = "",
    count: int = Query(default=10, ge=1, le=50),
    metadata_filter: str = "",
    client: CerefoxClient = Depends(get_client),
    embedder: Embedder | None = Depends(get_embedder),
    settings: Settings = Depends(get_settings),
) -> SearchResponse:
    """Unified search endpoint supporting all 4 search modes + browse."""
    # Parse metadata filter JSON
    mf: dict[str, str] | None = None
    if metadata_filter:
        try:
            mf = json.loads(metadata_filter)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid metadata_filter JSON")

    pid = project_id or None

    # Browse mode: project selected but no query
    if pid and not q:
        raw = client.list_documents(limit=100, project_id=pid)
        browse_results: list[dict[str, Any]] = [
            {
                "document_id": d["id"],
                "doc_title": d.get("title") or "",
                "doc_source": d.get("source") or "",
                "doc_metadata": d.get("metadata") or {},
                "doc_project_ids": [pid],
                "best_score": 0.0,
                "best_chunk_heading_path": [],
                "full_content": "",
                "chunk_count": d.get("chunk_count") or 0,
                "total_chars": d.get("total_chars") or 0,
                "doc_updated_at": d.get("updated_at") or "",
                "is_partial": False,
            }
            for d in raw
        ]
        return SearchResponse(
            results=browse_results,
            query="",
            mode="docs",
            total_found=len(browse_results),
            response_bytes=0,
            truncated=len(browse_results) == 100,
        )

    if not q:
        return SearchResponse(
            results=[], query="", mode=mode,
            total_found=0, response_bytes=0, truncated=False,
        )

    # Search mode
    sc = SearchClient(client, embedder, settings)

    if mode == "fts":
        resp = sc.fts(q, match_count=count, project_id=pid,
                      metadata_filter=mf, max_bytes=None)
    elif mode == "semantic":
        if embedder is None:
            raise HTTPException(status_code=503, detail="Embedder not available")
        resp = sc.semantic(q, match_count=count, project_id=pid,
                           metadata_filter=mf, max_bytes=None)
    elif mode == "docs":
        if embedder is None:
            raise HTTPException(status_code=503, detail="Embedder not available")
        resp = sc.search_docs(q, match_count=min(count, 5), project_id=pid,
                              metadata_filter=mf, max_bytes=None)
    else:  # hybrid
        if embedder is None:
            raise HTTPException(status_code=503, detail="Embedder not available")
        resp = sc.hybrid(q, match_count=count, project_id=pid,
                         metadata_filter=mf, max_bytes=None)

    # Serialize results to dicts
    result_dicts: list[dict[str, Any]] = []
    if isinstance(resp, DocSearchResponse):
        for r in resp.results:
            assert isinstance(r, DocResult)
            result_dicts.append({
                "document_id": r.document_id,
                "doc_title": r.doc_title,
                "doc_source": r.doc_source,
                "doc_metadata": r.doc_metadata,
                "doc_project_ids": r.doc_project_ids,
                "best_score": r.best_score,
                "best_chunk_heading_path": r.best_chunk_heading_path,
                "full_content": r.full_content,
                "chunk_count": r.chunk_count,
                "total_chars": r.total_chars,
                "doc_updated_at": r.doc_updated_at,
                "is_partial": r.is_partial,
            })
    else:
        for r in resp.results:
            result_dicts.append({
                "chunk_id": r.chunk_id,
                "document_id": r.document_id,
                "chunk_index": r.chunk_index,
                "title": r.title,
                "content": r.content,
                "heading_path": r.heading_path,
                "heading_level": r.heading_level,
                "score": r.score,
                "doc_title": r.doc_title,
                "doc_source": r.doc_source,
                "doc_project_ids": r.doc_project_ids,
                "doc_metadata": r.doc_metadata,
            })

    return SearchResponse(
        results=result_dicts,
        query=q,
        mode=mode,
        total_found=resp.total_found,
        response_bytes=resp.response_bytes,
        truncated=resp.truncated,
    )


# ── Projects ─────────────────────────────────────────────────────────────────


@api_router.get("/projects")
def api_list_projects(
    client: CerefoxClient = Depends(get_client),
) -> list[ProjectResponse]:
    """List all projects."""
    raw = client.list_projects()
    return [
        ProjectResponse(
            id=p["id"],
            name=p["name"],
            description=p.get("description"),
            created_at=p.get("created_at", ""),
            updated_at=p.get("updated_at", ""),
        )
        for p in raw
    ]


# ── Metadata ─────────────────────────────────────────────────────────────────


@api_router.get("/metadata-keys")
def api_list_metadata_keys(
    client: CerefoxClient = Depends(get_client),
) -> list[MetadataKeyResponse]:
    """List metadata keys in use, with doc counts and example values."""
    raw = client.list_metadata_keys()
    return [
        MetadataKeyResponse(
            key=row["key"],
            doc_count=row.get("doc_count", 0),
            examples=row.get("example_values", []),
        )
        for row in raw
    ]


# ── Documents ────────────────────────────────────────────────────────────────


@api_router.get("/documents/{document_id}")
def api_get_document(
    document_id: str,
    version_id: str = "",
    client: CerefoxClient = Depends(get_client),
) -> DocumentResponse:
    """Get full document content (current or by version_id)."""
    vid = version_id or None
    doc = client.reconstruct_document(document_id, version_id=vid)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    meta = client.get_document_by_id(document_id)
    return DocumentResponse(
        document_id=document_id,
        full_content=doc["full_content"],
        doc_title=doc.get("doc_title") or meta.get("title", "") if meta else "",
        doc_source=doc.get("doc_source") or (meta.get("source") if meta else None),
        doc_metadata=meta.get("metadata", {}) if meta else {},
        total_chars=doc.get("total_chars", 0),
        chunk_count=doc.get("chunk_count", 0),
    )


@api_router.get("/documents/{document_id}/versions")
def api_list_versions(
    document_id: str,
    client: CerefoxClient = Depends(get_client),
) -> list[DocumentVersionResponse]:
    """List archived versions of a document."""
    raw = client.list_document_versions(document_id)
    return [
        DocumentVersionResponse(
            version_id=v["version_id"],
            version_number=v["version_number"],
            source=v.get("source", ""),
            chunk_count=v.get("chunk_count", 0),
            total_chars=v.get("total_chars", 0),
            created_at=v.get("created_at", ""),
        )
        for v in raw
    ]
