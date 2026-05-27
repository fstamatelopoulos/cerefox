"""Tests for the v0.5 Python CLI deprecation banner.

The banner prints on every Python CLI invocation pointing users at the
new npm-installable `@cerefox/memory` package. v0.5–v0.7 keeps the
Python CLI fully functional; v0.8/v0.9 removes it.

Suppression cases (each tested):
  - `CEREFOX_NO_DEPRECATION_BANNER` env var set.
  - `--version` / `-V` (informational flag).
  - `--help` / `-h` (informational flag).
  - `mcp` subcommand (banner-on-stderr pollutes MCP clients).
  - `--json` flag (don't contaminate JSON consumers).
  - No args (no subcommand; just `cerefox`).

We test `_emit_deprecation_banner` directly by patching `sys.argv` and
capturing stderr — gives us a clean unit boundary without spawning
subprocesses or fighting Click's testing runner across versions.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest


def _emit(argv_tail: list[str], env: dict[str, str] | None = None) -> str:
    """Call `_emit_deprecation_banner()` with the given argv + env, return stderr."""
    from cerefox.cli import _emit_deprecation_banner

    fake_argv = ["cerefox", *argv_tail]
    capture: list[str] = []
    with (
        patch("sys.argv", fake_argv),
        patch.dict("os.environ", env or {}, clear=False),
        patch("click.echo", side_effect=lambda msg, **kw: capture.append(str(msg))),
    ):
        # Clear CEREFOX_NO_DEPRECATION_BANNER unless explicitly set
        # via env (patch.dict merges, doesn't clear by default).
        if env is None or "CEREFOX_NO_DEPRECATION_BANNER" not in env:
            import os

            if "CEREFOX_NO_DEPRECATION_BANNER" in os.environ:
                del os.environ["CEREFOX_NO_DEPRECATION_BANNER"]
        _emit_deprecation_banner()
    return "\n".join(capture)


BANNER_FRAGMENT = "Python `cerefox` CLI is deprecated"


class TestDeprecationBanner:
    def test_banner_prints_on_normal_invocation(self) -> None:
        assert BANNER_FRAGMENT in _emit(["list-projects"])

    def test_banner_prints_on_write_command(self) -> None:
        assert BANNER_FRAGMENT in _emit(["ingest", "my-file.md"])

    def test_banner_suppressed_by_env_var(self) -> None:
        assert BANNER_FRAGMENT not in _emit(
            ["list-projects"],
            env={"CEREFOX_NO_DEPRECATION_BANNER": "1"},
        )

    def test_banner_suppressed_on_version(self) -> None:
        assert BANNER_FRAGMENT not in _emit(["--version"])

    def test_banner_suppressed_on_short_version(self) -> None:
        assert BANNER_FRAGMENT not in _emit(["-V"])

    def test_banner_suppressed_on_help(self) -> None:
        assert BANNER_FRAGMENT not in _emit(["--help"])

    def test_banner_suppressed_on_mcp(self) -> None:
        assert BANNER_FRAGMENT not in _emit(["mcp"])

    def test_banner_suppressed_on_json_flag(self) -> None:
        assert BANNER_FRAGMENT not in _emit(["list-projects", "--json"])

    def test_banner_suppressed_when_no_args(self) -> None:
        assert BANNER_FRAGMENT not in _emit([])
