"""Cerefox Python web app — REMOVED in v0.9.0 (husk).

The Python (FastAPI) web app was replaced by the TypeScript web server shipped
in ``@cerefox/memory``. Run it with::

    cerefox web                      # install: npm install -g @cerefox/memory

This module remains only as a husk so that any stale import or ASGI reference
(e.g. ``uvicorn cerefox.api.app:app``) fails with a clear message instead of a
confusing import error. There is no FastAPI app here anymore.
"""

from __future__ import annotations

_MESSAGE = (
    "The Cerefox Python web app was removed in v0.9.0. "
    "Use the TypeScript web server: `cerefox web` "
    "(install: npm install -g @cerefox/memory). "
    "See docs/guides/upgrading.md."
)


def __getattr__(name: str):  # PEP 562 module-level attribute hook
    """Any access (including `app`) fails loudly with the redirect message."""
    raise RuntimeError(_MESSAGE)
