"""Tests for the Cerefox web UI routes.

Uses FastAPI's TestClient with dependency overrides to avoid real DB/embedder calls.
All tests are synchronous and hit no external services.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from cerefox.api.app import create_app
from cerefox.api.routes import get_client, get_embedder, get_settings
from cerefox.config import Settings
from cerefox.retrieval.search import SearchResponse, SearchResult


# ── Fixtures ──────────────────────────────────────────────────────────────────


def _mock_settings() -> Settings:
    with patch.dict(
        "os.environ",
        {"CEREFOX_EMBEDDER": "openai", "OPENAI_API_KEY": "test-key"},
        clear=False,
    ):
        return Settings(supabase_url="http://fake", supabase_key="fake-key")


def _make_doc(**kwargs) -> dict:
    defaults = {
        "id": "doc-uuid-1",
        "title": "Test Document",
        "source": "file",
        "source_path": "test.md",
        "project_id": None,
        "metadata": {},
        "chunk_count": 3,
        "total_chars": 1500,
        "created_at": "2026-03-08T10:00:00Z",
    }
    return {**defaults, **kwargs}


def _make_project(**kwargs) -> dict:
    defaults = {"id": "proj-uuid-1", "name": "My Project", "description": "Test project"}
    return {**defaults, **kwargs}


def _make_chunk(**kwargs) -> dict:
    defaults = {
        "id": "chunk-uuid-1",
        "document_id": "doc-uuid-1",
        "chunk_index": 0,
        "heading_path": ["Test Document", "Section"],
        "heading_level": 2,
        "title": "Section",
        "content": "Some content here.",
        "char_count": 18,
        "embedder_primary": "text-embedding-3-small",
        "created_at": "2026-03-08T10:00:00Z",
    }
    return {**defaults, **kwargs}


def _make_search_result(**kwargs) -> SearchResult:
    defaults = {
        "chunk_id": "chunk-uuid-1",
        "document_id": "doc-uuid-1",
        "chunk_index": 0,
        "title": "Section",
        "content": "Relevant content from the knowledge base.",
        "heading_path": ["Doc", "Section"],
        "heading_level": 2,
        "score": 0.87,
        "doc_title": "Test Document",
        "doc_source": "file",
        "doc_project_ids": [],
        "doc_metadata": {},
    }
    return SearchResult(**{**defaults, **kwargs})


@pytest.fixture()
def mock_client():
    client = MagicMock()
    client.list_documents.return_value = [_make_doc()]
    client.list_projects.return_value = [_make_project()]
    client.count_documents.return_value = 42
    client.reconstruct_doc.return_value = {
        "document_id": "doc-uuid-1",
        "doc_title": "Test Document",
        "doc_source": "file",
        "doc_metadata": {},
        "full_content": "# Test Document\n\nContent.",
        "chunk_count": 3,
        "total_chars": 1500,
    }
    client.list_chunks_for_document.return_value = [_make_chunk()]
    client.get_projects_for_documents.return_value = {}
    client.get_project_doc_counts.return_value = {}
    client.list_metadata_keys.return_value = []
    client.get_document_project_ids.return_value = []
    return client


@pytest.fixture()
def mock_embedder():
    embedder = MagicMock()
    embedder.embed.return_value = [0.1] * 768
    embedder.embed_batch.return_value = [[0.1] * 768]
    return embedder


@pytest.fixture()
def test_client(mock_client, mock_embedder):
    """TestClient with mocked dependencies."""
    app = create_app()
    app.dependency_overrides[get_settings] = _mock_settings
    app.dependency_overrides[get_client] = lambda: mock_client
    app.dependency_overrides[get_embedder] = lambda: mock_embedder
    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture()
def test_client_no_embedder(mock_client):
    """TestClient with no embedder (embedder not installed scenario)."""
    app = create_app()
    app.dependency_overrides[get_settings] = _mock_settings
    app.dependency_overrides[get_client] = lambda: mock_client
    app.dependency_overrides[get_embedder] = lambda: None
    return TestClient(app, raise_server_exceptions=True)


# ── Dashboard ─────────────────────────────────────────────────────────────────


class TestDashboard:
    def test_returns_200(self, test_client, mock_client):
        resp = test_client.get("/")
        assert resp.status_code == 200

    def test_shows_document_count(self, test_client, mock_client):
        mock_client.count_documents.return_value = 42
        resp = test_client.get("/")
        assert "42" in resp.text

    def test_shows_recent_docs(self, test_client, mock_client):
        resp = test_client.get("/")
        assert "Test Document" in resp.text

    def test_shows_projects(self, test_client, mock_client):
        resp = test_client.get("/")
        assert "My Project" in resp.text

    def test_handles_client_error_gracefully(self, test_client, mock_client):
        mock_client.list_documents.side_effect = RuntimeError("DB connection failed")
        resp = test_client.get("/")
        assert resp.status_code == 200
        assert "DB connection failed" in resp.text

    def test_empty_dashboard_shows_ingest_link(self, test_client, mock_client):
        mock_client.list_documents.return_value = []
        mock_client.list_projects.return_value = []
        mock_client.count_documents.return_value = 0
        resp = test_client.get("/")
        assert "ingest" in resp.text.lower()

    def test_shows_doc_count_in_project_tiles(self, test_client, mock_client):
        mock_client.get_project_doc_counts.return_value = {"proj-uuid-1": 7}
        resp = test_client.get("/")
        assert "7" in resp.text


# ── Search / browser ──────────────────────────────────────────────────────────


class TestSearchPage:
    def test_empty_search_returns_200(self, test_client):
        resp = test_client.get("/search")
        assert resp.status_code == 200

    def test_search_form_is_present(self, test_client):
        resp = test_client.get("/search")
        assert "<form" in resp.text
        assert 'name="q"' in resp.text

    def test_search_with_query_calls_hybrid(self, test_client, mock_client, mock_embedder):
        search_resp = SearchResponse(
            results=[_make_search_result()],
            query="my query",
            mode="hybrid",
            total_found=1,
            response_bytes=100,
            truncated=False,
            metadata={},
        )
        with patch("cerefox.api.routes.SearchClient") as MockSC:
            MockSC.return_value.hybrid.return_value = search_resp
            resp = test_client.get("/search?q=my+query")
        assert resp.status_code == 200
        assert "Test Document" in resp.text

    def test_fts_mode_calls_fts(self, test_client, mock_client):
        search_resp = SearchResponse(
            results=[_make_search_result()],
            query="keyword",
            mode="fts",
            total_found=1,
            response_bytes=100,
            truncated=False,
            metadata={},
        )
        with patch("cerefox.api.routes.SearchClient") as MockSC:
            MockSC.return_value.fts.return_value = search_resp
            resp = test_client.get("/search?q=keyword&mode=fts")
        assert resp.status_code == 200

    def test_semantic_mode_without_embedder_shows_error(self, test_client_no_embedder):
        resp = test_client_no_embedder.get("/search?q=test&mode=semantic")
        assert resp.status_code == 200
        assert "Embedder" in resp.text or "embedder" in resp.text.lower()

    def test_htmx_search_returns_partial(self, test_client, mock_client):
        search_resp = SearchResponse(
            results=[_make_search_result()],
            query="test",
            mode="hybrid",
            total_found=1,
            response_bytes=100,
            truncated=False,
            metadata={},
        )
        with patch("cerefox.api.routes.SearchClient") as MockSC:
            MockSC.return_value.hybrid.return_value = search_resp
            resp = test_client.get(
                "/search?q=test",
                headers={"HX-Request": "true"},
            )
        assert resp.status_code == 200
        # Partial should NOT contain full page chrome
        assert "<nav" not in resp.text

    def test_search_shows_empty_state_when_no_results(self, test_client, mock_client):
        search_resp = SearchResponse(
            results=[],
            query="nothing",
            mode="hybrid",
            total_found=0,
            response_bytes=0,
            truncated=False,
            metadata={},
        )
        with patch("cerefox.api.routes.SearchClient") as MockSC:
            MockSC.return_value.hybrid.return_value = search_resp
            resp = test_client.get("/search?q=nothing")
        assert resp.status_code == 200
        assert "No results" in resp.text

    def test_browse_mode_lists_docs_when_project_and_no_query(
        self, test_client, mock_client
    ):
        """Selecting a project with no search query should list docs in that project."""
        mock_client.list_documents.return_value = [_make_doc()]
        resp = test_client.get("/search?project_id=proj-uuid-1")
        assert resp.status_code == 200
        assert "Test Document" in resp.text
        # Should say "in project" not "for query"
        assert "in project" in resp.text

    def test_browse_mode_htmx_returns_partial(self, test_client, mock_client):
        """HTMX browse request should still return a partial (no nav chrome)."""
        mock_client.list_documents.return_value = [_make_doc()]
        resp = test_client.get(
            "/search?project_id=proj-uuid-1",
            headers={"HX-Request": "true"},
        )
        assert resp.status_code == 200
        assert "<nav" not in resp.text

    def test_browse_mode_empty_project_shows_no_results(self, test_client, mock_client):
        mock_client.list_documents.return_value = []
        resp = test_client.get("/search?project_id=proj-uuid-1")
        assert resp.status_code == 200
        # Empty browse → no results state
        assert "No results" in resp.text or "empty" in resp.text.lower()


# ── Document viewer ───────────────────────────────────────────────────────────


class TestDocumentView:
    def test_returns_200_for_existing_doc(self, test_client, mock_client):
        resp = test_client.get("/document/doc-uuid-1")
        assert resp.status_code == 200

    def test_shows_document_title(self, test_client, mock_client):
        resp = test_client.get("/document/doc-uuid-1")
        assert "Test Document" in resp.text

    def test_does_not_load_chunks_on_initial_view(self, test_client, mock_client):
        """Chunks are lazy-loaded via HTMX — list_chunks_for_document must not be called."""
        test_client.get("/document/doc-uuid-1")
        mock_client.list_chunks_for_document.assert_not_called()

    def test_shows_htmx_show_chunks_button(self, test_client, mock_client):
        """Initial page should have the lazy-load button, not rendered chunk text."""
        resp = test_client.get("/document/doc-uuid-1")
        assert "Show" in resp.text
        assert "/chunks" in resp.text
        assert "Some content here." not in resp.text

    def test_shows_htmx_show_content_button(self, test_client, mock_client):
        """Initial page should have the Show full content lazy-load button."""
        resp = test_client.get("/document/doc-uuid-1")
        assert "/content" in resp.text
        assert "Show full content" in resp.text
        # Full content text must NOT be in the initial response
        assert "# Test Document" not in resp.text

    def test_shows_error_for_missing_doc(self, test_client, mock_client):
        mock_client.reconstruct_doc.return_value = None
        resp = test_client.get("/document/does-not-exist")
        assert resp.status_code == 200
        assert "not found" in resp.text.lower()

    def test_handles_client_error(self, test_client, mock_client):
        mock_client.reconstruct_doc.side_effect = RuntimeError("DB error")
        resp = test_client.get("/document/doc-uuid-1")
        assert resp.status_code == 200
        assert "DB error" in resp.text


class TestDocumentChunks:
    """Lazy-loaded /document/{id}/chunks partial endpoint."""

    def test_returns_200(self, test_client, mock_client):
        resp = test_client.get("/document/doc-uuid-1/chunks")
        assert resp.status_code == 200

    def test_returns_chunk_content(self, test_client, mock_client):
        resp = test_client.get("/document/doc-uuid-1/chunks")
        assert "Some content here." in resp.text

    def test_calls_list_chunks(self, test_client, mock_client):
        test_client.get("/document/doc-uuid-1/chunks")
        mock_client.list_chunks_for_document.assert_called_once_with("doc-uuid-1")

    def test_includes_hide_button(self, test_client, mock_client):
        """Response must include a Hide chunks button with the correct HTMX endpoint."""
        resp = test_client.get("/document/doc-uuid-1/chunks")
        assert "chunks-hide" in resp.text
        assert "Hide chunks" in resp.text

    def test_includes_document_id_in_hide_link(self, test_client, mock_client):
        resp = test_client.get("/document/doc-uuid-1/chunks")
        assert "doc-uuid-1" in resp.text

    def test_empty_chunks_shows_message(self, test_client, mock_client):
        mock_client.list_chunks_for_document.return_value = []
        resp = test_client.get("/document/doc-uuid-1/chunks")
        assert resp.status_code == 200
        assert "no chunks" in resp.text.lower() or "Re-ingest" in resp.text

    def test_degrades_gracefully_on_db_error(self, test_client, mock_client):
        mock_client.list_chunks_for_document.side_effect = RuntimeError("DB error")
        resp = test_client.get("/document/doc-uuid-1/chunks")
        assert resp.status_code == 200  # graceful degradation, not a 500


class TestDocumentChunksHide:
    """Collapsed Show-chunks button returned by /document/{id}/chunks-hide."""

    def test_returns_200(self, test_client):
        resp = test_client.get("/document/doc-uuid-1/chunks-hide?n=3")
        assert resp.status_code == 200

    def test_contains_show_button(self, test_client):
        resp = test_client.get("/document/doc-uuid-1/chunks-hide?n=3")
        assert "Show 3 chunk(s)" in resp.text

    def test_targets_doc_chunks_div(self, test_client):
        resp = test_client.get("/document/doc-uuid-1/chunks-hide?n=3")
        assert "doc-chunks" in resp.text

    def test_contains_document_id(self, test_client):
        resp = test_client.get("/document/doc-uuid-1/chunks-hide?n=3")
        assert "doc-uuid-1" in resp.text

    def test_zero_chunks_default(self, test_client):
        """n defaults to 0 when omitted."""
        resp = test_client.get("/document/doc-uuid-1/chunks-hide")
        assert resp.status_code == 200
        assert "Show 0 chunk(s)" in resp.text


class TestDocumentDownload:
    """GET /document/{id}/download — returns markdown file."""

    def test_returns_200(self, test_client, mock_client):
        resp = test_client.get("/document/doc-uuid-1/download")
        assert resp.status_code == 200

    def test_content_type_is_markdown(self, test_client, mock_client):
        resp = test_client.get("/document/doc-uuid-1/download")
        assert "text/markdown" in resp.headers["content-type"]

    def test_content_disposition_is_attachment(self, test_client, mock_client):
        resp = test_client.get("/document/doc-uuid-1/download")
        assert resp.headers["content-disposition"].startswith("attachment")

    def test_filename_uses_doc_title(self, test_client, mock_client):
        resp = test_client.get("/document/doc-uuid-1/download")
        assert "Test Document.md" in resp.headers["content-disposition"]

    def test_body_contains_full_content(self, test_client, mock_client):
        resp = test_client.get("/document/doc-uuid-1/download")
        assert "# Test Document" in resp.text

    def test_returns_404_for_missing_document(self, test_client, mock_client):
        mock_client.reconstruct_doc.return_value = None
        resp = test_client.get("/document/missing-id/download")
        assert resp.status_code == 404


class TestDocumentContent:
    """Lazy-loaded /document/{id}/content partial endpoint."""

    def test_returns_200(self, test_client, mock_client):
        resp = test_client.get("/document/doc-uuid-1/content")
        assert resp.status_code == 200

    def test_returns_full_content(self, test_client, mock_client):
        resp = test_client.get("/document/doc-uuid-1/content")
        assert "# Test Document" in resp.text

    def test_calls_reconstruct_doc(self, test_client, mock_client):
        test_client.get("/document/doc-uuid-1/content")
        mock_client.reconstruct_doc.assert_called_with("doc-uuid-1")

    def test_includes_hide_button(self, test_client, mock_client):
        """Response must include a Hide content button with the correct HTMX endpoint."""
        resp = test_client.get("/document/doc-uuid-1/content")
        assert "content-hide" in resp.text
        assert "Hide content" in resp.text

    def test_degrades_gracefully_on_db_error(self, test_client, mock_client):
        mock_client.reconstruct_doc.side_effect = RuntimeError("DB error")
        resp = test_client.get("/document/doc-uuid-1/content")
        assert resp.status_code == 200  # graceful degradation, not a 500


class TestDocumentContentHide:
    """Collapsed Show-content button returned by /document/{id}/content-hide."""

    def test_returns_200(self, test_client):
        resp = test_client.get("/document/doc-uuid-1/content-hide?chars=1500")
        assert resp.status_code == 200

    def test_contains_show_button_with_char_count(self, test_client):
        resp = test_client.get("/document/doc-uuid-1/content-hide?chars=1500")
        assert "Show full content" in resp.text
        assert "1,500" in resp.text

    def test_targets_doc_content_div(self, test_client):
        resp = test_client.get("/document/doc-uuid-1/content-hide?chars=1500")
        assert "doc-content" in resp.text

    def test_contains_document_id(self, test_client):
        resp = test_client.get("/document/doc-uuid-1/content-hide?chars=1500")
        assert "doc-uuid-1" in resp.text

    def test_zero_chars_shows_placeholder(self, test_client):
        """chars defaults to 0 — should show '?' instead of '0'."""
        resp = test_client.get("/document/doc-uuid-1/content-hide")
        assert resp.status_code == 200
        assert "?" in resp.text


# ── Ingest page ───────────────────────────────────────────────────────────────


class TestIngestPage:
    def test_get_returns_200(self, test_client):
        resp = test_client.get("/ingest")
        assert resp.status_code == 200

    def test_form_is_present(self, test_client):
        resp = test_client.get("/ingest")
        assert "<form" in resp.text
        assert 'name="content"' in resp.text

    def test_paste_ingest_success(self, test_client, mock_client):
        from cerefox.ingestion.pipeline import IngestResult

        mock_result = IngestResult(
            document_id="new-uuid",
            title="My Note",
            chunk_count=1,
            total_chars=100,
            action="created",
        )
        with patch("cerefox.api.routes.IngestionPipeline") as MockPipeline:
            MockPipeline.return_value.ingest_text.return_value = mock_result
            resp = test_client.post(
                "/ingest",
                data={"mode": "paste", "title": "My Note", "content": "# My Note\n\nHello."},
                headers={"HX-Request": "true"},
            )
        assert resp.status_code == 200
        assert "My Note" in resp.text

    def test_paste_ingest_skipped(self, test_client, mock_client):
        from cerefox.ingestion.pipeline import IngestResult

        mock_result = IngestResult(
            document_id="existing-uuid",
            title="My Note",
            chunk_count=1,
            total_chars=100,
            action="skipped",
        )
        with patch("cerefox.api.routes.IngestionPipeline") as MockPipeline:
            MockPipeline.return_value.ingest_text.return_value = mock_result
            resp = test_client.post(
                "/ingest",
                data={"mode": "paste", "title": "My Note", "content": "# My Note\n\nHello."},
                headers={"HX-Request": "true"},
            )
        assert resp.status_code == 200
        assert "Skipped" in resp.text or "skipped" in resp.text.lower()

    def test_paste_ingest_missing_title_shows_error(self, test_client):
        resp = test_client.post(
            "/ingest",
            data={"mode": "paste", "title": "", "content": "Some content."},
            headers={"HX-Request": "true"},
        )
        assert resp.status_code == 200
        assert "Title" in resp.text or "title" in resp.text.lower()

    def test_paste_ingest_missing_content_shows_error(self, test_client):
        resp = test_client.post(
            "/ingest",
            data={"mode": "paste", "title": "My Note", "content": ""},
            headers={"HX-Request": "true"},
        )
        assert resp.status_code == 200
        assert "empty" in resp.text.lower() or "Content" in resp.text

    def test_file_upload_ingest_success(self, test_client, mock_client):
        from cerefox.ingestion.pipeline import IngestResult

        mock_result = IngestResult(
            document_id="new-uuid",
            title="uploaded.md",
            chunk_count=2,
            total_chars=200,
            action="created",
        )
        with patch("cerefox.api.routes.IngestionPipeline") as MockPipeline:
            MockPipeline.return_value.ingest_text.return_value = mock_result
            resp = test_client.post(
                "/ingest",
                data={"mode": "file", "title": ""},
                files={"file": ("uploaded.md", b"# Hello\n\nContent.", "text/plain")},
                headers={"HX-Request": "true"},
            )
        assert resp.status_code == 200
        assert "Ingested" in resp.text or "uploaded.md" in resp.text

    def test_ingest_pipeline_error_shows_error(self, test_client):
        with patch("cerefox.api.routes.IngestionPipeline") as MockPipeline:
            MockPipeline.return_value.ingest_text.side_effect = RuntimeError("Embed failed")
            resp = test_client.post(
                "/ingest",
                data={"mode": "paste", "title": "My Note", "content": "Content here."},
                headers={"HX-Request": "true"},
            )
        assert resp.status_code == 200
        assert "Embed failed" in resp.text

    def test_paste_ingest_passes_dynamic_metadata(self, test_client, mock_client):
        from cerefox.ingestion.pipeline import IngestResult

        mock_result = IngestResult(
            document_id="new-uuid", title="T", chunk_count=1,
            total_chars=10, action="created",
        )
        with patch("cerefox.api.routes.IngestionPipeline") as MockPipeline:
            MockPipeline.return_value.ingest_text.return_value = mock_result
            test_client.post(
                "/ingest",
                data={
                    "mode": "paste", "title": "T", "content": "# T\n\nB.",
                    "meta_key[]": ["author", "tags"],
                    "meta_value[]": ["Alice", "fiction"],
                },
                headers={"HX-Request": "true"},
            )
            call_args = MockPipeline.return_value.ingest_text.call_args
        assert call_args is not None, "ingest_text was never called"
        assert call_args.kwargs["metadata"] == {"author": "Alice", "tags": "fiction"}


# ── Projects page ─────────────────────────────────────────────────────────────


class TestProjectsPage:
    def test_returns_200(self, test_client):
        resp = test_client.get("/projects")
        assert resp.status_code == 200

    def test_shows_project_names(self, test_client, mock_client):
        mock_client.list_projects.return_value = [
            _make_project(name="Alpha"),
            _make_project(id="proj-2", name="Beta"),
        ]
        resp = test_client.get("/projects")
        assert "Alpha" in resp.text
        assert "Beta" in resp.text

    def test_empty_projects_shows_message(self, test_client, mock_client):
        mock_client.list_projects.return_value = []
        resp = test_client.get("/projects")
        assert resp.status_code == 200
        assert "No projects" in resp.text

    def test_create_project_redirects(self, test_client, mock_client):
        mock_client.create_project.return_value = _make_project(name="New")
        resp = test_client.post(
            "/projects", data={"name": "New", "description": ""}, follow_redirects=False
        )
        assert resp.status_code == 303
        assert resp.headers["location"] == "/projects"

    def test_create_project_calls_client(self, test_client, mock_client):
        mock_client.create_project.return_value = _make_project(name="New")
        test_client.post("/projects", data={"name": "New", "description": "Desc"})
        mock_client.create_project.assert_called_once_with("New", "Desc")

    def test_delete_project_redirects(self, test_client, mock_client):
        resp = test_client.post(
            "/projects/proj-uuid-1/delete", follow_redirects=False
        )
        assert resp.status_code == 303
        assert resp.headers["location"] == "/projects"

    def test_delete_project_calls_client(self, test_client, mock_client):
        test_client.post("/projects/proj-uuid-1/delete")
        mock_client.delete_project.assert_called_once_with("proj-uuid-1")

    def test_handles_client_error(self, test_client, mock_client):
        mock_client.list_projects.side_effect = RuntimeError("DB error")
        resp = test_client.get("/projects")
        assert resp.status_code == 200
        assert "DB error" in resp.text



# TestSettingsPage removed — Settings page and metadata key registry are being
# removed as part of the metadata-to-dynamic refactor (Iteration 11).


# ── check-filename API ────────────────────────────────────────────────────────


class TestCheckFilename:
    """GET /api/check-filename — HTMX partial for duplicate-filename detection."""

    def test_returns_200_with_no_filename(self, test_client, mock_client):
        resp = test_client.get("/api/check-filename")
        assert resp.status_code == 200

    def test_empty_filename_returns_empty_partial(self, test_client, mock_client):
        """Empty filename → no lookup, empty HTML (no warning shown)."""
        resp = test_client.get("/api/check-filename?filename=")
        assert resp.status_code == 200
        assert "Existing document" not in resp.text
        mock_client.find_document_by_source_path.assert_not_called()

    def test_no_match_returns_empty_partial(self, test_client, mock_client):
        mock_client.find_document_by_source_path.return_value = None
        resp = test_client.get("/api/check-filename?filename=new-note.md")
        assert resp.status_code == 200
        assert "Existing document" not in resp.text

    def test_match_returns_warning_with_doc_title(self, test_client, mock_client):
        mock_client.find_document_by_source_path.return_value = _make_doc(
            title="My Existing Note"
        )
        resp = test_client.get("/api/check-filename?filename=test.md")
        assert resp.status_code == 200
        assert "Existing document" in resp.text
        assert "My Existing Note" in resp.text

    def test_match_includes_update_checkbox(self, test_client, mock_client):
        mock_client.find_document_by_source_path.return_value = _make_doc()
        resp = test_client.get("/api/check-filename?filename=test.md")
        assert "update_existing" in resp.text

    def test_calls_find_document_by_source_path(self, test_client, mock_client):
        mock_client.find_document_by_source_path.return_value = None
        test_client.get("/api/check-filename?filename=note.md")
        mock_client.find_document_by_source_path.assert_called_once_with("note.md")

    def test_degrades_gracefully_on_db_error(self, test_client, mock_client):
        """DB errors are swallowed — the check is advisory only."""
        mock_client.find_document_by_source_path.side_effect = RuntimeError("DB error")
        resp = test_client.get("/api/check-filename?filename=note.md")
        assert resp.status_code == 200
        # No warning shown when lookup fails silently
        assert "Existing document" not in resp.text


# ── update-content ────────────────────────────────────────────────────────────


class TestDocumentUpdateContent:
    """POST /document/{id}/update-content — replace a document's file content."""

    def _post_file(self, test_client, doc_id: str, content: bytes = b"# Hello\n\nContent."):
        return test_client.post(
            f"/document/{doc_id}/update-content",
            files={"file": ("note.md", content, "text/plain")},
        )

    def test_returns_200_on_success(self, test_client, mock_client, mock_embedder):
        from cerefox.ingestion.pipeline import IngestResult

        mock_client.get_document_by_id.return_value = _make_doc()
        with patch("cerefox.api.routes.IngestionPipeline") as MockPipeline:
            MockPipeline.return_value.update_document.return_value = IngestResult(
                document_id="doc-uuid-1", title="Test Document",
                chunk_count=1, total_chars=100, action="updated", reindexed=True,
            )
            resp = self._post_file(test_client, "doc-uuid-1")
        assert resp.status_code == 200

    def test_success_shows_reindexed_message(self, test_client, mock_client, mock_embedder):
        from cerefox.ingestion.pipeline import IngestResult

        mock_client.get_document_by_id.return_value = _make_doc()
        with patch("cerefox.api.routes.IngestionPipeline") as MockPipeline:
            MockPipeline.return_value.update_document.return_value = IngestResult(
                document_id="doc-uuid-1", title="Test Document",
                chunk_count=1, total_chars=100, action="updated", reindexed=True,
            )
            resp = self._post_file(test_client, "doc-uuid-1")
        assert "re-indexed" in resp.text or "replaced" in resp.text.lower()

    def test_success_without_reindex_shows_info_message(
        self, test_client, mock_client, mock_embedder
    ):
        from cerefox.ingestion.pipeline import IngestResult

        mock_client.get_document_by_id.return_value = _make_doc()
        with patch("cerefox.api.routes.IngestionPipeline") as MockPipeline:
            MockPipeline.return_value.update_document.return_value = IngestResult(
                document_id="doc-uuid-1", title="Test Document",
                chunk_count=1, total_chars=100, action="updated", reindexed=False,
            )
            resp = self._post_file(test_client, "doc-uuid-1")
        assert resp.status_code == 200
        assert "identical" in resp.text

    def test_missing_file_shows_error(self, test_client, mock_client):
        resp = test_client.post("/document/doc-uuid-1/update-content")
        assert resp.status_code == 200
        assert "No file" in resp.text or "error" in resp.text.lower()

    def test_no_embedder_shows_error(self, test_client_no_embedder, mock_client):
        resp = test_client_no_embedder.post(
            "/document/doc-uuid-1/update-content",
            files={"file": ("note.md", b"content", "text/plain")},
        )
        assert resp.status_code == 200
        assert "Embedder" in resp.text or "embedder" in resp.text.lower()

    def test_document_not_found_shows_error(self, test_client, mock_client):
        mock_client.get_document_by_id.return_value = None
        resp = self._post_file(test_client, "nonexistent-id")
        assert resp.status_code == 200
        assert "not found" in resp.text.lower()

    def test_pipeline_error_shows_error(self, test_client, mock_client):
        mock_client.get_document_by_id.return_value = _make_doc()
        with patch("cerefox.api.routes.IngestionPipeline") as MockPipeline:
            MockPipeline.return_value.update_document.side_effect = RuntimeError("Embed failed")
            resp = self._post_file(test_client, "doc-uuid-1")
        assert resp.status_code == 200
        assert "Embed failed" in resp.text

    def test_calls_update_document_with_correct_title(
        self, test_client, mock_client, mock_embedder
    ):
        from cerefox.ingestion.pipeline import IngestResult

        mock_client.get_document_by_id.return_value = _make_doc(title="My Real Title")
        with patch("cerefox.api.routes.IngestionPipeline") as MockPipeline:
            MockPipeline.return_value.update_document.return_value = IngestResult(
                document_id="doc-uuid-1", title="My Real Title",
                chunk_count=1, total_chars=100, action="updated", reindexed=True,
            )
            self._post_file(test_client, "doc-uuid-1")
        call_kwargs = MockPipeline.return_value.update_document.call_args[1]
        assert call_kwargs.get("title") == "My Real Title"
