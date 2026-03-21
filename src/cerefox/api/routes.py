"""All web UI route handlers for Cerefox.

Routes:
    GET  /                                        Dashboard — stats + recent docs
    GET  /search                                  Knowledge browser (supports ?q=, ?mode=, ?project_id=, ?count=, ?meta_filter_key[]=, ?meta_filter_value[]=)
    GET  /document/{document_id}                  Document viewer
    GET  /document/{document_id}/chunks           Lazy-loaded chunk list partial (HTMX)
    GET  /document/{document_id}/chunks-hide      Returns the collapsed Show button (HTMX, ?n=)
    GET  /document/{document_id}/content          Lazy-loaded full content partial (HTMX)
    GET  /document/{document_id}/content-hide     Returns the collapsed Show button (HTMX, ?chars=)
    GET  /document/{document_id}/download         Download document as .md file
    GET  /document/{document_id}/edit             Edit form
    POST /document/{document_id}/edit             Handle edit submission
    POST /document/{document_id}/delete           Delete document
    POST /document/{document_id}/update-content   Replace content by uploading a new file
    GET  /api/check-filename                      HTMX partial: check if a filename already exists
    GET  /api/documents/{id}                      JSON: full document content (current or by version_id)
    GET  /api/documents/{id}/versions             JSON: list of archived versions for a document
    GET  /ingest                                  Ingest form
    POST /ingest                                  Handle paste or file upload
    GET  /projects                                Projects list
    POST /projects                                Create project
    GET  /projects/{project_id}/edit              Edit project form
    POST /projects/{project_id}/edit              Handle project edit
    POST /projects/{project_id}/delete            Delete project
HTMX detection: routes check the HX-Request header. When present they return
only the relevant HTML partial; otherwise they return the full page.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates

from cerefox.config import Settings
from cerefox.db.client import CerefoxClient
from cerefox.embeddings.base import Embedder
from cerefox.ingestion.pipeline import IngestionPipeline
from cerefox.retrieval.search import DocResult, DocSearchResponse, SearchClient

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Dependency helpers ────────────────────────────────────────────────────────


@lru_cache
def _cached_settings() -> Settings:
    return Settings()


@lru_cache
def _cached_client() -> CerefoxClient:
    return CerefoxClient(_cached_settings())


@lru_cache
def _cached_embedder() -> Embedder | None:
    """Return the configured CloudEmbedder, or None if API key is missing."""
    settings = _cached_settings()
    try:
        from cerefox.embeddings.cloud import CloudEmbedder

        api_key = settings.get_embedder_api_key()
        if not api_key:
            logger.warning(
                "Embedding API key not set (CEREFOX_OPENAI_API_KEY or "
                "CEREFOX_FIREWORKS_API_KEY). Semantic search will be unavailable."
            )
            return None
        return CloudEmbedder(
            api_key=api_key,
            base_url=settings.get_embedder_base_url(),
            model=settings.get_embedder_model(),
            dimensions=settings.get_embedder_dimensions(),
        )
    except Exception as exc:
        logger.warning("Embedder unavailable: %s", exc)
        return None


def get_settings() -> Settings:
    return _cached_settings()


def get_client() -> CerefoxClient:
    return _cached_client()


def get_embedder() -> Embedder | None:
    return _cached_embedder()


def get_templates(request: Request) -> Jinja2Templates:
    return request.app.state.templates


# ── Helpers ───────────────────────────────────────────────────────────────────


def _is_htmx(request: Request) -> bool:
    return request.headers.get("HX-Request") == "true"


def _render(
    templates: Jinja2Templates,
    request: Request,
    template: str,
    ctx: dict[str, Any],
) -> HTMLResponse:
    return templates.TemplateResponse(request, template, ctx)


async def _extract_ingest_form(request: Request) -> tuple[list[str], dict]:
    """Parse multi-select project_ids and paired meta_key[]/meta_value[] from a form."""
    form_data = await request.form()
    project_ids = [v for v in form_data.getlist("project_ids") if v]
    meta_keys = form_data.getlist("meta_key[]")
    meta_values = form_data.getlist("meta_value[]")
    metadata: dict = {}
    for k, v in zip(meta_keys, meta_values):
        k_str = str(k).strip()
        v_str = str(v).strip()
        if k_str and v_str:
            metadata[k_str] = v_str
    return project_ids, metadata


# ── Dashboard ─────────────────────────────────────────────────────────────────


@router.get("/", response_class=HTMLResponse)
def dashboard(
    request: Request,
    client: CerefoxClient = Depends(get_client),
    templates: Jinja2Templates = Depends(get_templates),
):
    ctx: dict[str, Any] = {"active": "dashboard"}
    try:
        recent_docs = client.list_documents(limit=10)
        projects = client.list_projects()
        doc_count = client.count_documents()
        project_count = len(projects)
        doc_projects_map = client.get_projects_for_documents(
            [d["id"] for d in recent_docs], projects
        )
        project_doc_counts = client.get_project_doc_counts([p["id"] for p in projects])
        ctx.update(
            {
                "recent_docs": recent_docs,
                "projects": projects,
                "doc_projects_map": doc_projects_map,
                "project_doc_counts": project_doc_counts,
                "doc_count": doc_count,
                "project_count": project_count,
                "error": None,
            }
        )
    except Exception as exc:
        ctx.update(
            {
                "recent_docs": [],
                "projects": [],
                "doc_projects_map": {},
                "project_doc_counts": {},
                "doc_count": 0,
                "project_count": 0,
                "error": str(exc),
            }
        )
    return _render(templates, request, "dashboard.html", ctx)


# ── Knowledge browser (search) ────────────────────────────────────────────────


@router.get("/search", response_class=HTMLResponse)
def search_page(
    request: Request,
    q: str = "",
    mode: str = "docs",
    project_id: str = "",
    count: int = 10,
    client: CerefoxClient = Depends(get_client),
    embedder: Embedder | None = Depends(get_embedder),
    settings: Settings = Depends(get_settings),
    templates: Jinja2Templates = Depends(get_templates),
):
    results = None
    error = None
    projects: list[dict] = []

    try:
        projects = client.list_projects()
    except Exception as exc:
        error = str(exc)

    # ── Assemble metadata filter from repeated query params ──────────────────
    # Params arrive as parallel arrays: meta_filter_key[]=foo&meta_filter_value[]=bar
    # Empty keys or values are ignored. The assembled dict is passed to the RPC.
    meta_filter_keys = request.query_params.getlist("meta_filter_key[]")
    meta_filter_values = request.query_params.getlist("meta_filter_value[]")
    metadata_filter: dict | None = {
        k.strip(): v.strip()
        for k, v in zip(meta_filter_keys, meta_filter_values)
        if k.strip() and v.strip()
    } or None

    if project_id and not q and not error:
        # Browse mode: project selected but no query → list all docs in project.
        # Metadata filter is not applied in browse mode (no RPC search path).
        try:
            raw = client.list_documents(limit=100, project_id=project_id)
            browse_results = [
                DocResult(
                    document_id=d["id"],
                    doc_title=d.get("title") or "",
                    doc_source=d.get("source") or "",
                    doc_metadata=d.get("metadata") or {},
                    doc_project_ids=[project_id],
                    best_score=0.0,
                    best_chunk_heading_path=[],
                    full_content="",
                    chunk_count=d.get("chunk_count") or 0,
                    total_chars=d.get("total_chars") or 0,
                    doc_updated_at=d.get("updated_at") or "",
                )
                for d in raw
            ]
            results = DocSearchResponse(
                results=browse_results,
                query="",
                total_found=len(browse_results),
                response_bytes=0,
                truncated=len(browse_results) == 100,
            )
            mode = "docs"
        except Exception as exc:
            error = str(exc)
    elif q and not error:
        pid = project_id or None
        try:
            sc = SearchClient(client, embedder, settings)
            # Web UI: no max_bytes limit — the browser can handle large responses.
            # Truncation limits belong on the MCP/LLM path, not in the web UI.
            if mode == "fts":
                resp = sc.fts(q, match_count=count, project_id=pid,
                              metadata_filter=metadata_filter, max_bytes=None)
            elif mode == "semantic":
                if embedder is None:
                    raise RuntimeError("Embedder not available — install sentence-transformers")
                resp = sc.semantic(q, match_count=count, project_id=pid,
                                   metadata_filter=metadata_filter, max_bytes=None)
            elif mode == "docs":
                if embedder is None:
                    raise RuntimeError("Embedder not available — install sentence-transformers")
                resp = sc.search_docs(q, match_count=min(count, 5), project_id=pid,
                                      metadata_filter=metadata_filter, max_bytes=None)
            else:  # hybrid (default)
                if embedder is None:
                    raise RuntimeError("Embedder not available — install sentence-transformers")
                resp = sc.hybrid(q, match_count=count, project_id=pid,
                                 metadata_filter=metadata_filter, max_bytes=None)
            results = resp
        except Exception as exc:
            error = str(exc)

    # Fetch metadata keys for autocomplete (best-effort — don't block on failure).
    metadata_keys: list[str] = []
    try:
        metadata_keys = [row["key"] for row in client.list_metadata_keys()]
    except Exception:
        pass

    projects_map = {p["id"]: p["name"] for p in projects}
    # Rebuild filter pairs for template rendering (to preserve state across refreshes).
    active_filter_pairs = [
        {"key": k, "value": v} for k, v in (metadata_filter or {}).items()
    ]
    ctx = {
        "active": "search",
        "query": q,
        "mode": mode,
        "view": "docs" if mode == "docs" else "chunks",
        "project_id": project_id,
        "count": count,
        "results": results,
        "projects": projects,
        "projects_map": projects_map,
        "metadata_keys": metadata_keys,
        "active_filter_pairs": active_filter_pairs,
        "error": error,
    }

    # HTMX partial: return only the results fragment.
    if _is_htmx(request):
        return _render(templates, request, "partials/search_results.html", ctx)

    return _render(templates, request, "browser.html", ctx)


# ── Document viewer ───────────────────────────────────────────────────────────


@router.get("/document/{document_id}", response_class=HTMLResponse)
def document_view(
    request: Request,
    document_id: str,
    saved: str | None = None,
    client: CerefoxClient = Depends(get_client),
    templates: Jinja2Templates = Depends(get_templates),
):
    ctx: dict[str, Any] = {"active": "search", "saved": saved}
    try:
        doc_row = client.reconstruct_doc(document_id)
        if doc_row is None:
            ctx["error"] = f"Document {document_id!r} not found."
            ctx["doc"] = None
            ctx["doc_projects"] = []
        else:
            # Chunks and full content are loaded lazily via HTMX — skip list_chunks_for_document.
            project_ids = doc_row.get("doc_project_ids") or []
            doc_projects = []
            if project_ids:
                all_projects = {p["id"]: p for p in client.list_projects()}
                doc_projects = [all_projects[pid] for pid in project_ids if pid in all_projects]
            # Fetch created_at/updated_at from the documents table (reconstruct_doc
            # RPC doesn't return them).
            doc_record = client.get_document_by_id(document_id)
            versions = client.list_document_versions(document_id)
            ctx.update({
                "doc": doc_row,
                "doc_projects": doc_projects,
                "doc_created_at": doc_record.get("created_at") if doc_record else None,
                "doc_updated_at": doc_record.get("updated_at") if doc_record else None,
                "versions": versions,
                "error": None,
            })
    except Exception as exc:
        ctx.update({"doc": None, "doc_projects": [], "error": str(exc)})
    return _render(templates, request, "document.html", ctx)


# ── Document lazy-load partials (chunks + full content) ───────────────────────


@router.get("/document/{document_id}/chunks", response_class=HTMLResponse)
def document_chunks(
    request: Request,
    document_id: str,
    client: CerefoxClient = Depends(get_client),
    templates: Jinja2Templates = Depends(get_templates),
):
    """Return the chunk list partial for a document — called by HTMX on demand."""
    try:
        chunks = client.list_chunks_for_document(document_id)
    except Exception as exc:
        logger.error("document_chunks failed for %s: %s", document_id, exc)
        chunks = []
    return _render(
        templates, request, "partials/document_chunks.html",
        {"chunks": chunks, "document_id": document_id},
    )


@router.get("/document/{document_id}/chunks-hide", response_class=HTMLResponse)
def document_chunks_hide(request: Request, document_id: str, n: int = 0):
    """Return the collapsed Show chunks button — called by HTMX when the user hides chunks."""
    return HTMLResponse(
        f'<button hx-get="/document/{document_id}/chunks" '
        f'hx-target="#doc-chunks" hx-swap="innerHTML" '
        f'hx-indicator="#chunks-spinner" '
        f'class="outline secondary btn-sm">'
        f'<span id="chunks-spinner" class="htmx-indicator">…</span>'
        f'Show {n} chunk(s)</button>'
    )


@router.get("/document/{document_id}/content", response_class=HTMLResponse)
def document_content(
    request: Request,
    document_id: str,
    client: CerefoxClient = Depends(get_client),
    templates: Jinja2Templates = Depends(get_templates),
):
    """Return the full content partial for a document — called by HTMX on demand."""
    try:
        doc = client.reconstruct_doc(document_id)
        full_content = doc.get("full_content", "") if doc else ""
        total_chars = doc.get("total_chars", 0) if doc else 0
    except Exception as exc:
        logger.error("document_content failed for %s: %s", document_id, exc)
        full_content = ""
        total_chars = 0
    return _render(
        templates, request, "partials/document_content.html",
        {"document_id": document_id, "full_content": full_content, "total_chars": total_chars},
    )


@router.get("/document/{document_id}/content-hide", response_class=HTMLResponse)
def document_content_hide(request: Request, document_id: str, chars: int = 0):
    """Return the collapsed Show full content button — called by HTMX when the user hides content."""
    chars_str = f"{chars:,}" if chars else "?"
    return HTMLResponse(
        f'<button hx-get="/document/{document_id}/content" '
        f'hx-target="#doc-content" hx-swap="innerHTML" '
        f'hx-indicator="#content-spinner" '
        f'class="outline secondary btn-sm">'
        f'<span id="content-spinner" class="htmx-indicator">…</span>'
        f'Show full content ({chars_str} chars)</button>'
    )


# ── Document delete ───────────────────────────────────────────────────────────


@router.post("/document/{document_id}/delete", response_class=HTMLResponse)
def document_delete(
    request: Request,
    document_id: str,
    client: CerefoxClient = Depends(get_client),
):
    try:
        client.delete_document(document_id)
    except Exception as exc:
        logger.error("delete_document %s failed: %s", document_id, exc)
    return RedirectResponse("/", status_code=303)


# ── Document update-content (replace file) ───────────────────────────────────


@router.post("/document/{document_id}/update-content", response_class=HTMLResponse)
async def document_update_content(
    request: Request,
    document_id: str,
    file: UploadFile | None = File(None),
    client: CerefoxClient = Depends(get_client),
    embedder: Embedder | None = Depends(get_embedder),
    settings: Settings = Depends(get_settings),
    templates: Jinja2Templates = Depends(get_templates),
):
    """Replace a document's content by uploading a new file version."""
    ctx: dict[str, Any] = {"success": False, "error": None, "reindexed": False}

    if embedder is None:
        ctx["error"] = "Embedder not available — cannot re-index document."
        return _render(templates, request, "partials/update_result.html", ctx)

    if file is None:
        ctx["error"] = "No file provided."
        return _render(templates, request, "partials/update_result.html", ctx)

    try:
        raw = await file.read()
        text = raw.decode("utf-8", errors="replace")

        # Use existing title from the DB (user can rename via edit form).
        existing = client.get_document_by_id(document_id)
        if existing is None:
            ctx["error"] = f"Document {document_id!r} not found."
            return _render(templates, request, "partials/update_result.html", ctx)

        pipeline = IngestionPipeline(client, embedder, settings)
        result = pipeline.update_document(
            document_id=document_id,
            text=text,
            title=existing.get("title", file.filename or "Untitled"),
        )
        ctx["success"] = True
        ctx["reindexed"] = result.reindexed
        ctx["document_id"] = document_id
    except Exception as exc:
        logger.error("document_update_content %s failed: %s", document_id, exc)
        ctx["error"] = str(exc)

    return _render(templates, request, "partials/update_result.html", ctx)


