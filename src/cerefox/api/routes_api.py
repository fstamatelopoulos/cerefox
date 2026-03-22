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


# ── Dashboard ────────────────────────────────────────────────────────────────


class DashboardDocResponse(BaseModel):
    id: str
    title: str
    source: str | None = None
    chunk_count: int = 0
    total_chars: int = 0
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
        created_at=meta.get("created_at") if meta else None,
        updated_at=meta.get("updated_at") if meta else None,
        versions=[
            DocumentVersionResponse(
                version_id=v["version_id"],
                version_number=v["version_number"],
                source=v.get("source", ""),
                chunk_count=v.get("chunk_count", 0),
                total_chars=v.get("total_chars", 0),
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
        )
        return EditResponse(success=True, reindexed=result.reindexed)
    except Exception as exc:
        return EditResponse(success=False, error=str(exc))


@api_router.delete("/documents/{document_id}")
def api_delete_document(
    document_id: str,
    client: CerefoxClient = Depends(get_client),
) -> dict[str, bool]:
    """Delete a document."""
    try:
        client.delete_document(document_id)
        return {"success": True}
    except Exception as exc:
        logger.error("delete_document %s failed: %s", document_id, exc)
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
