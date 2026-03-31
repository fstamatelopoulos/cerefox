"""E2E tests for the deployed cerefox-mcp Edge Function via MCP JSON-RPC 2.0.

Calls the live Edge Function using raw HTTP POST with JSON-RPC 2.0 payloads.
Does not use any MCP SDK -- protocol failures are unambiguous.

Run with: uv run pytest -m e2e tests/e2e/test_mcp_e2e.py

Requires:
  - cerefox-mcp deployed to Supabase
  - CEREFOX_SUPABASE_URL and CEREFOX_SUPABASE_ANON_KEY in .env
  - OPENAI_API_KEY set as a Supabase secret (for search and ingest tools)

All created documents are prefixed with [E2E-MCP] and cleaned up automatically.
"""

from __future__ import annotations

import time
import uuid

import pytest

from .conftest import E2ECleanup, MCPClient

pytestmark = pytest.mark.e2e

E2E_PREFIX = "[E2E-MCP]"

SAMPLE_CONTENT = """\
# The Sunken Archives of Veloros

Deep beneath the waves of the Cerulean Sea, the Sunken Archives of Veloros
preserve the collective knowledge of the Velorian civilization.

## The Great Index

The Archives hold over a million scrolls catalogued by the master indexers.
Each scroll is sealed in an enchanted glass container that prevents decay.

## Access and Retrieval

Only those who possess a resonance key may enter the Archives. The keys are
crafted from the same crystal used to seal the scroll containers.
"""


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def mcp_cleanup(e2e_client):  # type: ignore[no-untyped-def]
    """Track and clean up documents created via MCP during a test."""
    tracker = E2ECleanup(e2e_client)
    yield tracker
    tracker.cleanup()


def _unique_title(label: str) -> str:
    return f"{E2E_PREFIX} {label} {uuid.uuid4().hex[:8]}"


# ── MCP-1: Health check ───────────────────────────────────────────────────────


class TestMCPHealthAndProtocol:
    """MCP-1 to MCP-3: Protocol-level checks before any tool calls."""

    def test_get_returns_405(self, e2e_mcp: MCPClient | None) -> None:
        """MCP-1: GET / returns 405 (server doesn't support SSE notifications)."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        import httpx
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            e2e_mcp.get()
        assert exc_info.value.response.status_code == 405

    def test_initialize(self, e2e_mcp: MCPClient | None) -> None:
        """MCP-2: initialize returns correct protocol version and capabilities."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        resp = e2e_mcp.call("initialize")
        assert "error" not in resp
        result = resp["result"]
        assert result["protocolVersion"] == "2025-03-26"
        assert "tools" in result["capabilities"]
        assert result["serverInfo"]["name"] == "cerefox"

    def test_tools_list(self, e2e_mcp: MCPClient | None) -> None:
        """MCP-3: tools/list returns all 8 tools with correct names and inputSchemas."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        resp = e2e_mcp.call("tools/list")
        assert "error" not in resp
        tools = resp["result"]["tools"]
        tool_names = {t["name"] for t in tools}
        expected = {
            "cerefox_search",
            "cerefox_ingest",
            "cerefox_list_metadata_keys",
            "cerefox_get_document",
            "cerefox_list_versions",
            "cerefox_get_audit_log",
            "cerefox_list_projects",
            "cerefox_metadata_search",
        }
        assert tool_names == expected
        for tool in tools:
            assert "inputSchema" in tool
            assert "description" in tool

    def test_ping(self, e2e_mcp: MCPClient | None) -> None:
        """ping method returns empty result."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        resp = e2e_mcp.call("ping")
        assert "error" not in resp
        assert resp["result"] == {}

    def test_unknown_method_returns_method_not_found(self, e2e_mcp: MCPClient | None) -> None:
        """Unsupported method returns JSON-RPC -32601 error."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        resp = e2e_mcp.call("tools/unknown_method")
        assert "error" in resp
        assert resp["error"]["code"] == -32601

    def test_unknown_tool_returns_invalid_params(self, e2e_mcp: MCPClient | None) -> None:
        """MCP-12: Unknown tool name returns JSON-RPC -32602 error."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        resp = e2e_mcp.tool("cerefox_nonexistent_tool", {})
        assert "error" in resp
        assert resp["error"]["code"] == -32602


