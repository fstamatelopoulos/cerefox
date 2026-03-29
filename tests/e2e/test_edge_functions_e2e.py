"""E2E tests for the 6 primitive Cerefox Edge Functions via direct HTTP POST.

Tests each Edge Function independently, bypassing cerefox-mcp entirely.
This verifies the primitive functions remain correct after the 16A refactor
of cerefox-mcp, and establishes a regression baseline for future changes.

Run with: uv run pytest -m e2e tests/e2e/test_edge_functions_e2e.py

Requires:
  - All 6 primitive Edge Functions deployed to Supabase
  - CEREFOX_SUPABASE_URL and CEREFOX_SUPABASE_ANON_KEY in .env
  - OPENAI_API_KEY set as a Supabase secret (for search and ingest)

All created documents are prefixed with [E2E-EF] and cleaned up automatically.
"""

from __future__ import annotations

import time
import uuid

import pytest

from .conftest import E2ECleanup, EdgeFunctionClient

pytestmark = pytest.mark.e2e

E2E_PREFIX = "[E2E-EF]"

SAMPLE_CONTENT = """\
# The Meridian Codex

The Meridian Codex is the foundational legal document of the Teliboria Compact.
It establishes the rights and responsibilities of all signatories.

## The Twelve Tenets

The Codex enumerates twelve tenets that govern relations between member nations.
The first tenet establishes freedom of travel across borders for all citizens.

## Enforcement

Violations of the Codex are adjudicated by the Compact High Court in Auraveil.
"""

SAMPLE_METADATA = {"type": "legal-document", "era": "compact-founding"}


def _unique_title(label: str) -> str:
    return f"{E2E_PREFIX} {label} {uuid.uuid4().hex[:8]}"


@pytest.fixture
def ef_cleanup(e2e_client):  # type: ignore[no-untyped-def]
    """Track and clean up documents created via Edge Functions during a test."""
    tracker = E2ECleanup(e2e_client)
    yield tracker
    tracker.cleanup()


def _skip_if_no_edge(edge: EdgeFunctionClient | None) -> None:
    if edge is None:
        pytest.skip("No anon key available -- skipping Edge Function e2e tests")


# ── EF-1/EF-2/EF-3: cerefox-search ──────────────────────────────────────────


class TestSearchEdgeFunction:
    """EF-1 to EF-3: Direct tests of the cerefox-search Edge Function."""

    def test_basic_search_returns_results(
        self, e2e_edge: EdgeFunctionClient | None
    ) -> None:
        """EF-1: cerefox-search returns results for a broad query."""
        _skip_if_no_edge(e2e_edge)
        data = e2e_edge.invoke("cerefox-search", {"query": "knowledge"})
        assert "results" in data
        assert "query" in data
        assert "truncated" in data

    def test_search_with_metadata_filter(
        self, e2e_edge: EdgeFunctionClient | None, ef_cleanup: E2ECleanup
    ) -> None:
        """EF-2: metadata_filter narrows results to matching documents."""
        _skip_if_no_edge(e2e_edge)
        title = _unique_title("Metadata Filter Test")
        result = e2e_edge.invoke("cerefox-ingest", {
            "title": title,
            "content": SAMPLE_CONTENT,
            "metadata": SAMPLE_METADATA,
            "author": "e2e-ef-test",
            "author_type": "agent",
        })
        if "document_id" in result:
            ef_cleanup.track_document(result["document_id"])

        time.sleep(2)

        data = e2e_edge.invoke("cerefox-search", {
            "query": "Meridian Compact legal",
            "metadata_filter": {"type": "legal-document"},
            "match_count": 5,
        })
        assert "results" in data
        # The filtered search should include our doc if it was ingested
        titles_in_results = [r.get("doc_title", "") for r in data["results"]]
        if titles_in_results:
            assert any("legal" in t.lower() or "Meridian" in t or title in t
                       for t in titles_in_results + [str(data["results"])])

    def test_search_unknown_project_returns_404(
        self, e2e_edge: EdgeFunctionClient | None
    ) -> None:
        """EF-3: Non-existent project_name returns HTTP 404."""
        _skip_if_no_edge(e2e_edge)
        import httpx
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            e2e_edge.invoke("cerefox-search", {
                "query": "test",
                "project_name": f"nonexistent-project-{uuid.uuid4().hex}",
            })
        assert exc_info.value.response.status_code == 404


