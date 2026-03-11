"""Embedder protocol — the interface all embedding backends must satisfy.

Any class that implements ``embed()``, ``embed_batch()``, and exposes
``dimensions`` and ``model_name`` satisfies this protocol without needing to
inherit from anything.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class Embedder(Protocol):
    """Structural protocol for text embedding backends.

    Implementations must produce L2-normalised vectors of a consistent
    dimensionality (``dimensions``).  All built-in embedders target 768
    dimensions to match the database schema (``VECTOR(768)``).
    """

    @property
    def dimensions(self) -> int:
        """Dimensionality of the output vectors (e.g. 768)."""
        ...

    @property
    def model_name(self) -> str:
        """Human-readable model identifier (e.g. the HuggingFace repo name)."""
        ...

    def embed(self, text: str) -> list[float]:
        """Embed a single string and return a normalised float vector."""
        ...

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed a list of strings.  Returns one vector per input, in order."""
        ...
