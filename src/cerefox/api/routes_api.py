"""JSON API routes for the React SPA frontend.

All endpoints live under /api/v1/ and return JSON responses.
These are consumed by the React frontend (and can be used by any HTTP client).
"""

from __future__ import annotations

import json
import logging
import os
import re
import unicodedata
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from cerefox.api.deps import get_client, get_embedder, get_settings
from cerefox.config import Settings
from cerefox.db.client import CerefoxClient
from cerefox.embeddings.base import Embedder
from cerefox.ingestion.pipeline import IngestionPipeline
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
    doc_project_names: list[str] = []
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
    doc_project_names: list[str] = []
    doc_metadata: dict[str, Any]


class MetadataSearchResultResponse(BaseModel):
    document_id: str
    title: str
    doc_metadata: dict[str, Any]
    review_status: str
    source: str | None
    created_at: str
    updated_at: str
    total_chars: int
    chunk_count: int
    project_ids: list[str] = []
    project_names: list[str] = []
    version_count: int
    content: str | None = None


class MetadataSearchRequest(BaseModel):
    metadata_filter: dict[str, Any]
    project_id: str | None = None
    updated_since: str | None = None
    created_since: str | None = None
    limit: int = 10
    include_content: bool = False


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
    description: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


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
    archived: bool = False
    created_at: str


# ── Search ───────────────────────────────────────────────────────────────────