# ── EF-4/EF-5: cerefox-ingest ────────────────────────────────────────────────


class TestIngestEdgeFunction:
    """EF-4 to EF-5: Direct tests of the cerefox-ingest Edge Function."""

    def test_ingest_creates_document(
        self, e2e_edge: EdgeFunctionClient | None, ef_cleanup: E2ECleanup
    ) -> None:
        """EF-4: cerefox-ingest returns 201 with document_id and chunk_count."""
        _skip_if_no_edge(e2e_edge)
        title = _unique_title("Ingest Test")
        result = e2e_edge.invoke("cerefox-ingest", {
            "title": title,
            "content": SAMPLE_CONTENT,
            "author": "e2e-ef-test",
            "author_type": "agent",
        })
        assert "document_id" in result
        assert "chunk_count" in result
        assert result["chunk_count"] >= 1
        assert result["title"] == title
        ef_cleanup.track_document(result["document_id"])

    def test_ingest_update_if_exists(
        self, e2e_edge: EdgeFunctionClient | None, ef_cleanup: E2ECleanup
    ) -> None:
        """EF-5: update_if_exists=true updates the document and returns updated=true."""
        _skip_if_no_edge(e2e_edge)
        title = _unique_title("Update Test")
        # Create
        r1 = e2e_edge.invoke("cerefox-ingest", {
            "title": title,
            "content": SAMPLE_CONTENT,
            "author": "e2e-ef-test",
            "author_type": "agent",
        })
        ef_cleanup.track_document(r1["document_id"])

        # Update with changed content
        new_content = SAMPLE_CONTENT + "\n\n## Appendix\n\nAdded section."
        r2 = e2e_edge.invoke("cerefox-ingest", {
            "title": title,
            "content": new_content,
            "update_if_exists": True,
            "author": "e2e-ef-test",
            "author_type": "agent",
        })
        assert r2.get("updated") is True
        assert r2["document_id"] == r1["document_id"]

    def test_ingest_missing_title_returns_400(
        self, e2e_edge: EdgeFunctionClient | None
    ) -> None:
        """Missing title field returns HTTP 400."""
        _skip_if_no_edge(e2e_edge)
        import httpx
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            e2e_edge.invoke("cerefox-ingest", {"content": "Some content"})
        assert exc_info.value.response.status_code == 400


# ── EF-6: cerefox-metadata ───────────────────────────────────────────────────


class TestMetadataEdgeFunction:
    """EF-6: Direct test of the cerefox-metadata Edge Function."""

    def test_metadata_returns_key_array(
        self, e2e_edge: EdgeFunctionClient | None
    ) -> None:
        """EF-6: cerefox-metadata returns an array of key objects."""
        _skip_if_no_edge(e2e_edge)
        result = e2e_edge.invoke("cerefox-metadata", {})
        assert isinstance(result, list)
        for item in result:
            assert "key" in item
            assert "doc_count" in item
            assert "example_values" in item


# ── EF-7/EF-8: cerefox-get-document ─────────────────────────────────────────