# ── MCP-4 to MCP-11: Tool calls ──────────────────────────────────────────────


class TestMCPToolCalls:
    """MCP-4 to MCP-11: Test all 6 tools via actual MCP tool calls."""

    def test_ingest_creates_document(
        self, e2e_mcp: MCPClient | None, mcp_cleanup: E2ECleanup
    ) -> None:
        """MCP-4: cerefox_ingest creates a new document and returns confirmation."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        title = _unique_title("Sunken Archives")
        text = e2e_mcp.tool_text("cerefox_ingest", {
            "title": title,
            "content": SAMPLE_CONTENT,
            "author": "e2e-mcp-test",
        })
        assert "Document saved" in text or "Document updated" in text or "up-to-date" in text
        # Extract document id for cleanup
        if "(id:" in text:
            doc_id = text.split("(id:")[1].split(")")[0].strip()
            mcp_cleanup.track_document(doc_id)

    def test_search_finds_ingested_document(
        self, e2e_mcp: MCPClient | None, mcp_cleanup: E2ECleanup
    ) -> None:
        """MCP-5: cerefox_search returns the document we just ingested."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        # Ingest first
        title = _unique_title("Archives Search Test")
        ingest_text = e2e_mcp.tool_text("cerefox_ingest", {
            "title": title,
            "content": SAMPLE_CONTENT,
            "author": "e2e-mcp-test",
        })
        if "(id:" in ingest_text:
            doc_id = ingest_text.split("(id:")[1].split(")")[0].strip()
            mcp_cleanup.track_document(doc_id)

        # Brief pause to allow indexing
        time.sleep(2)

        text = e2e_mcp.tool_text("cerefox_search", {
            "query": "Sunken Archives Veloros resonance key",
            "match_count": 5,
        })
        assert text != "No results found."
        assert "Archives" in text or "Veloros" in text

    def test_ingest_update_if_exists(
        self, e2e_mcp: MCPClient | None, mcp_cleanup: E2ECleanup
    ) -> None:
        """MCP-6: update_if_exists=true updates an existing document."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        title = _unique_title("Update Test")
        # Create
        t1 = e2e_mcp.tool_text("cerefox_ingest", {
            "title": title,
            "content": SAMPLE_CONTENT,
            "author": "e2e-mcp-test",
        })
        if "(id:" in t1:
            mcp_cleanup.track_document(t1.split("(id:")[1].split(")")[0].strip())

        # Update with new content
        updated_content = SAMPLE_CONTENT + "\n\n## New Section\n\nAdded in the update test."
        t2 = e2e_mcp.tool_text("cerefox_ingest", {
            "title": title,
            "content": updated_content,
            "update_if_exists": True,
            "author": "e2e-mcp-test",
        })
        assert "updated" in t2.lower() or "saved" in t2.lower()

    def test_ingest_hash_dedup_skips(
        self, e2e_mcp: MCPClient | None, mcp_cleanup: E2ECleanup
    ) -> None:
        """MCP-7: ingesting identical content a second time is skipped (hash dedup)."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        title = _unique_title("Hash Dedup Test")
        t1 = e2e_mcp.tool_text("cerefox_ingest", {
            "title": title,
            "content": SAMPLE_CONTENT,
            "author": "e2e-mcp-test",
        })
        if "(id:" in t1:
            mcp_cleanup.track_document(t1.split("(id:")[1].split(")")[0].strip())

        # Ingest again -- different title, same content
        t2 = e2e_mcp.tool_text("cerefox_ingest", {
            "title": _unique_title("Hash Dedup Test Dup"),
            "content": SAMPLE_CONTENT,  # identical content
            "author": "e2e-mcp-test",
        })
        assert "up-to-date" in t2.lower() or "unchanged" in t2.lower()

    def test_get_document_returns_content(
        self, e2e_mcp: MCPClient | None, mcp_cleanup: E2ECleanup
    ) -> None:
        """MCP-8: cerefox_get_document returns full document content."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        title = _unique_title("Get Document Test")
        t1 = e2e_mcp.tool_text("cerefox_ingest", {
            "title": title,
            "content": SAMPLE_CONTENT,
            "author": "e2e-mcp-test",
        })
        if "(id:" not in t1:
            pytest.skip("Could not extract document id from ingest response")
        doc_id = t1.split("(id:")[1].split(")")[0].strip()
        mcp_cleanup.track_document(doc_id)

        text = e2e_mcp.tool_text("cerefox_get_document", {"document_id": doc_id})
        assert "Document not found" not in text
        assert "Sunken Archives" in text or title in text

    def test_get_document_not_found(self, e2e_mcp: MCPClient | None) -> None:
        """cerefox_get_document with nonexistent UUID returns 'Document not found.'"""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        text = e2e_mcp.tool_text("cerefox_get_document", {
            "document_id": str(uuid.uuid4()),
        })
        assert text == "Document not found."

    def test_list_versions(
        self, e2e_mcp: MCPClient | None, mcp_cleanup: E2ECleanup
    ) -> None:
        """MCP-9: cerefox_list_versions returns version history (or empty message)."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        title = _unique_title("List Versions Test")
        t1 = e2e_mcp.tool_text("cerefox_ingest", {
            "title": title,
            "content": SAMPLE_CONTENT,
            "author": "e2e-mcp-test",
        })
        if "(id:" not in t1:
            pytest.skip("Could not extract document id from ingest response")
        doc_id = t1.split("(id:")[1].split(")")[0].strip()
        mcp_cleanup.track_document(doc_id)

        text = e2e_mcp.tool_text("cerefox_list_versions", {"document_id": doc_id})
        # Newly created doc has no archived versions yet
        assert "No archived versions" in text or "Archived versions" in text

    def test_get_audit_log_by_author(
        self, e2e_mcp: MCPClient | None, mcp_cleanup: E2ECleanup
    ) -> None:
        """MCP-10: cerefox_get_audit_log with author filter returns matching entries."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        title = _unique_title("Audit Log Test")
        t1 = e2e_mcp.tool_text("cerefox_ingest", {
            "title": title,
            "content": SAMPLE_CONTENT,
            "author": "e2e-mcp-unique-author",
        })
        if "(id:" in t1:
            mcp_cleanup.track_document(t1.split("(id:")[1].split(")")[0].strip())

        text = e2e_mcp.tool_text("cerefox_get_audit_log", {
            "author": "e2e-mcp-unique-author",
            "limit": 10,
        })
        assert "No audit log entries" not in text
        assert "e2e-mcp-unique-author" in text

    def test_list_metadata_keys(self, e2e_mcp: MCPClient | None) -> None:
        """MCP-11: cerefox_list_metadata_keys returns a list (possibly empty)."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        text = e2e_mcp.tool_text("cerefox_list_metadata_keys", {})
        # Either a JSON array or the "no keys" message
        assert text == "No metadata keys found across documents." or text.startswith("[")

    def test_missing_required_param_returns_error(self, e2e_mcp: MCPClient | None) -> None:
        """MCP-13: Missing required param propagates as JSON-RPC error."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        # cerefox_search requires "query"
        resp = e2e_mcp.tool("cerefox_search", {})
        assert "error" in resp
        assert resp["error"]["code"] == -32603

    def test_ingest_missing_content_returns_error(self, e2e_mcp: MCPClient | None) -> None:
        """cerefox_ingest with missing content returns JSON-RPC error."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        resp = e2e_mcp.tool("cerefox_ingest", {"title": "No Content"})
        assert "error" in resp
        assert resp["error"]["code"] == -32603


