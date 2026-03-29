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

    def test_get_health_check(self, e2e_mcp: MCPClient | None) -> None:
        """MCP-1: GET / returns a health check JSON payload."""
        if e2e_mcp is None:
            pytest.skip("No anon key -- skipping MCP e2e tests")
        data = e2e_mcp.get()
        assert data.get("status") == "ok"
        assert data.get("name") == "cerefox"
        assert "version" in data
        assert data.get("protocol") == "mcp"

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
        """MCP-3: tools/list returns all 6 tools with correct names and inputSchemas."""
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
