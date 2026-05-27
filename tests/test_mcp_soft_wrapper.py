"""Tests for the `cerefox mcp` command.

v0.4.0–v0.5.1 had a "soft wrapper" here that probed for the npm
`@cerefox/memory` package via npx and delegated via execvp when found,
falling back to the in-tree Python MCP server otherwise. The probe was
fundamentally unreliable in `uv run`-launched contexts (which Claude
Desktop and other MCP clients use): PATH starts with `.venv/bin/` and
the Python `cerefox` console_script there satisfies npx's PATH-fallback
lookup, making the probe report success even when @cerefox/memory has
no `cerefox` bin in its cached version. The execvp then PATH-falls-back
again to the Python `cerefox`, recursing into `_run_mcp()` forever
until the MCP client times out.

v0.5.2 stripped the wrapper. `_run_mcp()` now directly starts the
in-tree Python MCP server, period. Users who want the TS MCP server
configure their client to invoke `cerefox mcp` (npm-installed) or
`npx -y --package=@cerefox/memory cerefox mcp` directly. The two
paths are no longer linked.

These tests verify the post-strip contract: no subprocess probing,
no execvp, just a direct call to `cerefox.mcp_server.run()`.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def mock_legacy_run():
    """Pin `cerefox.mcp_server.run` so we can verify it was called
    without actually starting an MCP server."""
    with patch("cerefox.mcp_server.run") as m:
        yield m


class TestRunMcp:
    def test_run_mcp_starts_python_mcp_server(self, mock_legacy_run):
        """`_run_mcp()` must directly invoke the in-tree Python MCP
        server — no npx delegation, no execvp."""
        from cerefox.cli import _run_mcp

        # Probes / execvp must NEVER be called now — the soft wrapper is
        # gone. If a future commit re-introduces them, this guard fails.
        with (
            patch("subprocess.run") as mock_subprocess_run,
            patch("os.execvp") as mock_execvp,
        ):
            _run_mcp()

        mock_legacy_run.assert_called_once()
        mock_subprocess_run.assert_not_called()
        mock_execvp.assert_not_called()

    def test_run_mcp_does_not_inspect_path(self, mock_legacy_run):
        """`_run_mcp()` must not call `shutil.which("npx")` or any
        equivalent PATH probe. That was the bug class in v0.4-v0.5.1."""
        from cerefox.cli import _run_mcp

        with patch("shutil.which") as mock_which:
            _run_mcp()

        mock_legacy_run.assert_called_once()
        mock_which.assert_not_called()


class TestPythonGetHelp:
    """Verify the legacy Python fallback exposes cerefox_get_help with the
    same surface as the TS handler so MCP clients see no difference."""

    def test_get_help_returns_full_content_with_no_topic(self):
        """No topic → full AGENT_QUICK_REFERENCE.md + section index."""
        import asyncio

        from cerefox.mcp_server import _handle_get_help

        client = MagicMock()
        result = asyncio.run(_handle_get_help(client, {}))

        assert len(result) == 1
        text = result[0].text
        assert "Cerefox Knowledge Base" in text
        assert "## Available topics" in text
        assert "Essential Rules" in text

    def test_get_help_matches_topic_case_insensitive(self):
        import asyncio

        from cerefox.mcp_server import _handle_get_help

        client = MagicMock()
        result = asyncio.run(_handle_get_help(client, {"topic": "TOOLS"}))

        text = result[0].text
        assert "## Tools" in text
        assert "## Available topics" not in text

    def test_get_help_unknown_topic_lists_available(self):
        import asyncio

        from cerefox.mcp_server import _handle_get_help

        client = MagicMock()
        result = asyncio.run(_handle_get_help(client, {"topic": "nonexistent-xyz"}))

        text = result[0].text
        assert 'No help topic matched "nonexistent-xyz"' in text
        assert "Available topics" in text

    def test_get_help_logs_usage_with_local_mcp_access_path(self):
        import asyncio

        from cerefox.mcp_server import _handle_get_help

        client = MagicMock()
        asyncio.run(_handle_get_help(client, {"requestor": "test-agent"}))

        client.log_usage.assert_called_once()
        kwargs = client.log_usage.call_args.kwargs
        assert kwargs["operation"] == "get_help"
        assert kwargs["access_path"] == "local-mcp"
        assert kwargs["requestor"] == "test-agent"

    def test_get_help_swallows_log_usage_errors(self):
        """Usage logging is best-effort; failures must not break the
        handler response."""
        import asyncio

        from cerefox.mcp_server import _handle_get_help

        client = MagicMock()
        client.log_usage.side_effect = RuntimeError("boom")
        result = asyncio.run(_handle_get_help(client, {}))

        # Still returns content despite the log_usage failure.
        assert len(result) == 1
        assert "Cerefox Knowledge Base" in result[0].text