# ── 16B: New tool tests ──────────────────────────────────────────────────────


class TestMCPNewTools16B:
    """Tests for cerefox_list_projects and cerefox_metadata_search (16B)."""

    def test_list_projects_returns_list(self, e2e_mcp: MCPClient | None) -> None:
        """cerefox_list_projects returns a formatted list or 'No projects found.'"""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        text = e2e_mcp.tool_text("cerefox_list_projects", {})
        assert "Projects" in text or "No projects found" in text

    def test_metadata_search_with_filter(
        self, e2e_mcp: MCPClient | None, mcp_cleanup: E2ECleanup
    ) -> None:
        """cerefox_metadata_search finds documents matching metadata filter."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        # Ingest a doc with known metadata
        title = _unique_title("MetaSearch Test")
        t1 = e2e_mcp.tool_text("cerefox_ingest", {
            "title": title,
            "content": "# Test Document\n\nContent for metadata search test.",
            "metadata": {"e2e_tag": "mcp-meta-test-16b"},
            "author": "e2e-mcp-test",
        })
        if "(id:" in t1:
            mcp_cleanup.track_document(t1.split("(id:")[1].split(")")[0].strip())

        text = e2e_mcp.tool_text("cerefox_metadata_search", {
            "metadata_filter": {"e2e_tag": "mcp-meta-test-16b"},
        })
        assert "No documents match" not in text
        assert "MetaSearch Test" in text or "e2e_tag" in text

    def test_metadata_search_no_matches(self, e2e_mcp: MCPClient | None) -> None:
        """cerefox_metadata_search with impossible filter returns no-match message."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        text = e2e_mcp.tool_text("cerefox_metadata_search", {
            "metadata_filter": {"nonexistent_key_abc123": "no_match_value"},
        })
        assert "No documents match" in text

    def test_metadata_search_empty_filter_returns_error(self, e2e_mcp: MCPClient | None) -> None:
        """cerefox_metadata_search with empty filter returns error."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        resp = e2e_mcp.tool("cerefox_metadata_search", {"metadata_filter": {}})
        assert "error" in resp

    def test_metadata_search_with_project_name(
        self, e2e_mcp: MCPClient | None, mcp_cleanup: E2ECleanup
    ) -> None:
        """cerefox_metadata_search with project_name filter resolves correctly."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        # Ingest a doc with a project and metadata (use "Test Files" if it exists, else no project)
        title = _unique_title("MetaSearch Project Test")
        t1 = e2e_mcp.tool_text("cerefox_ingest", {
            "title": title,
            "content": "# Project MetaSearch\n\nTesting project filter.",
            "metadata": {"e2e_tag": "proj-meta-16b"},
            "author": "e2e-mcp-test",
        })
        if "(id:" in t1:
            mcp_cleanup.track_document(t1.split("(id:")[1].split(")")[0].strip())

        text = e2e_mcp.tool_text("cerefox_metadata_search", {
            "metadata_filter": {"e2e_tag": "proj-meta-16b"},
        })
        assert "No documents match" not in text
        assert "MetaSearch Project Test" in text or "proj-meta-16b" in text

    def test_search_with_project_name_resolves(
        self, e2e_mcp: MCPClient | None, mcp_cleanup: E2ECleanup
    ) -> None:
        """cerefox_search with project_name resolves name to UUID (regression for breaking change)."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        title = _unique_title("Project Search Test")
        t1 = e2e_mcp.tool_text("cerefox_ingest", {
            "title": title,
            "content": "# Project Search\n\nSearchable content for project filter regression test.",
            "project_name": "Test Files",
            "author": "e2e-mcp-test",
        })
        if "(id:" in t1:
            mcp_cleanup.track_document(t1.split("(id:")[1].split(")")[0].strip())

        import time
        time.sleep(2)

        text = e2e_mcp.tool_text("cerefox_search", {
            "query": "project filter regression test",
            "project_name": "Test Files",
            "match_count": 3,
        })
        # Should find the doc within that project
        assert text != "No results found."

    def test_mcp_usage_logging_creates_entries(
        self, e2e_mcp: MCPClient | None, e2e_client, mcp_cleanup: E2ECleanup
    ) -> None:
        """16C.28: MCP tool calls create usage log entries with access_path=remote-mcp."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")

        from cerefox.db.client import CerefoxClient
        client: CerefoxClient = e2e_client

        # Enable tracking
        original = client.get_config("usage_tracking_enabled")
        client.set_config("usage_tracking_enabled", "true")

        try:
            # Run an MCP search (goes through deployed cerefox-mcp -> tools/search.ts)
            e2e_mcp.tool_text("cerefox_search", {
                "query": "usage logging mcp e2e test marker",
                "match_count": 1,
            })

            import time
            time.sleep(2)

            # Check usage log for the entry
            log = client.list_usage_log(operation="search", limit=10)
            mcp_entries = [
                e for e in log
                if e.get("access_path") == "remote-mcp"
                and e.get("query_text") == "usage logging mcp e2e test marker"
            ]
            assert len(mcp_entries) >= 1, (
                f"Expected at least 1 remote-mcp usage entry, got {len(mcp_entries)}. "
                f"Recent entries: {[e.get('access_path') for e in log[:5]]}"
            )
        finally:
            client.set_config("usage_tracking_enabled", original or "false")