@api_router.get("/search")
def api_search(
    q: str = "",
    mode: str = "docs",
    project_id: str = "",
    count: int = Query(default=10, ge=1, le=50),
    metadata_filter: str = "",
    review_status: str = "",
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

    # Post-filter by review_status (docs mode only -- chunk modes don't have it)
    if review_status and review_status in ("approved", "pending_review") and mode == "docs":
        doc_ids = [r["document_id"] for r in result_dicts]
        if doc_ids:
            status_map = {}
            for did in doc_ids:
                doc_record = client.get_document_by_id(did)
                if doc_record:
                    status_map[did] = doc_record.get("review_status", "approved")
            result_dicts = [
                r for r in result_dicts if status_map.get(r["document_id"]) == review_status
            ]

    client.log_usage(
        operation="search", access_path="webapp", requestor="user",
        query_text=q, project_id=pid, result_count=len(result_dicts),
    )

    return SearchResponse(
        results=result_dicts,
        query=q,
        mode=mode,
        total_found=len(result_dicts),
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


@api_router.post("/documents/metadata-search", response_model=list[MetadataSearchResultResponse])
def api_metadata_search(
    body: MetadataSearchRequest,
    client: CerefoxClient = Depends(get_client),
) -> list[MetadataSearchResultResponse]:
    """Search documents by metadata key-value criteria without a text search term."""
    rows = client.metadata_search(
        metadata_filter=body.metadata_filter,
        project_id=body.project_id,
        updated_since=body.updated_since,
        created_since=body.created_since,
        limit=body.limit,
        include_content=body.include_content,
    )
    client.log_usage(
        operation="metadata_search", access_path="webapp", requestor="user",
        query_text=json.dumps(body.metadata_filter), project_id=body.project_id,
        result_count=len(rows),
    )
    return [
        MetadataSearchResultResponse(
            document_id=row["document_id"],
            title=row.get("title", ""),
            doc_metadata=row.get("doc_metadata", {}),
            review_status=row.get("review_status", "approved"),
            source=row.get("source"),
            created_at=str(row.get("created_at", "")),
            updated_at=str(row.get("updated_at", "")),
            total_chars=row.get("total_chars", 0),
            chunk_count=row.get("chunk_count", 0),
            project_ids=row.get("project_ids", []),
            project_names=row.get("project_names", []),
            version_count=row.get("version_count", 0),
            content=row.get("content"),
        )
        for row in rows
    ]


# ── Documents ────────────────────────────────────────────────────────────────


# ── Dashboard ────────────────────────────────────────────────────────────────


class DashboardDocResponse(BaseModel):
    id: str
    title: str
    source: str | None = None
    chunk_count: int = 0
    total_chars: int = 0
    review_status: str = "approved"
    updated_at: str | None = None
    project_ids: list[str] = []


class DashboardResponse(BaseModel):
    doc_count: int
    project_count: int
    recent_docs: list[DashboardDocResponse]
    projects: list[ProjectResponse]
    project_doc_counts: dict[str, int] = {}


@api_router.get("/dashboard")
def api_dashboard(
    client: CerefoxClient = Depends(get_client),
) -> DashboardResponse:
    """Dashboard stats and recent documents."""
    recent_docs = client.list_documents(limit=10)
    projects = client.list_projects()
    doc_count = client.count_documents()
    project_ids = [p["id"] for p in projects]
    doc_projects_map = client.get_projects_for_documents(
        [d["id"] for d in recent_docs], projects
    )
    project_doc_counts = client.get_project_doc_counts(project_ids)

    docs_response = []
    for d in recent_docs:
        pid_list = [p["id"] for p in doc_projects_map.get(d["id"], [])]
        docs_response.append(DashboardDocResponse(
            id=d["id"],
            title=d.get("title") or "",
            source=d.get("source"),
            chunk_count=d.get("chunk_count") or 0,
            total_chars=d.get("total_chars") or 0,
            review_status=d.get("review_status", "approved"),
            updated_at=d.get("updated_at"),
            project_ids=pid_list,
        ))

    projects_response = [
        ProjectResponse(
            id=p["id"], name=p["name"], description=p.get("description"),
            created_at=p.get("created_at", ""), updated_at=p.get("updated_at", ""),
        )
        for p in projects
    ]

    return DashboardResponse(
        doc_count=doc_count,
        project_count=len(projects),
        recent_docs=docs_response,
        projects=projects_response,
        project_doc_counts=project_doc_counts,
    )


@api_router.get("/projects/{project_id}/documents")
def api_project_documents(
    project_id: str,
    client: CerefoxClient = Depends(get_client),
) -> list[DashboardDocResponse]:
    """List all documents assigned to a project."""
    docs = client.list_documents(project_id=project_id)
    projects = client.list_projects()
    doc_projects_map = client.get_projects_for_documents(
        [d["id"] for d in docs], projects
    )
    return [
        DashboardDocResponse(
            id=d["id"],
            title=d.get("title") or "",
            source=d.get("source"),
            chunk_count=d.get("chunk_count") or 0,
            total_chars=d.get("total_chars") or 0,
            review_status=d.get("review_status", "approved"),
            updated_at=d.get("updated_at"),
            project_ids=[p["id"] for p in doc_projects_map.get(d["id"], [])],
        )
        for d in docs
    ]


# ── Documents ────────────────────────────────────────────────────────────────


class DocumentDetailResponse(BaseModel):
    document_id: str
    full_content: str
    doc_title: str
    doc_source: str | None = None
    doc_metadata: dict[str, Any] = {}
    total_chars: int = 0
    chunk_count: int = 0
    project_ids: list[str] = []
    review_status: str = "approved"
    created_at: str | None = None
    updated_at: str | None = None
    versions: list[DocumentVersionResponse] = []


class ChunkResponse(BaseModel):
    chunk_id: str
    document_id: str
    chunk_index: int
    title: str
    content: str
    heading_path: list[str] = []
    heading_level: int | None = None
    char_count: int = 0


class IngestRequest(BaseModel):
    mode: str  # "paste" or "file"
    title: str = ""
    content: str = ""
    update_existing: bool = False
    project_ids: list[str] = []
    metadata: dict[str, str] = {}


class IngestResponse(BaseModel):
    success: bool
    document_id: str | None = None
    title: str = ""
    skipped: bool = False
    updated: bool = False
    error: str | None = None


class EditRequest(BaseModel):
    title: str
    content: str
    project_ids: list[str] = []
    metadata: dict[str, str] = {}


class EditResponse(BaseModel):
    success: bool
    reindexed: bool = False
    error: str | None = None


@api_router.get("/documents/trash")
def api_list_trash(
    limit: int = 50,
    client: CerefoxClient = Depends(get_client),
) -> list[dict[str, Any]]:
    """List soft-deleted documents (trash bin)."""
    return client.list_deleted_documents(limit=limit)


@api_router.get("/documents/{document_id}")
def api_get_document(
    document_id: str,
    version_id: str = "",
    client: CerefoxClient = Depends(get_client),
) -> DocumentDetailResponse:
    """Get full document content with metadata, projects, and versions."""
    vid = version_id or None
    if vid:
        doc = client.get_document_content(document_id, version_id=vid)
    else:
        doc = client.reconstruct_doc(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    meta = client.get_document_by_id(document_id)
    project_ids = client.get_document_project_ids(document_id)
    versions = client.list_document_versions(document_id)

    return DocumentDetailResponse(
        document_id=document_id,
        full_content=doc.get("full_content") or "",
        doc_title=doc.get("doc_title") or (meta.get("title", "") if meta else ""),
        doc_source=doc.get("doc_source") or (meta.get("source") if meta else None),
        doc_metadata=meta.get("metadata", {}) if meta else {},
        total_chars=doc.get("total_chars", 0),
        chunk_count=doc.get("chunk_count", 0),
        project_ids=project_ids,
        review_status=meta.get("review_status", "approved") if meta else "approved",
        created_at=meta.get("created_at") if meta else None,
        updated_at=meta.get("updated_at") if meta else None,
        versions=[
            DocumentVersionResponse(
                version_id=v["version_id"],
                version_number=v["version_number"],
                source=v.get("source", ""),
                chunk_count=v.get("chunk_count", 0),
                total_chars=v.get("total_chars", 0),
                archived=v.get("archived", False),
                created_at=v.get("created_at", ""),
            )
            for v in versions
        ],
    )


@api_router.get("/documents/{document_id}/chunks")
def api_get_chunks(
    document_id: str,
    client: CerefoxClient = Depends(get_client),
) -> list[ChunkResponse]:
    """Get all chunks for a document."""
    raw = client.list_chunks_for_document(document_id)
    return [
        ChunkResponse(
            chunk_id=c["id"],
            document_id=document_id,
            chunk_index=c.get("chunk_index", 0),
            title=c.get("title", ""),
            content=c.get("content", ""),
            heading_path=c.get("heading_path", []),
            heading_level=c.get("heading_level"),
            char_count=c.get("char_count", 0),
        )
        for c in raw
    ]


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


def _title_to_filename(title: str, max_len: int = 80) -> str:
    """Return a filesystem- and HTTP-header-safe filename from a document title."""
    _UNICODE_MAP = str.maketrans({
        "\u2014": "-", "\u2013": "-",
        "\u2018": "'", "\u2019": "'",
        "\u201c": '"', "\u201d": '"',
        "\u2026": "...", "\u00b7": "-",
    })
    name = title.translate(_UNICODE_MAP)
    name = unicodedata.normalize("NFKD", name).encode("ascii", errors="ignore").decode("ascii")
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(". ")
    return (name or "document")[:max_len]


@api_router.get("/documents/{document_id}/download")
def api_download_document(
    document_id: str,
    version_id: str | None = Query(None),
    client: CerefoxClient = Depends(get_client),
) -> Response:
    """Download document as .md file."""
    if version_id:
        doc = client.get_document_content(document_id, version_id=version_id)
    else:
        doc = client.reconstruct_doc(document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")

    content = doc.get("full_content") or ""
    doc_record = client.get_document_by_id(document_id)

    source_path = (doc_record or {}).get("source_path") or ""
    base = os.path.basename(source_path) if source_path else ""
    if not base:
        title = (doc_record or {}).get("title") or "document"
        base = f"{_title_to_filename(title)}.md"

    if version_id:
        versions = client.list_document_versions(document_id)
        ver = next((v for v in versions if v.get("version_id") == version_id), None)
        if ver:
            ver_num = ver.get("version_number", "")
            ver_date = (ver.get("created_at") or "")[:10]
            stem = base[:-3] if base.endswith(".md") else base
            base = f"{stem} v{ver_num} - {ver_date}.md"

    return Response(
        content=content,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{base}"'},
    )


@api_router.post("/documents/{document_id}/edit")
def api_edit_document(
    document_id: str,
    body: EditRequest,
    client: CerefoxClient = Depends(get_client),
    embedder: Embedder | None = Depends(get_embedder),
    settings: Settings = Depends(get_settings),
) -> EditResponse:
    """Update document title, content, projects, and metadata."""
    if embedder is None:
        raise HTTPException(status_code=503, detail="Embedder not available")

    try:
        pipeline = IngestionPipeline(client, embedder, settings)
        result = pipeline.update_document(
            document_id=document_id,
            text=body.content.strip(),
            title=body.title.strip(),
            project_ids=body.project_ids if body.project_ids else None,
            metadata=body.metadata if body.metadata else None,
            author="web-ui",
            author_type="user",
        )
        return EditResponse(success=True, reindexed=result.reindexed)
    except Exception as exc:
        return EditResponse(success=False, error=str(exc))


@api_router.delete("/documents/{document_id}")
def api_delete_document(
    document_id: str,
    client: CerefoxClient = Depends(get_client),
) -> dict[str, bool]:
    """Soft-delete a document (moves to trash, recoverable)."""
    try:
        client.delete_document(document_id, author="web-ui", author_type="user")
        return {"success": True}
    except Exception as exc:
        logger.error("delete_document %s failed: %s", document_id, exc)
        raise HTTPException(status_code=500, detail=str(exc))


@api_router.post("/documents/{document_id}/restore")
def api_restore_document(
    document_id: str,
    client: CerefoxClient = Depends(get_client),
) -> dict[str, bool]:
    """Restore a soft-deleted document from trash."""
    try:
        client.restore_document(document_id, author="web-ui", author_type="user")
        return {"success": True}
    except Exception as exc:
        logger.error("restore_document %s failed: %s", document_id, exc)
        raise HTTPException(status_code=500, detail=str(exc))


@api_router.delete("/documents/{document_id}/purge")
def api_purge_document(
    document_id: str,
    client: CerefoxClient = Depends(get_client),
) -> dict[str, bool]:
    """Permanently delete a soft-deleted document (irreversible)."""
    try:
        client.purge_document(document_id, author="web-ui", author_type="user")
        return {"success": True}
    except Exception as exc:
        logger.error("purge_document %s failed: %s", document_id, exc)
        raise HTTPException(status_code=500, detail=str(exc))


@api_router.post("/documents/{document_id}/upload")
async def api_upload_content(
    document_id: str,
    file: UploadFile = File(...),
    client: CerefoxClient = Depends(get_client),
    embedder: Embedder | None = Depends(get_embedder),
    settings: Settings = Depends(get_settings),
) -> EditResponse:
    """Replace document content by uploading a new file."""
    if embedder is None:
        raise HTTPException(status_code=503, detail="Embedder not available")

    raw = await file.read()
    text = raw.decode("utf-8", errors="replace")

    existing = client.get_document_by_id(document_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Document not found")

    try:
        pipeline = IngestionPipeline(client, embedder, settings)
        result = pipeline.update_document(
            document_id=document_id,
            text=text,
            title=existing.get("title", file.filename or "Untitled"),
            author="web-ui",
            author_type="user",
        )
        return EditResponse(success=True, reindexed=result.reindexed)
    except Exception as exc:
        return EditResponse(success=False, error=str(exc))


# ── Ingest ───────────────────────────────────────────────────────────────────


@api_router.post("/ingest")
def api_ingest_paste(
    body: IngestRequest,
    client: CerefoxClient = Depends(get_client),
    embedder: Embedder | None = Depends(get_embedder),
    settings: Settings = Depends(get_settings),
) -> IngestResponse:
    """Ingest a document from paste content."""
    if embedder is None:
        raise HTTPException(status_code=503, detail="Embedder not available")

    if not body.title.strip():
        return IngestResponse(success=False, error="Title is required.")
    if not body.content.strip():
        return IngestResponse(success=False, error="Content cannot be empty.")

    try:
        pipeline = IngestionPipeline(client, embedder, settings)
        res = pipeline.ingest_text(
            body.content.strip(),
            body.title.strip(),
            project_ids=body.project_ids if body.project_ids else None,
            metadata=body.metadata if body.metadata else None,
            update_existing=body.update_existing,
            author="web-ui",
            author_type="user",
        )
        client.log_usage(
            operation="ingest", access_path="webapp", requestor="user",
            document_id=res.document_id, result_count=res.chunk_count,
        )
        return IngestResponse(
            success=not res.skipped,
            document_id=res.document_id,
            title=res.title,
            skipped=res.skipped,
            updated=res.reindexed,
        )
    except Exception as exc:
        return IngestResponse(success=False, error=str(exc))


@api_router.post("/ingest/file")
async def api_ingest_file(
    file: UploadFile = File(...),
    title: str = "",
    update_existing: bool = False,
    project_ids: str = "",
    metadata: str = "",
    client: CerefoxClient = Depends(get_client),
    embedder: Embedder | None = Depends(get_embedder),
    settings: Settings = Depends(get_settings),
) -> IngestResponse:
    """Ingest a document from file upload."""
    if embedder is None:
        raise HTTPException(status_code=503, detail="Embedder not available")

    raw = await file.read()
    text = raw.decode("utf-8", errors="replace")
    doc_title = title.strip() or file.filename or "Untitled"

    pids = [p.strip() for p in project_ids.split(",") if p.strip()] if project_ids else None
    meta: dict[str, str] | None = None
    if metadata:
        try:
            meta = json.loads(metadata)
        except json.JSONDecodeError:
            pass

    try:
        pipeline = IngestionPipeline(client, embedder, settings)
        res = pipeline.ingest_text(
            text, doc_title, source="file", source_path=file.filename,
            project_ids=pids, metadata=meta,
            update_existing=update_existing,
            author="web-ui",
            author_type="user",
        )
        return IngestResponse(
            success=not res.skipped,
            document_id=res.document_id,
            title=res.title,
            skipped=res.skipped,
            updated=res.reindexed,
        )
    except Exception as exc:
        return IngestResponse(success=False, error=str(exc))


# ── Check filename ───────────────────────────────────────────────────────────


class FilenameCheckResponse(BaseModel):
    exists: bool
    document_id: str | None = None
    title: str | None = None
    updated_at: str | None = None


@api_router.get("/check-filename")
def api_check_filename(
    filename: str = Query(""),
    client: CerefoxClient = Depends(get_client),
) -> FilenameCheckResponse:
    """Check if a document with this filename already exists."""
    if not filename:
        return FilenameCheckResponse(exists=False)
    try:
        doc = client.find_document_by_source_path(filename)
        if doc:
            return FilenameCheckResponse(
                exists=True,
                document_id=doc.get("id"),
                title=doc.get("title"),
                updated_at=doc.get("updated_at"),
            )
    except Exception:
        pass
    return FilenameCheckResponse(exists=False)


# ── Projects CRUD ────────────────────────────────────────────────────────────


class CreateProjectRequest(BaseModel):
    name: str
    description: str = ""


@api_router.post("/projects")
def api_create_project(
    body: CreateProjectRequest,
    client: CerefoxClient = Depends(get_client),
) -> ProjectResponse:
    """Create a new project."""
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Project name is required")
    try:
        result = client.create_project(body.name.strip(), body.description.strip())
        return ProjectResponse(
            id=result["id"],
            name=result["name"],
            description=result.get("description"),
            created_at=result.get("created_at", ""),
            updated_at=result.get("updated_at", ""),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@api_router.put("/projects/{project_id}")
def api_update_project(
    project_id: str,
    body: CreateProjectRequest,
    client: CerefoxClient = Depends(get_client),
) -> ProjectResponse:
    """Update a project's name and description."""
    try:
        result = client.update_project(
            project_id, {"name": body.name.strip(), "description": body.description.strip()}
        )
        return ProjectResponse(
            id=result["id"],
            name=result["name"],
            description=result.get("description"),
            created_at=result.get("created_at", ""),
            updated_at=result.get("updated_at", ""),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@api_router.delete("/projects/{project_id}")
def api_delete_project(
    project_id: str,
    client: CerefoxClient = Depends(get_client),
) -> dict[str, bool]:
    """Delete a project."""
    try:
        client.delete_project(project_id)
        return {"success": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Audit log ────────────────────────────────────────────────────────────────


class AuditEntryResponse(BaseModel):
    id: str
    document_id: str | None = None
    doc_title: str | None = None
    version_id: str | None = None
    operation: str
    author: str
    author_type: str
    size_before: int | None = None
    size_after: int | None = None
    description: str = ""
    created_at: str


@api_router.get("/audit-log")
def api_list_audit_entries(
    document_id: str | None = Query(None),
    author: str | None = Query(None),
    operation: str | None = Query(None),
    since: str | None = Query(None),
    until: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    client: CerefoxClient = Depends(get_client),
) -> list[AuditEntryResponse]:
    """List audit log entries with optional filters.

    Supports temporal queries ("what changed since X"), author filtering,
    operation filtering, and document scoping.
    """
    raw = client.list_audit_entries(
        document_id=document_id,
        author=author,
        operation=operation,
        since=since,
        until=until,
        limit=limit,
    )
    return [
        AuditEntryResponse(
            id=e["id"],
            document_id=e.get("document_id"),
            doc_title=e.get("doc_title"),
            version_id=e.get("version_id"),
            operation=e["operation"],
            author=e.get("author", "unknown"),
            author_type=e.get("author_type", "user"),
            size_before=e.get("size_before"),
            size_after=e.get("size_after"),
            description=e.get("description", ""),
            created_at=e.get("created_at", ""),
        )
        for e in raw
    ]


# ── Review status ────────────────────────────────────────────────────────────


class ReviewStatusRequest(BaseModel):
    status: str  # 'approved' or 'pending_review'


@api_router.post("/documents/{document_id}/review-status")
def api_set_review_status(
    document_id: str,
    body: ReviewStatusRequest,
    client: CerefoxClient = Depends(get_client),
) -> dict[str, str]:
    """Set the review status of a document. Creates an audit entry."""
    try:
        client.set_review_status(document_id, body.status, author="user")
        return {"status": body.status}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ── Version archival ─────────────────────────────────────────────────────────


class VersionArchiveRequest(BaseModel):
    archived: bool


@api_router.post("/documents/{document_id}/versions/{version_id}/archive")
def api_set_version_archived(
    document_id: str,
    version_id: str,
    body: VersionArchiveRequest,
    client: CerefoxClient = Depends(get_client),
) -> dict[str, bool]:
    """Set or clear the archived flag on a version. Creates an audit entry."""
    client.set_version_archived(version_id, body.archived, author="user")
    return {"archived": body.archived}


# ── Usage tracking ────────────────────────────────────────────────────────


class UsageLogEntryResponse(BaseModel):
    id: str
    logged_at: str
    operation: str
    access_path: str
    requestor: str | None = None
    document_id: str | None = None
    doc_title: str | None = None
    project_id: str | None = None
    query_text: str | None = None
    result_count: int | None = None
    extra: dict[str, Any] = {}


@api_router.get("/usage-log")
def api_list_usage_log(
    start: str | None = None,
    end: str | None = None,
    operation: str | None = None,
    access_path: str | None = None,
    requestor: str | None = None,
    project_id: str | None = None,
    limit: int = 100,
    client: CerefoxClient = Depends(get_client),
) -> list[UsageLogEntryResponse]:
    """List usage log entries with optional filters."""
    rows = client.list_usage_log(
        start=start,
        end=end,
        operation=operation,
        access_path=access_path,
        requestor=requestor,
        project_id=project_id,
        limit=limit,
    )
    return [
        UsageLogEntryResponse(
            id=row["id"],
            logged_at=str(row.get("logged_at", "")),
            operation=row["operation"],
            access_path=row["access_path"],
            requestor=row.get("requestor"),
            document_id=row.get("document_id"),
            doc_title=row.get("doc_title"),
            project_id=row.get("project_id"),
            query_text=row.get("query_text"),
            result_count=row.get("result_count"),
            extra=row.get("extra", {}),
        )
        for row in rows
    ]


@api_router.get("/usage-log/export.csv")
def api_export_usage_csv(
    start: str | None = None,
    end: str | None = None,
    operation: str | None = None,
    access_path: str | None = None,
    requestor: str | None = None,
    project_id: str | None = None,
    limit: int = 10000,
    client: CerefoxClient = Depends(get_client),
) -> Response:
    """Export usage log as CSV download."""
    import csv
    import io

    rows = client.list_usage_log(
        start=start, end=end, operation=operation,
        access_path=access_path, reader=reader,
        project_id=project_id, limit=limit,
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "id", "logged_at", "operation", "access_path", "requestor",
        "document_id", "doc_title", "project_id", "query_text",
        "result_count", "extra",
    ])
    for row in rows:
        writer.writerow([
            row.get("id", ""),
            row.get("logged_at", ""),
            row.get("operation", ""),
            row.get("access_path", ""),
            row.get("requestor", ""),
            row.get("document_id", ""),
            row.get("doc_title", ""),
            row.get("project_id", ""),
            row.get("query_text", ""),
            row.get("result_count", ""),
            json.dumps(row.get("extra", {})),
        ])

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=cerefox-usage-log.csv"},
    )


@api_router.get("/usage-log/summary")
def api_usage_summary(
    start: str | None = None,
    end: str | None = None,
    project_id: str | None = None,
    access_path: str | None = None,
    client: CerefoxClient = Depends(get_client),
) -> dict[str, Any]:
    """Get aggregated usage statistics for the analytics page."""
    return client.usage_summary(
        start=start, end=end, project_id=project_id, access_path=access_path,
    )


@api_router.get("/config/{key}")
def api_get_config(
    key: str,
    client: CerefoxClient = Depends(get_client),
) -> dict[str, str | None]:
    """Read a config value."""
    value = client.get_config(key)
    return {"key": key, "value": value}


class SetConfigRequest(BaseModel):
    value: str


@api_router.put("/config/{key}")
def api_set_config(
    key: str,
    body: SetConfigRequest,
    client: CerefoxClient = Depends(get_client),
) -> dict[str, str]:
    """Write a config value (validated against allowlist)."""
    client.set_config(key, body.value)
    return {"key": key, "value": body.value}
