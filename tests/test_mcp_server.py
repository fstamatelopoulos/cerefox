"""Tests for cerefox.mcp_server — MCP tool definitions and handlers.

All tests mock the DB client, embedder, and pipeline — no network calls.
The MCP server module is tested at the handler level (_handle_search,
_handle_ingest, call_tool) and the tool-list level (list_tools).
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

import mcp.types as types
from cerefox.ingestion.pipeline import IngestResult
from cerefox.mcp_server import (
    _handle_ingest,
    _handle_list_metadata_keys,
    _handle_search,
    call_tool,
    list_tools,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture()
def mock_client() -> MagicMock:
    client = MagicMock()
    client.list_projects.return_value = [{"id": "proj-1", "name": "Work"}]
    client.search_docs.return_value = [
        {
            "doc_title": "Test Note",
            "best_score": 0.92,
            "full_content": "# Test Note\n\nSome content.",
        }
    ]
    return client


@pytest.fixture()
def mock_embedder() -> MagicMock:
    embedder = MagicMock()
    embedder.embed.return_value = [0.1] * 768
    return embedder


@pytest.fixture()
def mock_settings() -> MagicMock:
    settings = MagicMock()
    settings.max_response_bytes = 65000
    settings.min_search_score = 0.0
    return settings


@pytest.fixture()
def mock_pipeline() -> MagicMock:
    pipeline = MagicMock()
    pipeline.ingest_text.return_value = IngestResult(
        document_id="doc-001",
        title="My Note",
        chunk_count=1,
        total_chars=42,
        action="created",
        project_ids=[],
    )
    return pipeline


# ── list_tools ────────────────────────────────────────────────────────────────


class TestListTools:
    @pytest.mark.asyncio
    async def test_returns_three_tools(self) -> None:
        tools = await list_tools()
        assert len(tools) == 3

    @pytest.mark.asyncio
    async def test_tool_names(self) -> None:
        tools = await list_tools()
        names = {t.name for t in tools}
        assert names == {"cerefox_search", "cerefox_ingest", "cerefox_list_metadata_keys"}

    @pytest.mark.asyncio
    async def test_search_tool_has_required_query_param(self) -> None:
        tools = await list_tools()
        search = next(t for t in tools if t.name == "cerefox_search")
        assert "query" in search.inputSchema["required"]

    @pytest.mark.asyncio
    async def test_ingest_tool_has_required_title_and_content(self) -> None:
        tools = await list_tools()
        ingest = next(t for t in tools if t.name == "cerefox_ingest")
        assert "title" in ingest.inputSchema["required"]
        assert "content" in ingest.inputSchema["required"]

    @pytest.mark.asyncio
    async def test_all_tools_return_text_content(self) -> None:
        """Verify inputSchema is a dict (not None) for both tools."""
        tools = await list_tools()
        for tool in tools:
            assert isinstance(tool.inputSchema, dict)


# ── _handle_search ────────────────────────────────────────────────────────────


class TestHandleSearch:
    @pytest.mark.asyncio
    async def test_returns_text_content(
        self, mock_client, mock_embedder, mock_settings
    ) -> None:
        result = await _handle_search(
            mock_client, mock_embedder, mock_settings, {"query": "test query"}
        )
        assert len(result) == 1
        assert isinstance(result[0], types.TextContent)

    @pytest.mark.asyncio
    async def test_result_contains_doc_title(
        self, mock_client, mock_embedder, mock_settings
    ) -> None:
        result = await _handle_search(
            mock_client, mock_embedder, mock_settings, {"query": "test query"}
        )
        assert "Test Note" in result[0].text

    @pytest.mark.asyncio
    async def test_embeds_query(
        self, mock_client, mock_embedder, mock_settings
    ) -> None:
        await _handle_search(
            mock_client, mock_embedder, mock_settings, {"query": "hello"}
        )
        mock_embedder.embed.assert_called_once_with("hello")

    @pytest.mark.asyncio
    async def test_no_results_returns_no_results_message(
        self, mock_client, mock_embedder, mock_settings
    ) -> None:
        mock_client.search_docs.return_value = []
        result = await _handle_search(
            mock_client, mock_embedder, mock_settings, {"query": "obscure query"}
        )
        assert "No results" in result[0].text

    @pytest.mark.asyncio
    async def test_project_name_resolved_to_id(
        self, mock_client, mock_embedder, mock_settings
    ) -> None:
        await _handle_search(
            mock_client,
            mock_embedder,
            mock_settings,
            {"query": "test", "project_name": "Work"},
        )
        call_kwargs = mock_client.search_docs.call_args[1]
        assert call_kwargs["project_id"] == "proj-1"

    @pytest.mark.asyncio
    async def test_unknown_project_returns_error_message(
        self, mock_client, mock_embedder, mock_settings
    ) -> None:
        result = await _handle_search(
            mock_client,
            mock_embedder,
            mock_settings,
            {"query": "test", "project_name": "Nonexistent"},
        )
        assert "not found" in result[0].text.lower()

    @pytest.mark.asyncio
    async def test_respects_max_response_bytes(
        self, mock_client, mock_embedder, mock_settings
    ) -> None:
        """Results that exceed max_bytes are truncated, not dropped silently."""
        mock_settings.max_response_bytes = 10  # tiny limit
        mock_client.search_docs.return_value = [
            {"doc_title": "Big Doc", "best_score": 0.9, "full_content": "x" * 500}
        ]
        result = await _handle_search(
            mock_client, mock_embedder, mock_settings, {"query": "test"}
        )
        assert "Big Doc" in result[0].text
        assert "truncated" in result[0].text.lower()


# ── _handle_ingest ────────────────────────────────────────────────────────────


class TestHandleIngest:
    @pytest.mark.asyncio
    async def test_returns_text_content(self, mock_client, mock_pipeline) -> None:
        result = await _handle_ingest(
            mock_client,
            mock_pipeline,
            {"title": "My Note", "content": "# My Note\n\nBody."},
        )
        assert len(result) == 1
        assert isinstance(result[0], types.TextContent)

    @pytest.mark.asyncio
    async def test_success_message_contains_title(
        self, mock_client, mock_pipeline
    ) -> None:
        result = await _handle_ingest(
            mock_client,
            mock_pipeline,
            {"title": "My Note", "content": "# My Note\n\nBody."},
        )
        assert "My Note" in result[0].text

    @pytest.mark.asyncio
    async def test_created_message_for_new_doc(
        self, mock_client, mock_pipeline
    ) -> None:
        result = await _handle_ingest(
            mock_client,
            mock_pipeline,
            {"title": "My Note", "content": "# My Note\n\nBody."},
        )
        assert "Created" in result[0].text

    @pytest.mark.asyncio
    async def test_skipped_message_when_already_exists(
        self, mock_client, mock_pipeline
    ) -> None:
        mock_pipeline.ingest_text.return_value = IngestResult(
            document_id="doc-001",
            title="My Note",
            chunk_count=1,
            total_chars=42,
            action="skipped",
            project_ids=[],
        )
        result = await _handle_ingest(
            mock_client,
            mock_pipeline,
            {"title": "My Note", "content": "# My Note\n\nBody."},
        )
        assert "Skipped" in result[0].text

    @pytest.mark.asyncio
    async def test_updated_reindexed_message(
        self, mock_client, mock_pipeline
    ) -> None:
        mock_pipeline.ingest_text.return_value = IngestResult(
            document_id="doc-001",
            title="My Note",
            chunk_count=2,
            total_chars=200,
            action="updated",
            reindexed=True,
            project_ids=[],
        )
        result = await _handle_ingest(
            mock_client,
            mock_pipeline,
            {"title": "My Note", "content": "# My Note\n\nNew body.", "update_if_exists": True},
        )
        assert "Updated" in result[0].text
        assert "re-indexed" in result[0].text

    @pytest.mark.asyncio
    async def test_updated_metadata_only_message(
        self, mock_client, mock_pipeline
    ) -> None:
        mock_pipeline.ingest_text.return_value = IngestResult(
            document_id="doc-001",
            title="My Note",
            chunk_count=1,
            total_chars=42,
            action="updated",
            reindexed=False,
            project_ids=[],
        )
        result = await _handle_ingest(
            mock_client,
            mock_pipeline,
            {"title": "My Note", "content": "# My Note\n\nBody.", "update_if_exists": True},
        )
        assert "Updated" in result[0].text
        assert "metadata" in result[0].text

    @pytest.mark.asyncio
    async def test_passes_source_to_pipeline(self, mock_client, mock_pipeline) -> None:
        await _handle_ingest(
            mock_client,
            mock_pipeline,
            {"title": "T", "content": "C", "source": "cli"},
        )
        call_kwargs = mock_pipeline.ingest_text.call_args[1]
        assert call_kwargs["source"] == "cli"

    @pytest.mark.asyncio
    async def test_defaults_source_to_agent(self, mock_client, mock_pipeline) -> None:
        await _handle_ingest(
            mock_client, mock_pipeline, {"title": "T", "content": "C"}
        )
        call_kwargs = mock_pipeline.ingest_text.call_args[1]
        assert call_kwargs["source"] == "agent"


# ── call_tool dispatch ────────────────────────────────────────────────────────


class TestCallTool:
    @pytest.mark.asyncio
    async def test_unknown_tool_raises_value_error(
        self, mock_client, mock_embedder, mock_settings, mock_pipeline
    ) -> None:
        deps = {
            "client": mock_client,
            "embedder": mock_embedder,
            "settings": mock_settings,
            "pipeline": mock_pipeline,
        }
        with patch("cerefox.mcp_server._get_deps", return_value=deps):
            with pytest.raises(ValueError, match="Unknown tool"):
                await call_tool("cerefox_unknown", {})

    @pytest.mark.asyncio
    async def test_dispatches_to_search(
        self, mock_client, mock_embedder, mock_settings, mock_pipeline
    ) -> None:
        deps = {
            "client": mock_client,
            "embedder": mock_embedder,
            "settings": mock_settings,
            "pipeline": mock_pipeline,
        }
        with patch("cerefox.mcp_server._get_deps", return_value=deps):
            result = await call_tool("cerefox_search", {"query": "test"})
        assert isinstance(result[0], types.TextContent)

    @pytest.mark.asyncio
    async def test_dispatches_to_ingest(
        self, mock_client, mock_embedder, mock_settings, mock_pipeline
    ) -> None:
        deps = {
            "client": mock_client,
            "embedder": mock_embedder,
            "settings": mock_settings,
            "pipeline": mock_pipeline,
        }
        with patch("cerefox.mcp_server._get_deps", return_value=deps):
            result = await call_tool(
                "cerefox_ingest", {"title": "T", "content": "C"}
            )
        assert isinstance(result[0], types.TextContent)

    @pytest.mark.asyncio
    async def test_dispatches_to_list_metadata_keys(
        self, mock_client, mock_embedder, mock_settings, mock_pipeline
    ) -> None:
        mock_client.list_metadata_keys.return_value = [
            {"key": "tags", "doc_count": 3, "example_values": ["a", "b"]},
        ]
        deps = {
            "client": mock_client,
            "embedder": mock_embedder,
            "settings": mock_settings,
            "pipeline": mock_pipeline,
        }
        with patch("cerefox.mcp_server._get_deps", return_value=deps):
            result = await call_tool("cerefox_list_metadata_keys", {})
        assert isinstance(result[0], types.TextContent)
        assert "tags" in result[0].text


class TestHandleListMetadataKeys:
    @pytest.mark.asyncio
    async def test_returns_json_when_keys_exist(self, mock_client) -> None:
        mock_client.list_metadata_keys.return_value = [
            {"key": "author", "doc_count": 5, "example_values": ["Alice"]},
            {"key": "tags", "doc_count": 2, "example_values": ["fiction"]},
        ]
        result = await _handle_list_metadata_keys(mock_client)
        assert len(result) == 1
        assert "author" in result[0].text
        assert "tags" in result[0].text

    @pytest.mark.asyncio
    async def test_returns_no_keys_message(self, mock_client) -> None:
        mock_client.list_metadata_keys.return_value = []
        result = await _handle_list_metadata_keys(mock_client)
        assert "No metadata keys" in result[0].text
