"""Tests for the `cerefox mcp` soft wrapper (iter-22 Part E).

The wrapper tries `npx @cerefox/memory cerefox-mcp` first; falls back to
the legacy Python server with a stderr nudge if npx is missing or the
package isn't installed.

We mock `shutil.which`, `subprocess.run`, and `os.execvp` so the tests
never actually spawn a process.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def mock_legacy_run():
    """Pin `cerefox.mcp_server.run` so the fallback path is observable
    without actually starting an MCP server."""
    with patch("cerefox.mcp_server.run") as m:
        yield m


class TestSoftWrapper:
    def test_uses_npx_when_package_is_installed(self, mock_legacy_run):
        """Happy path: npx + @cerefox/memory both present → execvp delegates,
        legacy fallback never runs."""
        from cerefox.cli import _run_mcp

        with (
            patch("shutil.which", return_value="/opt/homebrew/bin/npx"),
            patch("subprocess.run") as mock_run,
            patch("os.execvp") as mock_execvp,
        ):
            mock_run.return_value = MagicMock(returncode=0, stdout="0.4.0", stderr="")
            _run_mcp()

        mock_execvp.assert_called_once()
        args = mock_execvp.call_args.args
        assert args[0] == "/opt/homebrew/bin/npx"
        assert "@cerefox/memory" in args[1]
        assert "cerefox-mcp" in args[1]
        # Legacy path NOT called.
        mock_legacy_run.assert_not_called()

    def test_falls_back_when_npx_missing(self, mock_legacy_run, capsys):
        """No npx in PATH → falls back to legacy Python MCP server."""
        from cerefox.cli import _run_mcp

        with (
            patch("shutil.which", return_value=None),
            patch("os.execvp") as mock_execvp,
        ):
            _run_mcp()

        mock_execvp.assert_not_called()
        mock_legacy_run.assert_called_once()
        stderr = capsys.readouterr().err
        assert "npx not found" in stderr
        assert "@cerefox/memory" in stderr

    def test_falls_back_when_package_not_installed(self, mock_legacy_run, capsys):
        """npx present but @cerefox/memory not installed → fallback with nudge."""
        from cerefox.cli import _run_mcp

        with (
            patch("shutil.which", return_value="/usr/bin/npx"),
            patch("subprocess.run") as mock_run,
            patch("os.execvp") as mock_execvp,
        ):
            mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="")
            _run_mcp()

        mock_execvp.assert_not_called()
        mock_legacy_run.assert_called_once()
        stderr = capsys.readouterr().err
        assert "@cerefox/memory not installed" in stderr

    def test_probe_uses_no_install_flag(self, mock_legacy_run):
        """The probe must include --no-install so it doesn't hit the registry
        on every server start (multi-second delay + hidden network dep)."""
        from cerefox.cli import _run_mcp

        with (
            patch("shutil.which", return_value="/usr/bin/npx"),
            patch("subprocess.run") as mock_run,
            patch("os.execvp"),
        ):
            mock_run.return_value = MagicMock(returncode=0, stdout="0.4.0", stderr="")
            _run_mcp()

        # Asserts on the first (and only) subprocess.run call: the probe.
        probe_args = mock_run.call_args.args[0]
        assert "--no-install" in probe_args
        assert "--version" in probe_args


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
