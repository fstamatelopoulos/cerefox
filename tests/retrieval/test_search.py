"""Tests for cerefox.retrieval.search.SearchClient.

All DB and embedder calls are mocked — no network access.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from cerefox.config import Settings
from cerefox.retrieval.search import (
    DocResult,
    DocSearchResponse,
    SearchClient,
    SearchResponse,
    SearchResult,
    _estimate_bytes,
    _estimate_doc_bytes,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────


def _make_row(
    chunk_id: str = "chunk-1",
    document_id: str = "doc-1",
    chunk_index: int = 0,
    title: str = "Section",
    content: str = "Some content.",
    score: float = 0.9,
    doc_title: str = "My Document",
) -> dict:
    return {
        "chunk_id": chunk_id,
        "document_id": document_id,
        "chunk_index": chunk_index,
        "title": title,
        "content": content,
        "heading_path": ["My Document", "Section"],
        "heading_level": 2,
        "score": score,
        "doc_title": doc_title,
        "doc_source": "file",
        "doc_project_ids": [],
        "doc_project_names": [],
        "doc_metadata": {},
    }


def _make_doc_row(
    document_id: str = "doc-1",
    doc_title: str = "My Document",
    best_score: float = 0.85,
    full_content: str = "# My Document\n\nFull content here.",
    chunk_count: int = 3,
    total_chars: int = 300,
    is_partial: bool = False,
) -> dict:
    return {
        "document_id": document_id,
        "doc_title": doc_title,
        "doc_source": "file",
        "doc_metadata": {},
        "doc_project_ids": [],
        "best_score": best_score,
        "best_chunk_heading_path": ["My Document", "Introduction"],
        "full_content": full_content,
        "chunk_count": chunk_count,
        "total_chars": total_chars,
        "is_partial": is_partial,
    }


@pytest.fixture()
def mock_client() -> MagicMock:
    client = MagicMock()
    client.hybrid_search.return_value = [_make_row()]
    client.fts_search.return_value = [_make_row()]
    client.semantic_search.return_value = [_make_row()]
    client.search_docs.return_value = [_make_doc_row()]
    client.reconstruct_doc.return_value = {"full_content": "# Hello\n\nWorld"}
    return client


@pytest.fixture()
def mock_embedder() -> MagicMock:
    emb = MagicMock()
    emb.embed.return_value = [0.1] * 768
    return emb


@pytest.fixture()
def sc(mock_client, mock_embedder, test_settings) -> SearchClient:
    return SearchClient(mock_client, mock_embedder, test_settings)


# ── SearchResult.from_row ─────────────────────────────────────────────────────


class TestSearchResultFromRow:
    def test_parses_all_fields(self) -> None:
        row = _make_row()
        result = SearchResult.from_row(row)
        assert result.chunk_id == "chunk-1"
        assert result.document_id == "doc-1"
        assert result.score == pytest.approx(0.9)
        assert result.heading_path == ["My Document", "Section"]

    def test_includes_project_names(self) -> None:
        row = _make_row()
        row["doc_project_names"] = ["Alpha", "Beta"]
        result = SearchResult.from_row(row)
        assert result.doc_project_names == ["Alpha", "Beta"]

    def test_handles_none_values_gracefully(self) -> None:
        row = _make_row()
        row["title"] = None
        row["heading_path"] = None
        row["doc_metadata"] = None
        row["doc_project_names"] = None
        result = SearchResult.from_row(row)
        assert result.title == ""
        assert result.heading_path == []
        assert result.doc_metadata == {}
        assert result.doc_project_names == []


# ── Hybrid search ─────────────────────────────────────────────────────────────


class TestHybridSearch:
    def test_returns_search_response(self, sc) -> None:
        resp = sc.hybrid("test query")
        assert isinstance(resp, SearchResponse)
        assert resp.mode == "hybrid"

    def test_embeds_query_before_rpc(self, sc, mock_embedder, mock_client) -> None:
        sc.hybrid("hello")
        mock_embedder.embed.assert_called_once_with("hello")
        mock_client.hybrid_search.assert_called_once()

    def test_passes_alpha_to_rpc(self, sc, mock_client) -> None:
        sc.hybrid("q", alpha=0.3)
        call_kwargs = mock_client.hybrid_search.call_args[1]
        assert call_kwargs["alpha"] == pytest.approx(0.3)

    def test_passes_project_id(self, sc, mock_client) -> None:
        sc.hybrid("q", project_id="proj-123")
        call_kwargs = mock_client.hybrid_search.call_args[1]
        assert call_kwargs["project_id"] == "proj-123"

    def test_results_contain_search_results(self, sc) -> None:
        resp = sc.hybrid("q")
        assert len(resp.results) == 1
        assert isinstance(resp.results[0], SearchResult)
        assert resp.results[0].doc_title == "My Document"


# ── FTS search ────────────────────────────────────────────────────────────────


class TestFtsSearch:
    def test_mode_is_fts(self, sc) -> None:
        resp = sc.fts("keyword")
        assert resp.mode == "fts"

    def test_does_not_embed(self, sc, mock_embedder) -> None:
        sc.fts("keyword")
        mock_embedder.embed.assert_not_called()

    def test_passes_match_count(self, sc, mock_client) -> None:
        sc.fts("q", match_count=5)
        call_kwargs = mock_client.fts_search.call_args[1]
        assert call_kwargs["match_count"] == 5


# ── Semantic search ───────────────────────────────────────────────────────────


class TestSemanticSearch:
    def test_mode_is_semantic(self, sc) -> None:
        resp = sc.semantic("concept")
        assert resp.mode == "semantic"

    def test_embeds_query(self, sc, mock_embedder) -> None:
        sc.semantic("concept")
        mock_embedder.embed.assert_called_once_with("concept")

    def test_embedding_passed_to_rpc(self, sc, mock_client, mock_embedder) -> None:
        mock_embedder.embed.return_value = [0.5] * 768
        sc.semantic("q")
        call_kwargs = mock_client.semantic_search.call_args[1]
        assert call_kwargs["query_embedding"] == [0.5] * 768


# ── Response size management ──────────────────────────────────────────────────


class TestResponseSizeManagement:
    def test_no_truncation_when_under_limit(self, sc) -> None:
        resp = sc.hybrid("q")
        assert not resp.truncated

    def test_no_truncation_with_max_bytes_none(self, mock_client, mock_embedder, test_settings) -> None:
        """max_bytes=None disables truncation entirely (web UI / CLI path)."""
        big_content = "x" * 10_000
        rows = [_make_row(chunk_id=f"c{i}", content=big_content) for i in range(10)]
        mock_client.hybrid_search.return_value = rows
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        resp = sc.hybrid("q", max_bytes=None)
        assert not resp.truncated
        assert resp.total_found == 10
        assert len(resp.results) == 10

    def test_truncation_when_over_explicit_limit(self, mock_client, mock_embedder, test_settings) -> None:
        """Passing an explicit max_bytes truncates when the limit is hit."""
        big_content = "x" * 10_000
        rows = [_make_row(chunk_id=f"c{i}", content=big_content) for i in range(10)]
        mock_client.hybrid_search.return_value = rows
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        resp = sc.hybrid("q", max_bytes=15_000)
        assert resp.truncated
        assert resp.total_found == 10
        assert len(resp.results) < 10

    def test_response_bytes_matches_content(self, sc) -> None:
        resp = sc.fts("q")
        # Should be non-zero
        assert resp.response_bytes > 0

    def test_total_found_reflects_all_rows(self, mock_client, mock_embedder, test_settings) -> None:
        rows = [_make_row(chunk_id=f"c{i}") for i in range(5)]
        mock_client.fts_search.return_value = rows
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        resp = sc.fts("q", match_count=5)
        assert resp.total_found == 5

    def test_empty_result_set(self, mock_client, mock_embedder, test_settings) -> None:
        mock_client.fts_search.return_value = []
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        resp = sc.fts("nothing matches")
        assert resp.results == []
        assert not resp.truncated
        assert resp.response_bytes == 0


# ── Reconstruct ───────────────────────────────────────────────────────────────


class TestReconstruct:
    def test_returns_full_content(self, sc, mock_client) -> None:
        mock_client.reconstruct_doc.return_value = {"full_content": "# Hello\n\nBody."}
        result = sc.reconstruct("doc-1")
        assert result == "# Hello\n\nBody."

    def test_returns_none_for_missing_doc(self, sc, mock_client) -> None:
        mock_client.reconstruct_doc.return_value = None
        result = sc.reconstruct("missing-id")
        assert result is None


# ── _estimate_bytes helper ────────────────────────────────────────────────────


class TestEstimateBytes:
    def test_returns_positive_int(self) -> None:
        result = SearchResult.from_row(_make_row())
        assert _estimate_bytes(result) > 0

    def test_longer_content_yields_more_bytes(self) -> None:
        short = SearchResult.from_row(_make_row(content="hi"))
        long_ = SearchResult.from_row(_make_row(content="x" * 5000))
        assert _estimate_bytes(long_) > _estimate_bytes(short)


# ── DocResult ─────────────────────────────────────────────────────────────────


class TestDocResult:
    def test_is_partial_defaults_to_false_when_missing(self) -> None:
        row = _make_doc_row()
        del row["is_partial"]
        result = DocResult.from_row(row)
        assert result.is_partial is False

    def test_is_partial_false_for_full_doc(self) -> None:
        result = DocResult.from_row(_make_doc_row(is_partial=False))
        assert result.is_partial is False

    def test_is_partial_true_for_large_doc(self) -> None:
        result = DocResult.from_row(_make_doc_row(is_partial=True))
        assert result.is_partial is True

    def test_total_chars_preserved(self) -> None:
        # total_chars should always reflect the full document size, even when partial.
        result = DocResult.from_row(_make_doc_row(total_chars=99_000, is_partial=True))
        assert result.total_chars == 99_000


# ── search_docs ───────────────────────────────────────────────────────────────


class TestSearchDocs:
    def test_returns_doc_search_response(self, sc) -> None:
        resp = sc.search_docs("test query")
        assert isinstance(resp, DocSearchResponse)
        assert len(resp.results) == 1
        assert isinstance(resp.results[0], DocResult)

    def test_is_partial_false_propagates(self, sc, mock_client) -> None:
        mock_client.search_docs.return_value = [_make_doc_row(is_partial=False)]
        resp = sc.search_docs("q")
        assert resp.results[0].is_partial is False

    def test_is_partial_true_propagates(self, sc, mock_client) -> None:
        # Large doc: RPC returns is_partial=True, partial content, full total_chars.
        mock_client.search_docs.return_value = [
            _make_doc_row(
                full_content="# Section\n\nMatched chunk and its neighbours.",
                chunk_count=3,
                total_chars=99_000,
                is_partial=True,
            )
        ]
        resp = sc.search_docs("q")
        result = resp.results[0]
        assert result.is_partial is True
        assert result.total_chars == 99_000  # full doc size preserved
        assert result.chunk_count == 3       # window chunk count

    def test_multiple_docs_mixed_partial(self, sc, mock_client) -> None:
        mock_client.search_docs.return_value = [
            _make_doc_row(document_id="doc-1", is_partial=False, total_chars=5_000),
            _make_doc_row(document_id="doc-2", is_partial=True, total_chars=80_000),
        ]
        resp = sc.search_docs("q")
        assert resp.results[0].is_partial is False
        assert resp.results[1].is_partial is True

    def test_empty_results(self, sc, mock_client) -> None:
        mock_client.search_docs.return_value = []
        resp = sc.search_docs("nothing")
        assert resp.results == []
        assert not resp.truncated
        assert resp.total_found == 0


# ── DocResult.from_row ────────────────────────────────────────────────────────


class TestDocResultFromRow:
    def test_parses_all_fields(self) -> None:
        row = _make_doc_row()
        result = DocResult.from_row(row)
        assert result.document_id == "doc-1"
        assert result.doc_title == "My Document"
        assert result.best_score == pytest.approx(0.85)
        assert result.chunk_count == 3
        assert result.total_chars == 300
        assert result.full_content == "# My Document\n\nFull content here."
        assert result.best_chunk_heading_path == ["My Document", "Introduction"]

    def test_handles_none_values_gracefully(self) -> None:
        row = _make_doc_row()
        row["doc_title"] = None
        row["best_chunk_heading_path"] = None
        row["doc_metadata"] = None
        result = DocResult.from_row(row)
        assert result.doc_title == ""
        assert result.best_chunk_heading_path == []
        assert result.doc_metadata == {}

    def test_chunk_count_defaults_to_zero(self) -> None:
        row = _make_doc_row()
        row["chunk_count"] = None
        result = DocResult.from_row(row)
        assert result.chunk_count == 0


# ── search_docs ───────────────────────────────────────────────────────────────


class TestSearchDocs:
    def test_returns_doc_search_response(self, sc) -> None:
        resp = sc.search_docs("knowledge management")
        assert isinstance(resp, DocSearchResponse)

    def test_embeds_query(self, sc, mock_embedder) -> None:
        sc.search_docs("knowledge management")
        mock_embedder.embed.assert_called_once_with("knowledge management")

    def test_calls_client_search_docs(self, sc, mock_client) -> None:
        sc.search_docs("q")
        mock_client.search_docs.assert_called_once()

    def test_passes_match_count(self, sc, mock_client) -> None:
        sc.search_docs("q", match_count=3)
        call_kwargs = mock_client.search_docs.call_args[1]
        assert call_kwargs["match_count"] == 3

    def test_passes_alpha(self, sc, mock_client) -> None:
        sc.search_docs("q", alpha=0.4)
        call_kwargs = mock_client.search_docs.call_args[1]
        assert call_kwargs["alpha"] == pytest.approx(0.4)

    def test_passes_project_id(self, sc, mock_client) -> None:
        sc.search_docs("q", project_id="proj-42")
        call_kwargs = mock_client.search_docs.call_args[1]
        assert call_kwargs["project_id"] == "proj-42"

    def test_results_contain_doc_results(self, sc) -> None:
        resp = sc.search_docs("q")
        assert len(resp.results) == 1
        assert isinstance(resp.results[0], DocResult)
        assert resp.results[0].doc_title == "My Document"

    def test_full_content_present_in_results(self, sc) -> None:
        resp = sc.search_docs("q")
        assert "Full content here" in resp.results[0].full_content

    def test_empty_results(self, sc, mock_client) -> None:
        mock_client.search_docs.return_value = []
        resp = sc.search_docs("nothing")
        assert resp.results == []
        assert resp.total_found == 0
        assert not resp.truncated

    def test_truncation_when_explicit_max_bytes_exceeded(
        self, mock_client, mock_embedder, test_settings
    ) -> None:
        """Passing max_bytes triggers truncation when the limit is hit."""
        big_content = "x" * 20_000
        rows = [_make_doc_row(document_id=f"doc-{i}", full_content=big_content) for i in range(5)]
        mock_client.search_docs.return_value = rows
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        resp = sc.search_docs("q", max_bytes=25_000)
        assert resp.truncated
        assert resp.total_found == 5
        assert len(resp.results) < 5

    def test_no_truncation_with_max_bytes_none(
        self, mock_client, mock_embedder, test_settings
    ) -> None:
        """max_bytes=None returns all results regardless of content size (web UI path)."""
        big_content = "x" * 20_000
        rows = [_make_doc_row(document_id=f"doc-{i}", full_content=big_content) for i in range(5)]
        mock_client.search_docs.return_value = rows
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        resp = sc.search_docs("q", max_bytes=None)
        assert not resp.truncated
        assert resp.total_found == 5
        assert len(resp.results) == 5

    def test_default_match_count_is_five(self, sc, mock_client) -> None:
        sc.search_docs("q")
        call_kwargs = mock_client.search_docs.call_args[1]
        assert call_kwargs["match_count"] == 5


# ── _estimate_doc_bytes helper ────────────────────────────────────────────────


class TestEstimateDocBytes:
    def test_returns_positive_int(self) -> None:
        result = DocResult.from_row(_make_doc_row())
        assert _estimate_doc_bytes(result) > 0

    def test_longer_content_yields_more_bytes(self) -> None:
        short = DocResult.from_row(_make_doc_row(full_content="short"))
        long_ = DocResult.from_row(_make_doc_row(full_content="x" * 10_000))
        assert _estimate_doc_bytes(long_) > _estimate_doc_bytes(short)


# ── Min-score filtering ───────────────────────────────────────────────────────


class TestMinScoreFiltering:
    """Verify that the min_score threshold is applied correctly per search mode."""

    def test_hybrid_passes_min_score_to_client(
        self, mock_client, mock_embedder, test_settings
    ) -> None:
        """Hybrid search passes min_score to the DB client (SQL handles filtering)."""
        test_settings.min_search_score = 0.5
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        sc.hybrid("q")
        call_kwargs = mock_client.hybrid_search.call_args[1]
        assert call_kwargs["min_score"] == pytest.approx(0.5)

    def test_semantic_filters_low_scores_in_python(
        self, mock_client, mock_embedder, test_settings
    ) -> None:
        """Semantic search drops rows below the threshold in Python before building response."""
        test_settings.min_search_score = 0.5
        rows = [
            _make_row(chunk_id="high", score=0.8),
            _make_row(chunk_id="low", score=0.2),
        ]
        mock_client.semantic_search.return_value = rows
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        resp = sc.semantic("q")
        assert len(resp.results) == 1
        assert resp.results[0].chunk_id == "high"

    def test_semantic_total_found_reflects_filtered_rows(
        self, mock_client, mock_embedder, test_settings
    ) -> None:
        """total_found counts quality-passing rows (consistent with hybrid SQL behaviour)."""
        test_settings.min_search_score = 0.5
        rows = [
            _make_row(chunk_id="a", score=0.9),
            _make_row(chunk_id="b", score=0.1),
            _make_row(chunk_id="c", score=0.6),
        ]
        mock_client.semantic_search.return_value = rows
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        resp = sc.semantic("q")
        assert resp.total_found == 2  # only the two rows >= 0.5

    def test_fts_not_affected_by_min_score(
        self, mock_client, mock_embedder, test_settings
    ) -> None:
        """FTS ignores min_score — ts_rank_cd values are tiny and not comparable to cosine."""
        test_settings.min_search_score = 0.9  # absurdly high
        mock_client.fts_search.return_value = [_make_row(score=0.001)]  # typical ts_rank value
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        resp = sc.fts("keyword")
        assert len(resp.results) == 1  # NOT filtered out

    def test_docs_passes_min_score_to_client(
        self, mock_client, mock_embedder, test_settings
    ) -> None:
        """Doc search passes min_score to the DB client (SQL handles filtering via hybrid)."""
        test_settings.min_search_score = 0.4
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        sc.search_docs("q")
        call_kwargs = mock_client.search_docs.call_args[1]
        assert call_kwargs["min_score"] == pytest.approx(0.4)

    def test_semantic_zero_threshold_returns_all(
        self, mock_client, mock_embedder, test_settings
    ) -> None:
        """Setting min_score=0.0 disables filtering — all rows are returned."""
        test_settings.min_search_score = 0.0
        rows = [
            _make_row(chunk_id="a", score=0.05),
            _make_row(chunk_id="b", score=0.01),
        ]
        mock_client.semantic_search.return_value = rows
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        resp = sc.semantic("q")
        assert len(resp.results) == 2

    def test_hybrid_default_min_score_from_settings(self, sc, mock_client) -> None:
        """Hybrid always includes min_score in the client call (sourced from settings)."""
        sc.hybrid("q")
        call_kwargs = mock_client.hybrid_search.call_args[1]
        assert "min_score" in call_kwargs


# ── Metadata filter propagation ───────────────────────────────────────────────


class TestMetadataFilter:
    """Verify that metadata_filter is propagated to the DB client for all modes."""

    # ── hybrid ────────────────────────────────────────────────────────────────

    def test_hybrid_passes_metadata_filter_to_client(self, sc, mock_client) -> None:
        f = {"type": "decision", "status": "active"}
        sc.hybrid("q", metadata_filter=f)
        call_kwargs = mock_client.hybrid_search.call_args[1]
        assert call_kwargs["metadata_filter"] == f

    def test_hybrid_none_filter_passed_as_none(self, sc, mock_client) -> None:
        sc.hybrid("q", metadata_filter=None)
        call_kwargs = mock_client.hybrid_search.call_args[1]
        assert call_kwargs["metadata_filter"] is None

    def test_hybrid_omitted_filter_defaults_to_none(self, sc, mock_client) -> None:
        sc.hybrid("q")
        call_kwargs = mock_client.hybrid_search.call_args[1]
        assert call_kwargs["metadata_filter"] is None

    # ── fts ───────────────────────────────────────────────────────────────────

    def test_fts_passes_metadata_filter_to_client(self, sc, mock_client) -> None:
        f = {"type": "note"}
        sc.fts("keyword", metadata_filter=f)
        call_kwargs = mock_client.fts_search.call_args[1]
        assert call_kwargs["metadata_filter"] == f

    def test_fts_none_filter_passed_as_none(self, sc, mock_client) -> None:
        sc.fts("keyword", metadata_filter=None)
        call_kwargs = mock_client.fts_search.call_args[1]
        assert call_kwargs["metadata_filter"] is None

    def test_fts_omitted_filter_defaults_to_none(self, sc, mock_client) -> None:
        sc.fts("keyword")
        call_kwargs = mock_client.fts_search.call_args[1]
        assert call_kwargs["metadata_filter"] is None

    # ── semantic ──────────────────────────────────────────────────────────────

    def test_semantic_passes_metadata_filter_to_client(self, sc, mock_client) -> None:
        f = {"project": "cerefox"}
        sc.semantic("q", metadata_filter=f)
        call_kwargs = mock_client.semantic_search.call_args[1]
        assert call_kwargs["metadata_filter"] == f

    def test_semantic_none_filter_passed_as_none(self, sc, mock_client) -> None:
        sc.semantic("q", metadata_filter=None)
        call_kwargs = mock_client.semantic_search.call_args[1]
        assert call_kwargs["metadata_filter"] is None

    # ── search_docs ───────────────────────────────────────────────────────────

    def test_search_docs_passes_metadata_filter_to_client(self, sc, mock_client) -> None:
        f = {"status": "draft"}
        sc.search_docs("q", metadata_filter=f)
        call_kwargs = mock_client.search_docs.call_args[1]
        assert call_kwargs["metadata_filter"] == f

    def test_search_docs_none_filter_passed_as_none(self, sc, mock_client) -> None:
        sc.search_docs("q", metadata_filter=None)
        call_kwargs = mock_client.search_docs.call_args[1]
        assert call_kwargs["metadata_filter"] is None

    def test_search_docs_omitted_filter_defaults_to_none(self, sc, mock_client) -> None:
        sc.search_docs("q")
        call_kwargs = mock_client.search_docs.call_args[1]
        assert call_kwargs["metadata_filter"] is None

    # ── CerefoxClient RPC propagation ─────────────────────────────────────────
    # These tests exercise client.py directly (no search.py layer).

    def test_client_hybrid_search_includes_p_metadata_filter(self) -> None:
        """CerefoxClient.hybrid_search passes p_metadata_filter when set."""
        from cerefox.db.client import CerefoxClient

        mock_settings = MagicMock()
        mock_settings.is_supabase_configured.return_value = True
        c = CerefoxClient(mock_settings)
        c._client = MagicMock()
        c._client.rpc.return_value.execute.return_value.data = []

        f = {"type": "decision"}
        c.hybrid_search(
            query_text="q",
            query_embedding=[0.1] * 768,
            metadata_filter=f,
        )
        call_args = c._client.rpc.call_args
        rpc_name, rpc_params = call_args[0]
        assert rpc_name == "cerefox_hybrid_search"
        assert rpc_params["p_metadata_filter"] == f

    def test_client_hybrid_search_omits_p_metadata_filter_when_none(self) -> None:
        """CerefoxClient.hybrid_search does NOT send p_metadata_filter when None."""
        from cerefox.db.client import CerefoxClient

        mock_settings = MagicMock()
        mock_settings.is_supabase_configured.return_value = True
        c = CerefoxClient(mock_settings)
        c._client = MagicMock()
        c._client.rpc.return_value.execute.return_value.data = []

        c.hybrid_search(query_text="q", query_embedding=[0.1] * 768, metadata_filter=None)
        call_args = c._client.rpc.call_args
        _, rpc_params = call_args[0]
        assert "p_metadata_filter" not in rpc_params

    def test_client_fts_search_includes_p_metadata_filter(self) -> None:
        """CerefoxClient.fts_search passes p_metadata_filter when set."""
        from cerefox.db.client import CerefoxClient

        mock_settings = MagicMock()
        mock_settings.is_supabase_configured.return_value = True
        c = CerefoxClient(mock_settings)
        c._client = MagicMock()
        c._client.rpc.return_value.execute.return_value.data = []

        f = {"source": "agent"}
        c.fts_search(query_text="keyword", metadata_filter=f)
        call_args = c._client.rpc.call_args
        _, rpc_params = call_args[0]
        assert rpc_params["p_metadata_filter"] == f

    def test_client_search_docs_includes_p_metadata_filter(self) -> None:
        """CerefoxClient.search_docs passes p_metadata_filter when set."""
        from cerefox.db.client import CerefoxClient

        mock_settings = MagicMock()
        mock_settings.is_supabase_configured.return_value = True
        c = CerefoxClient(mock_settings)
        c._client = MagicMock()
        c._client.rpc.return_value.execute.return_value.data = []

        f = {"type": "design-doc"}
        c.search_docs(query_text="q", query_embedding=[0.1] * 768, metadata_filter=f)
        call_args = c._client.rpc.call_args
        _, rpc_params = call_args[0]
        assert rpc_params["p_metadata_filter"] == f

    def test_client_search_docs_omits_p_metadata_filter_when_none(self) -> None:
        """CerefoxClient.search_docs does NOT send p_metadata_filter when None."""
        from cerefox.db.client import CerefoxClient

        mock_settings = MagicMock()
        mock_settings.is_supabase_configured.return_value = True
        c = CerefoxClient(mock_settings)
        c._client = MagicMock()
        c._client.rpc.return_value.execute.return_value.data = []

        c.search_docs(query_text="q", query_embedding=[0.1] * 768, metadata_filter=None)
        call_args = c._client.rpc.call_args
        _, rpc_params = call_args[0]
        assert "p_metadata_filter" not in rpc_params


# ── max_bytes parameter ────────────────────────────────────────────────────────


class TestMaxBytesParameter:
    """Verify max_bytes behaviour across all search modes.

    Design:
    - max_bytes=None (default) → no truncation; all results returned (web UI / CLI path)
    - max_bytes=<int>          → results dropped whole until budget satisfied (MCP path)
    - The parameter is threaded through SearchClient methods and passed to _build_*
    - settings.max_response_bytes is no longer read by SearchClient; callers decide
    """

    def test_search_docs_no_truncation_when_max_bytes_none(
        self, mock_client, mock_embedder, test_settings
    ) -> None:
        big_content = "x" * 50_000
        rows = [_make_doc_row(document_id=f"d{i}", full_content=big_content) for i in range(5)]
        mock_client.search_docs.return_value = rows
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        resp = sc.search_docs("q", max_bytes=None)
        assert not resp.truncated
        assert len(resp.results) == 5
        assert resp.metadata["max_bytes"] is None

    def test_search_docs_truncates_when_max_bytes_exceeded(
        self, mock_client, mock_embedder, test_settings
    ) -> None:
        big_content = "x" * 50_000
        rows = [_make_doc_row(document_id=f"d{i}", full_content=big_content) for i in range(5)]
        mock_client.search_docs.return_value = rows
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        resp = sc.search_docs("q", max_bytes=60_000)
        assert resp.truncated
        assert resp.total_found == 5
        assert len(resp.results) < 5
        assert resp.metadata["max_bytes"] == 60_000

    def test_hybrid_no_truncation_when_max_bytes_none(
        self, mock_client, mock_embedder, test_settings
    ) -> None:
        big_content = "x" * 10_000
        rows = [_make_row(chunk_id=f"c{i}", content=big_content) for i in range(10)]
        mock_client.hybrid_search.return_value = rows
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        resp = sc.hybrid("q", max_bytes=None)
        assert not resp.truncated
        assert len(resp.results) == 10

    def test_fts_no_truncation_when_max_bytes_none(
        self, mock_client, mock_embedder, test_settings
    ) -> None:
        big_content = "x" * 10_000
        rows = [_make_row(chunk_id=f"c{i}", content=big_content) for i in range(10)]
        mock_client.fts_search.return_value = rows
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        resp = sc.fts("q", max_bytes=None)
        assert not resp.truncated
        assert len(resp.results) == 10

    def test_semantic_no_truncation_when_max_bytes_none(
        self, mock_client, mock_embedder, test_settings
    ) -> None:
        big_content = "x" * 10_000
        rows = [_make_row(chunk_id=f"c{i}", content=big_content) for i in range(10)]
        mock_client.semantic_search.return_value = rows
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        resp = sc.semantic("q", max_bytes=None)
        assert not resp.truncated
        assert len(resp.results) == 10

    def test_max_bytes_zero_drops_all_results(
        self, mock_client, mock_embedder, test_settings
    ) -> None:
        """max_bytes=0 is an extreme case — all results are dropped."""
        mock_client.hybrid_search.return_value = [_make_row()]
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        resp = sc.hybrid("q", max_bytes=0)
        assert resp.truncated
        assert len(resp.results) == 0
        assert resp.total_found == 1

    def test_max_bytes_large_enough_returns_all(
        self, mock_client, mock_embedder, test_settings
    ) -> None:
        """Passing a very large max_bytes is equivalent to no limit in practice."""
        rows = [_make_row(chunk_id=f"c{i}") for i in range(5)]
        mock_client.fts_search.return_value = rows
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        resp = sc.fts("q", max_bytes=10_000_000)
        assert not resp.truncated
        assert len(resp.results) == 5

    def test_metadata_records_max_bytes_value(
        self, mock_client, mock_embedder, test_settings
    ) -> None:
        """Response metadata['max_bytes'] reflects the value passed by the caller."""
        sc = SearchClient(mock_client, mock_embedder, test_settings)
        resp_none = sc.hybrid("q", max_bytes=None)
        resp_int = sc.hybrid("q", max_bytes=50_000)
        assert resp_none.metadata["max_bytes"] is None
        assert resp_int.metadata["max_bytes"] == 50_000
