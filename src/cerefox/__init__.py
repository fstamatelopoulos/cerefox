"""Cerefox — personal second brain knowledge backend."""

from __future__ import annotations

from pathlib import Path


def _read_version() -> str:
    # VERSION at the repo root is the single source of truth. In dev / editable
    # installs we read it directly so a bump doesn't require reinstall. The
    # wheel build bundles the same file at `cerefox/_VERSION`. As a final
    # fallback we ask importlib.metadata for the installed package version.
    here = Path(__file__).resolve().parent
    for candidate in (here / "_VERSION", here.parent.parent / "VERSION"):
        try:
            if candidate.is_file():
                return candidate.read_text(encoding="utf-8").strip()
        except OSError:
            pass
    try:
        from importlib.metadata import version

        return version("cerefox")
    except Exception:  # noqa: BLE001
        return "0.0.0+unknown"


__version__ = _read_version()