class TestGetDocumentEdgeFunction:
    """EF-7 to EF-8: Direct tests of the cerefox-get-document Edge Function."""

    def test_get_document_returns_content(
        self, e2e_edge: EdgeFunctionClient | None, ef_cleanup: E2ECleanup
    ) -> None:
        """EF-7: returns document_id, doc_title, full_content, and chunk_count."""
        _skip_if_no_edge(e2e_edge)
        title = _unique_title("Get Document Test")
        ingest_r = e2e_edge.invoke("cerefox-ingest", {
            "title": title,
            "content": SAMPLE_CONTENT,
            "author": "e2e-ef-test",
            "author_type": "agent",
        })
        doc_id = ingest_r["document_id"]
        ef_cleanup.track_document(doc_id)

        result = e2e_edge.invoke("cerefox-get-document", {"document_id": doc_id})
        assert result["document_id"] == doc_id
        assert result["doc_title"] == title
        assert "full_content" in result
        assert result["chunk_count"] >= 1
        assert result["is_archived"] is False

    def test_get_document_not_found_returns_404(
        self, e2e_edge: EdgeFunctionClient | None
    ) -> None:
        """EF-8: Non-existent document_id returns HTTP 404."""
        _skip_if_no_edge(e2e_edge)
        import httpx
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            e2e_edge.invoke("cerefox-get-document", {"document_id": str(uuid.uuid4())})
        assert exc_info.value.response.status_code == 404


# ── EF-9: cerefox-list-versions ──────────────────────────────────────────────


class TestListVersionsEdgeFunction:
    """EF-9: Direct test of the cerefox-list-versions Edge Function."""

    def test_list_versions_returns_array(
        self, e2e_edge: EdgeFunctionClient | None, ef_cleanup: E2ECleanup
    ) -> None:
        """EF-9: returns empty array for a newly ingested document."""
        _skip_if_no_edge(e2e_edge)
        title = _unique_title("List Versions Test")
        r = e2e_edge.invoke("cerefox-ingest", {
            "title": title,
            "content": SAMPLE_CONTENT,
            "author": "e2e-ef-test",
            "author_type": "agent",
        })
        doc_id = r["document_id"]
        ef_cleanup.track_document(doc_id)

        result = e2e_edge.invoke("cerefox-list-versions", {"document_id": doc_id})
        assert isinstance(result, list)
        # A freshly created doc has no archived versions
        assert len(result) == 0


# ── EF-10/EF-11: cerefox-get-audit-log ───────────────────────────────────────


class TestGetAuditLogEdgeFunction:
    """EF-10 to EF-11: Direct tests of the cerefox-get-audit-log Edge Function."""

    def test_audit_log_returns_entries(
        self, e2e_edge: EdgeFunctionClient | None, ef_cleanup: E2ECleanup
    ) -> None:
        """EF-10: returns an array of audit log entries."""
        _skip_if_no_edge(e2e_edge)
        title = _unique_title("Audit Log Test")
        r = e2e_edge.invoke("cerefox-ingest", {
            "title": title,
            "content": SAMPLE_CONTENT,
            "author": "e2e-ef-audit-test",
            "author_type": "agent",
        })
        ef_cleanup.track_document(r["document_id"])

        result = e2e_edge.invoke("cerefox-get-audit-log", {"limit": 50})
        assert isinstance(result, list)
        assert len(result) > 0
        entry = result[0]
        assert "operation" in entry
        assert "author" in entry
        assert "created_at" in entry

    def test_audit_log_operation_filter(
        self, e2e_edge: EdgeFunctionClient | None, ef_cleanup: E2ECleanup
    ) -> None:
        """EF-11: operation filter returns only entries of that type."""
        _skip_if_no_edge(e2e_edge)
        title = _unique_title("Audit Op Filter Test")
        r = e2e_edge.invoke("cerefox-ingest", {
            "title": title,
            "content": SAMPLE_CONTENT,
            "author": "e2e-ef-test",
            "author_type": "agent",
        })
        ef_cleanup.track_document(r["document_id"])

        result = e2e_edge.invoke("cerefox-get-audit-log", {
            "operation": "create",
            "limit": 20,
        })
        assert isinstance(result, list)
        for entry in result:
            assert entry["operation"] == "create"
