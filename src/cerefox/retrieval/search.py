"""Search client — wraps the Cerefox RPCs and manages response size.

All search methods return a :class:`SearchResponse` with a list of
:class:`SearchResult` objects and metadata about how many bytes were used.

Response size limiting is **opt-in per call** via the *max_bytes* parameter:

- ``max_bytes=None`` (default) — no truncation; all results from the RPC are
  returned.  Use this for the web UI and CLI where there is no LLM context
  constraint.
- ``max_bytes=<int>`` — results are dropped whole (never mid-document) once the
  running total exceeds the limit.  Use this for MCP/LLM callers where context
  size matters.  The caller is responsible for ensuring the value is within a
  server-enforced ceiling (the local MCP server uses ``CEREFOX_MAX_RESPONSE_BYTES``
  from ``.env``).

Usage::

    from cerefox.retrieval.search import SearchClient
    client_wrap = SearchClient(cerefox_client, embedder, settings)

    # Web UI — no limit
    resp = client_wrap.search_docs("knowledge management", max_bytes=None)

    # MCP server — honour configured limit
    resp = client_wrap.search_docs("knowledge management", max_bytes=settings.max_response_bytes)
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from cerefox.config import Settings
    from cerefox.db.client import CerefoxClient
    from cerefox.embeddings.base import Embedder

log = logging.getLogger(__name__)


@dataclass
class SearchResult:
    """A single ranked result row from a search RPC."""

    chunk_id: str
    document_id: str
    chunk_index: int
    title: str
    content: str
    heading_path: list[str]
    heading_level: int
    score: float
    doc_title: str
    doc_source: str
    doc_project_ids: list[str]
    doc_metadata: dict

    @classmethod
    def from_row(cls, row: dict) -> "SearchResult":
        return cls(
            chunk_id=row["chunk_id"],
            document_id=row["document_id"],
            chunk_index=row["chunk_index"],
            title=row.get("title") or "",
            content=row.get("content") or "",
            heading_path=row.get("heading_path") or [],
            heading_level=row.get("heading_level") or 0,
            score=float(row.get("score") or 0.0),
            doc_title=row.get("doc_title") or "",
            doc_source=row.get("doc_source") or "",
            doc_project_ids=row.get("doc_project_ids") or [],
            doc_metadata=row.get("doc_metadata") or {},
        )


@dataclass
class DocResult:
    """A single document-level result from cerefox_search_docs."""

    document_id: str
    doc_title: str
    doc_source: str
    doc_metadata: dict
    doc_project_ids: list[str]
    best_score: float
    best_chunk_heading_path: list[str]
    full_content: str
    chunk_count: int
    total_chars: int
    doc_updated_at: str = ""    # ISO-8601 string; empty when not returned by the RPC
    is_partial: bool = False    # True when small-to-big threshold was applied

    @classmethod
    def from_row(cls, row: dict) -> "DocResult":
        return cls(
            document_id=row["document_id"],
            doc_title=row.get("doc_title") or "",
            doc_source=row.get("doc_source") or "",
            doc_metadata=row.get("doc_metadata") or {},
            doc_project_ids=row.get("doc_project_ids") or [],
            best_score=float(row.get("best_score") or 0.0),
            best_chunk_heading_path=row.get("best_chunk_heading_path") or [],
            full_content=row.get("full_content") or "",
            chunk_count=int(row.get("chunk_count") or 0),
            total_chars=int(row.get("total_chars") or 0),
            doc_updated_at=row.get("doc_updated_at") or "",
            is_partial=bool(row.get("is_partial") or False),
        )


@dataclass
class DocSearchResponse:
    """The full response from a search_docs call."""

    results: list[DocResult]
    query: str
    total_found: int
    response_bytes: int
    truncated: bool
    metadata: dict = field(default_factory=dict)


@dataclass
class SearchResponse:
    """The full response from a search call."""

    results: list[SearchResult]
    query: str
    mode: str               # "hybrid" | "fts" | "semantic"
    total_found: int        # rows returned by the RPC (before truncation)
    response_bytes: int     # bytes actually returned
    truncated: bool         # True when results were dropped to stay under limit
    metadata: dict = field(default_factory=dict)


class SearchClient:
    """High-level search interface with response size management.

    Args:
        client: CerefoxClient wrapping supabase-py.
        embedder: Embedder used to vectorise the query (needed for hybrid + semantic).
        settings: Application settings for size limits.
    """

    def __init__(
        self,
        client: "CerefoxClient",
        embedder: "Embedder",
        settings: "Settings",
    ) -> None:
        self._client = client
        self._embedder = embedder
        self._settings = settings

    # ── Public search methods ─────────────────────────────────────────────

    def hybrid(
        self,
        query: str,
        match_count: int = 10,
        alpha: float = 0.7,
        project_id: str | None = None,
        use_upgrade: bool = False,
        metadata_filter: dict | None = None,
        max_bytes: int | None = None,
    ) -> SearchResponse:
        """Hybrid FTS + semantic search (recommended default).

        Args:
            query: Natural-language search query.
            match_count: Number of results to request from the RPC.
            alpha: Weight of semantic score vs FTS score (0 = pure FTS, 1 = pure semantic).
            project_id: Limit search to a specific project UUID.
            use_upgrade: Use the upgrade embedding column if available.
            metadata_filter: Optional JSONB containment filter. Only documents whose
                metadata contains all specified key-value pairs are returned.
                Example: {"type": "decision", "status": "active"}
            max_bytes: Response size budget in bytes. ``None`` (default) = no limit.
                Pass ``settings.max_response_bytes`` for MCP/LLM callers.
        """
        embedding = self._embedder.embed(query)
        rows = self._client.hybrid_search(
            query_text=query,
            query_embedding=embedding,
            match_count=match_count,
            alpha=alpha,
            use_upgrade=use_upgrade,
            project_id=project_id,
            min_score=self._settings.min_search_score,
            metadata_filter=metadata_filter,
        )
        return self._build_response(rows, query=query, mode="hybrid", max_bytes=max_bytes)

    def fts(
        self,
        query: str,
        match_count: int = 10,
        project_id: str | None = None,
        metadata_filter: dict | None = None,
        max_bytes: int | None = None,
    ) -> SearchResponse:
        """Pure full-text keyword search.

        Note: min_search_score is intentionally NOT applied here.  FTS scores
        (ts_rank_cd) are on a different scale from cosine similarity and cannot
        be meaningfully compared against the same threshold.  The @@ operator
        already acts as a hard gate — results that match a keyword query are
        always relevant enough to return.

        Args:
            metadata_filter: Optional JSONB containment filter applied server-side.
            max_bytes: Response size budget in bytes. ``None`` (default) = no limit.
        """
        rows = self._client.fts_search(
            query_text=query,
            match_count=match_count,
            project_id=project_id,
            metadata_filter=metadata_filter,
        )
        return self._build_response(rows, query=query, mode="fts", max_bytes=max_bytes)

    def semantic(
        self,
        query: str,
        match_count: int = 10,
        project_id: str | None = None,
        use_upgrade: bool = False,
        metadata_filter: dict | None = None,
        max_bytes: int | None = None,
    ) -> SearchResponse:
        """Pure semantic (vector) search.

        Args:
            metadata_filter: Optional JSONB containment filter applied server-side.
            max_bytes: Response size budget in bytes. ``None`` (default) = no limit.
        """
        embedding = self._embedder.embed(query)
        rows = self._client.semantic_search(
            query_embedding=embedding,
            match_count=match_count,
            use_upgrade=use_upgrade,
            project_id=project_id,
            metadata_filter=metadata_filter,
        )
        # FTS has a natural hard gate (the @@ operator); semantic always returns N
        # results regardless of relevance, so we apply the threshold in Python.
        min_score = self._settings.min_search_score
        if min_score > 0.0:
            rows = [r for r in rows if float(r.get("score") or 0.0) >= min_score]
        return self._build_response(rows, query=query, mode="semantic", max_bytes=max_bytes)

    def search_docs(
        self,
        query: str,
        match_count: int = 5,
        alpha: float = 0.7,
        project_id: str | None = None,
        metadata_filter: dict | None = None,
        max_bytes: int | None = None,
    ) -> DocSearchResponse:
        """Document-level hybrid search.

        Deduplicates chunk results by document and returns full document content.
        Best for AI agents that want complete notes rather than isolated snippets.

        Args:
            query: Natural-language search query.
            match_count: Maximum number of documents to return (default 5 — each
                result contains full content so responses are larger than chunk search).
            alpha: Weight of semantic vs FTS score (0 = pure FTS, 1 = pure semantic).
            project_id: Limit search to a specific project UUID.
            metadata_filter: Optional JSONB containment filter. Only documents whose
                metadata contains all specified key-value pairs are returned.
                Example: {"type": "decision", "status": "active"}
            max_bytes: Response size budget in bytes. ``None`` (default) = no limit.
                Pass ``settings.max_response_bytes`` for MCP/LLM callers.
        """
        embedding = self._embedder.embed(query)
        rows = self._client.search_docs(
            query_text=query,
            query_embedding=embedding,
            match_count=match_count,
            alpha=alpha,
            project_id=project_id,
            min_score=self._settings.min_search_score,
            metadata_filter=metadata_filter,
        )
        return self._build_doc_response(rows, query=query, max_bytes=max_bytes)

    def reconstruct(self, document_id: str) -> str | None:
        """Return the full reconstructed markdown content of a document.

        Returns ``None`` if the document is not found.
        """
        row = self._client.reconstruct_doc(document_id)
        return row["full_content"] if row else None

    # ── Internal ─────────────────────────────────────────────────────────

    def _build_doc_response(
        self,
        rows: list[dict],
        query: str,
        max_bytes: int | None = None,
    ) -> DocSearchResponse:
        """Convert raw RPC rows into a DocSearchResponse.

        When *max_bytes* is ``None`` all rows are included (no truncation).
        When *max_bytes* is an integer, rows are dropped whole once the running
        total would exceed the limit and ``truncated`` is set to ``True``.
        """
        total_found = len(rows)
        results: list[DocResult] = []
        used_bytes = 0
        truncated = False

        for row in rows:
            result = DocResult.from_row(row)
            row_bytes = _estimate_doc_bytes(result)
            if max_bytes is not None and used_bytes + row_bytes > max_bytes:
                truncated = True
                log.debug(
                    "Response size limit reached (%d/%d bytes) after %d/%d doc results",
                    used_bytes, max_bytes, len(results), total_found,
                )
                break
            results.append(result)
            used_bytes += row_bytes

        return DocSearchResponse(
            results=results,
            query=query,
            total_found=total_found,
            response_bytes=used_bytes,
            truncated=truncated,
            metadata={"max_bytes": max_bytes},
        )

    def _build_response(
        self,
        rows: list[dict],
        query: str,
        mode: str,
        max_bytes: int | None = None,
    ) -> SearchResponse:
        """Convert raw RPC rows into a :class:`SearchResponse`.

        When *max_bytes* is ``None`` all rows are included (no truncation).
        When *max_bytes* is an integer, rows are dropped whole once the running
        total would exceed the limit and ``truncated`` is set to ``True``.
        """
        total_found = len(rows)
        results: list[SearchResult] = []
        used_bytes = 0
        truncated = False

        for row in rows:
            result = SearchResult.from_row(row)
            row_bytes = _estimate_bytes(result)
            if max_bytes is not None and used_bytes + row_bytes > max_bytes:
                truncated = True
                log.debug(
                    "Response size limit reached (%d/%d bytes) after %d/%d results",
                    used_bytes, max_bytes, len(results), total_found,
                )
                break
            results.append(result)
            used_bytes += row_bytes

        return SearchResponse(
            results=results,
            query=query,
            mode=mode,
            total_found=total_found,
            response_bytes=used_bytes,
            truncated=truncated,
            metadata={"max_bytes": max_bytes},
        )


# ── Helpers ───────────────────────────────────────────────────────────────────


def _estimate_doc_bytes(result: DocResult) -> int:
    """Estimate the byte footprint of a document search result."""
    return (
        len(result.full_content.encode("utf-8"))
        + len(result.doc_title.encode("utf-8"))
        + len(result.doc_source.encode("utf-8"))
        + 200  # fixed overhead: IDs, scores, metadata keys
    )


def _estimate_bytes(result: SearchResult) -> int:
    """Estimate the byte footprint of a search result for size management."""
    return (
        len(result.content.encode("utf-8"))
        + len(result.title.encode("utf-8"))
        + len(result.doc_title.encode("utf-8"))
        + len(json.dumps(result.heading_path).encode("utf-8"))
        + 200  # fixed overhead: IDs, scores, metadata keys
    )