# ── Document edit ─────────────────────────────────────────────────────────────


@router.get("/document/{document_id}/download")
def document_download(
    document_id: str,
    version_id: str | None = Query(None),
    client: CerefoxClient = Depends(get_client),
) -> Response:
    """Return the document's markdown content as a file download.

    Pass ``?version_id=<uuid>`` to download an archived version.
    """
    if version_id:
        doc = client.get_document_content(document_id, version_id=version_id)
    else:
        doc = client.reconstruct_doc(document_id)
    if doc is None:
        return Response(status_code=404, content="Document not found")
    content = doc.get("full_content") or ""
    doc_record = client.get_document_by_id(document_id)
    source_path = (doc_record or {}).get("source_path") or "document.md"
    import os  # noqa: PLC0415
    filename = os.path.basename(source_path) or "document.md"
    return Response(
        content=content,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/document/{document_id}/edit", response_class=HTMLResponse)
def document_edit_form(
    request: Request,
    document_id: str,
    client: CerefoxClient = Depends(get_client),
    templates: Jinja2Templates = Depends(get_templates),
):
    ctx: dict[str, Any] = {"active": "search"}
    try:
        doc = client.reconstruct_doc(document_id)
        if doc is None:
            ctx["error"] = f"Document {document_id!r} not found."
            ctx["doc"] = None
            ctx["projects"] = []
            ctx["doc_project_ids"] = []
            ctx["known_meta_keys"] = []
        else:
            projects = client.list_projects()
            doc_project_ids = client.get_document_project_ids(document_id)
            known_meta_keys = client.list_metadata_keys()
            ctx.update({
                "doc": doc,
                "projects": projects,
                "doc_project_ids": doc_project_ids,
                "known_meta_keys": known_meta_keys,
                "error": None,
            })
    except Exception as exc:
        ctx.update({"doc": None, "projects": [], "doc_project_ids": [],
                    "known_meta_keys": [], "error": str(exc)})
    return _render(templates, request, "edit.html", ctx)


@router.post("/document/{document_id}/edit", response_class=HTMLResponse)
async def document_edit_submit(
    request: Request,
    document_id: str,
    title: str = Form(...),
    content: str = Form(...),
    client: CerefoxClient = Depends(get_client),
    embedder: Embedder | None = Depends(get_embedder),
    settings: Settings = Depends(get_settings),
    templates: Jinja2Templates = Depends(get_templates),
):
    if embedder is None:
        ctx = {
            "active": "search",
            "error": "Embedder not available — cannot re-index document.",
            "doc": None,
            "projects": [],
            "doc_project_ids": [],
            "known_meta_keys": [],
        }
        return _render(templates, request, "edit.html", ctx)

    project_ids, metadata = await _extract_ingest_form(request)

    try:
        pipeline = IngestionPipeline(client, embedder, settings)
        result = pipeline.update_document(
            document_id=document_id,
            text=content.strip(),
            title=title.strip(),
            project_ids=project_ids if project_ids else None,
            metadata=metadata if metadata else None,
        )
        status = "reindexed" if result.reindexed else "saved"
        return RedirectResponse(f"/document/{document_id}?saved={status}", status_code=303)
    except ValueError as exc:
        doc = client.reconstruct_doc(document_id)
        projects = client.list_projects()
        doc_project_ids = client.get_document_project_ids(document_id)
        known_meta_keys = client.list_metadata_keys()
        ctx = {
            "active": "search", "doc": doc, "projects": projects,
            "doc_project_ids": doc_project_ids, "known_meta_keys": known_meta_keys,
            "error": str(exc),
        }
        return _render(templates, request, "edit.html", ctx)
    except Exception as exc:
        logger.error("document_edit %s failed: %s", document_id, exc)
        doc = client.reconstruct_doc(document_id)
        projects = client.list_projects()
        doc_project_ids = client.get_document_project_ids(document_id)
        known_meta_keys = client.list_metadata_keys()
        ctx = {
            "active": "search", "doc": doc, "projects": projects,
            "doc_project_ids": doc_project_ids, "known_meta_keys": known_meta_keys,
            "error": str(exc),
        }
        return _render(templates, request, "edit.html", ctx)


# ── Ingest ────────────────────────────────────────────────────────────────────


@router.get("/ingest", response_class=HTMLResponse)
def ingest_form(
    request: Request,
    client: CerefoxClient = Depends(get_client),
    templates: Jinja2Templates = Depends(get_templates),
):
    projects: list[dict] = []
    known_meta_keys: list[dict] = []
    try:
        projects = client.list_projects()
        known_meta_keys = client.list_metadata_keys()
    except Exception:
        pass
    return _render(
        templates, request, "ingest.html",
        {"active": "ingest", "projects": projects, "known_meta_keys": known_meta_keys},
    )


@router.post("/ingest", response_class=HTMLResponse)
async def ingest_submit(
    request: Request,
    mode: str = Form(...),
    title: str = Form(""),
    content: str = Form(""),
    update_existing: str = Form("0"),
    file: UploadFile | None = File(None),
    client: CerefoxClient = Depends(get_client),
    embedder: Embedder | None = Depends(get_embedder),
    settings: Settings = Depends(get_settings),
    templates: Jinja2Templates = Depends(get_templates),
):
    result_ctx: dict[str, Any] = {
        "success": False, "skipped": False, "updated": False, "error": None, "title": "",
    }
    project_ids, metadata = await _extract_ingest_form(request)
    do_update = update_existing in ("1", "true", "on")

    try:
        pipeline = IngestionPipeline(client, embedder, settings)

        if mode == "paste":
            if not title.strip():
                result_ctx["error"] = "Title is required for paste mode."
            elif not content.strip():
                result_ctx["error"] = "Content cannot be empty."
            else:
                res = pipeline.ingest_text(
                    content.strip(), title.strip(),
                    project_ids=project_ids, metadata=metadata or None,
                    update_existing=do_update,
                )
                result_ctx.update({
                    "success": not res.skipped, "skipped": res.skipped,
                    "updated": res.reindexed, "title": res.title,
                })
        elif mode == "file" and file:
            raw = await file.read()
            text = raw.decode("utf-8", errors="replace")
            doc_title = title.strip() or file.filename or "Untitled"
            res = pipeline.ingest_text(
                text, doc_title, source="file", source_path=file.filename,
                project_ids=project_ids, metadata=metadata or None,
                update_existing=do_update,
            )
            result_ctx.update({
                "success": not res.skipped, "skipped": res.skipped,
                "updated": res.reindexed, "title": res.title,
            })
        else:
            result_ctx["error"] = "No content provided."
    except Exception as exc:
        result_ctx["error"] = str(exc)

    if _is_htmx(request):
        return _render(templates, request, "partials/ingest_result.html", result_ctx)

    if result_ctx["success"]:
        return RedirectResponse("/ingest?msg=success", status_code=303)
    projects: list[dict] = []
    known_meta_keys: list[dict] = []
    try:
        projects = client.list_projects()
        known_meta_keys = client.list_metadata_keys()
    except Exception:
        pass
    return _render(
        templates, request, "ingest.html",
        {"active": "ingest", "projects": projects, "known_meta_keys": known_meta_keys,
         "error": result_ctx["error"]},
    )


# ── Filename check (HTMX partial) ────────────────────────────────────────────


@router.get("/api/check-filename", response_class=HTMLResponse)
def check_filename(
    request: Request,
    filename: str = Query(""),
    client: CerefoxClient = Depends(get_client),
    templates: Jinja2Templates = Depends(get_templates),
):
    """Return an HTML partial indicating whether a file with this name already exists."""
    ctx: dict[str, Any] = {"existing_doc": None, "filename": filename}
    if filename:
        try:
            doc = client.find_document_by_source_path(filename)
            ctx["existing_doc"] = doc
        except Exception:
            pass  # Silently degrade — the check is advisory only
    return _render(templates, request, "partials/filename_check.html", ctx)


# ── Projects ──────────────────────────────────────────────────────────────────


@router.get("/projects", response_class=HTMLResponse)
def projects_list(
    request: Request,
    client: CerefoxClient = Depends(get_client),
    templates: Jinja2Templates = Depends(get_templates),
):
    ctx: dict[str, Any] = {"active": "projects"}
    try:
        projects = client.list_projects()
        ctx.update({"projects": projects, "error": None})
    except Exception as exc:
        ctx.update({"projects": [], "error": str(exc)})
    return _render(templates, request, "projects.html", ctx)


@router.post("/projects", response_class=HTMLResponse)
def create_project(
    request: Request,
    name: str = Form(...),
    description: str = Form(""),
    client: CerefoxClient = Depends(get_client),
):
    try:
        client.create_project(name.strip(), description.strip())
    except Exception as exc:
        logger.error("create_project failed: %s", exc)
    return RedirectResponse("/projects", status_code=303)


@router.get("/projects/{project_id}/edit", response_class=HTMLResponse)
def project_edit_form(
    request: Request,
    project_id: str,
    client: CerefoxClient = Depends(get_client),
    templates: Jinja2Templates = Depends(get_templates),
):
    ctx: dict[str, Any] = {"active": "projects"}
    try:
        project = client.get_project_by_id(project_id)
        if project is None:
            ctx["error"] = f"Project {project_id!r} not found."
            ctx["project"] = None
        else:
            ctx.update({"project": project, "error": None})
    except Exception as exc:
        ctx.update({"project": None, "error": str(exc)})
    return _render(templates, request, "project_edit.html", ctx)


@router.post("/projects/{project_id}/edit", response_class=HTMLResponse)
def project_edit_submit(
    request: Request,
    project_id: str,
    name: str = Form(...),
    description: str = Form(""),
    client: CerefoxClient = Depends(get_client),
    templates: Jinja2Templates = Depends(get_templates),
):
    try:
        client.update_project(project_id, {
            "name": name.strip(),
            "description": description.strip(),
        })
        return RedirectResponse("/projects", status_code=303)
    except Exception as exc:
        logger.error("update_project %s failed: %s", project_id, exc)
        project = client.get_project_by_id(project_id)
        ctx = {"active": "projects", "project": project, "error": str(exc)}
        return _render(templates, request, "project_edit.html", ctx)


@router.post("/projects/{project_id}/delete", response_class=HTMLResponse)
def delete_project(
    request: Request,
    project_id: str,
    client: CerefoxClient = Depends(get_client),
):
    try:
        client.delete_project(project_id)
    except Exception as exc:
        logger.error("delete_project %s failed: %s", project_id, exc)
    return RedirectResponse("/projects", status_code=303)


# ── JSON API — document retrieval & versioning ────────────────────────────────


@router.get("/api/documents/{document_id}")
def api_get_document(
    document_id: str,
    version_id: str | None = Query(None),
    client: CerefoxClient = Depends(get_client),
):
    """Return full reconstructed content of a document as JSON.

    Pass ``?version_id=<uuid>`` to retrieve an archived version.
    Omit it (or pass nothing) to get the current version.
    Version UUIDs are returned by GET /api/documents/{id}/versions.
    """
    doc = client.get_document_content(document_id, version_id=version_id)
    if doc is None:
        from fastapi import HTTPException  # noqa: PLC0415
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.get("/api/documents/{document_id}/versions")
def api_list_document_versions(
    document_id: str,
    client: CerefoxClient = Depends(get_client),
):
    """Return all archived versions of a document as a JSON array, newest first.

    Each item contains: version_id, version_number, source, chunk_count,
    total_chars, created_at.

    Pass version_id to GET /api/documents/{id}?version_id=<uuid> to retrieve
    the full content of a specific version.
    """
    versions = client.list_document_versions(document_id)
    return {"document_id": document_id, "versions": versions}

