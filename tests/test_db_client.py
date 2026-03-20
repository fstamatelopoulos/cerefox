"""Tests for cerefox.db.client.CerefoxClient.

All tests use a mocked Supabase client — no network calls are made.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from cerefox.config import Settings
from cerefox.db.client import CerefoxClient


class TestClientInitialization:
    """Client should initialize lazily and raise clearly when misconfigured."""

    def test_client_creates_without_error(self, test_settings: Settings) -> None:
        client = CerefoxClient(test_settings)
        assert client is not None

    def test_client_is_lazy(self, test_settings: Settings) -> None:
        """Supabase client should not be created until first use."""
        client = CerefoxClient(test_settings)
        assert client._client is None

    def test_client_raises_when_url_missing(self) -> None:
        with patch.dict(
            "os.environ",
            {"CEREFOX_SUPABASE_URL": "", "CEREFOX_SUPABASE_KEY": "", "CEREFOX_EMBEDDER": "openai"},
            clear=False,
        ):
            settings = Settings()
        client = CerefoxClient(settings)
        with pytest.raises(RuntimeError, match="not configured"):
            _ = client.client

    def test_client_initializes_supabase_with_correct_credentials(
        self, test_settings: Settings
    ) -> None:
        with patch("cerefox.db.client.create_client") as mock_create:
            mock_create.return_value = MagicMock()
            client = CerefoxClient(test_settings)
            _ = client.client
        mock_create.assert_called_once_with(
            test_settings.supabase_url,
            test_settings.supabase_key,
        )


class TestRpc:
    """rpc() should call supabase.rpc() with correct arguments and return data."""

    def test_rpc_calls_supabase_rpc(
        self, cerefox_client: CerefoxClient, mock_supabase_client: MagicMock
    ) -> None:
        mock_supabase_client.rpc.return_value.execute.return_value.data = [{"id": "abc"}]
        result = cerefox_client.rpc("cerefox_fts_search", {"p_query_text": "hello"})
        mock_supabase_client.rpc.assert_called_once_with(
            "cerefox_fts_search", {"p_query_text": "hello"}
        )
        assert result == [{"id": "abc"}]

    def test_rpc_returns_empty_list_when_no_data(
        self, cerefox_client: CerefoxClient, mock_supabase_client: MagicMock
    ) -> None:
        mock_supabase_client.rpc.return_value.execute.return_value.data = None
        result = cerefox_client.rpc("cerefox_fts_search", {"p_query_text": "hello"})
        assert result == []

    def test_rpc_raises_runtime_error_on_failure(
        self, cerefox_client: CerefoxClient, mock_supabase_client: MagicMock
    ) -> None:
        mock_supabase_client.rpc.return_value.execute.side_effect = Exception("network error")
        with pytest.raises(RuntimeError, match="cerefox_fts_search"):
            cerefox_client.rpc("cerefox_fts_search", {"p_query_text": "hello"})


class TestSearchMethods:
    """Convenience search methods should call rpc() with correct parameter names."""

    def test_hybrid_search_params(
        self,
        cerefox_client: CerefoxClient,
        mock_supabase_client: MagicMock,
        sample_embedding: list[float],
    ) -> None:
        mock_supabase_client.rpc.return_value.execute.return_value.data = []
        cerefox_client.hybrid_search(
            query_text="test query",
            query_embedding=sample_embedding,
            match_count=5,
            alpha=0.8,
        )
        mock_supabase_client.rpc.assert_called_once_with(
            "cerefox_hybrid_search",
            {
                "p_query_text": "test query",
                "p_query_embedding": sample_embedding,
                "p_match_count": 5,
                "p_alpha": 0.8,
                "p_use_upgrade": False,
                "p_project_id": None,
                "p_min_score": 0.0,
            },
        )

    def test_fts_search_params(
        self, cerefox_client: CerefoxClient, mock_supabase_client: MagicMock
    ) -> None:
        mock_supabase_client.rpc.return_value.execute.return_value.data = []
        cerefox_client.fts_search("exact keyword", match_count=3)
        mock_supabase_client.rpc.assert_called_once_with(
            "cerefox_fts_search",
            {"p_query_text": "exact keyword", "p_match_count": 3, "p_project_id": None},
        )

    def test_semantic_search_params(
        self,
        cerefox_client: CerefoxClient,
        mock_supabase_client: MagicMock,
        sample_embedding: list[float],
    ) -> None:
        mock_supabase_client.rpc.return_value.execute.return_value.data = []
        cerefox_client.semantic_search(sample_embedding, match_count=7, use_upgrade=True)
        mock_supabase_client.rpc.assert_called_once_with(
            "cerefox_semantic_search",
            {
                "p_query_embedding": sample_embedding,
                "p_match_count": 7,
                "p_use_upgrade": True,
                "p_project_id": None,
            },
        )

    def test_reconstruct_doc_returns_first_row(
        self,
        cerefox_client: CerefoxClient,
        mock_supabase_client: MagicMock,
    ) -> None:
        doc_id = "bbbbbbbb-0000-0000-0000-000000000002"
        expected = {"document_id": doc_id, "full_content": "# Hello\n\nworld"}
        mock_supabase_client.rpc.return_value.execute.return_value.data = [expected]
        result = cerefox_client.reconstruct_doc(doc_id)
        assert result == expected

    def test_reconstruct_doc_returns_none_when_not_found(
        self, cerefox_client: CerefoxClient, mock_supabase_client: MagicMock
    ) -> None:
        mock_supabase_client.rpc.return_value.execute.return_value.data = []
        result = cerefox_client.reconstruct_doc("nonexistent-id")
        assert result is None

    def test_search_docs_params(
        self,
        cerefox_client: CerefoxClient,
        mock_supabase_client: MagicMock,
        sample_embedding: list[float],
    ) -> None:
        mock_supabase_client.rpc.return_value.execute.return_value.data = []
        cerefox_client.search_docs("my query", sample_embedding, match_count=3, alpha=0.6)
        mock_supabase_client.rpc.assert_called_once_with(
            "cerefox_search_docs",
            {
                "p_query_text": "my query",
                "p_query_embedding": sample_embedding,
                "p_match_count": 3,
                "p_alpha": 0.6,
                "p_project_id": None,
                "p_min_score": 0.0,
                "p_small_to_big_threshold": 0,
                "p_context_window": 1,
            },
        )

    def test_search_docs_returns_rows(
        self,
        cerefox_client: CerefoxClient,
        mock_supabase_client: MagicMock,
        sample_embedding: list[float],
    ) -> None:
        expected = [{"document_id": "doc-1", "doc_title": "Note", "best_score": 0.9}]
        mock_supabase_client.rpc.return_value.execute.return_value.data = expected
        result = cerefox_client.search_docs("q", sample_embedding)
        assert result == expected


class TestDocumentMethods:
    """Document CRUD methods should map to correct Supabase table operations."""

    def test_insert_document_returns_created_row(
        self, cerefox_client: CerefoxClient, mock_supabase_client: MagicMock
    ) -> None:
        expected = {"id": "doc-1", "title": "My Note", "source": "file"}
        mock_supabase_client.table.return_value.insert.return_value.execute.return_value.data = [
            expected
        ]
        result = cerefox_client.insert_document(
            {"title": "My Note", "source": "file", "content_hash": "abc123"}
        )
        assert result == expected

    def test_insert_document_raises_when_no_data_returned(
        self, cerefox_client: CerefoxClient, mock_supabase_client: MagicMock
    ) -> None:
        mock_supabase_client.table.return_value.insert.return_value.execute.return_value.data = []
        with pytest.raises(RuntimeError, match="no data"):
            cerefox_client.insert_document({"title": "X", "content_hash": "y"})

    def test_get_document_by_hash_returns_none_when_missing(
        self, cerefox_client: CerefoxClient, mock_supabase_client: MagicMock
    ) -> None:
        (
            mock_supabase_client.table.return_value
            .select.return_value
            .eq.return_value
            .limit.return_value
            .execute.return_value.data
        ) = []
        result = cerefox_client.get_document_by_hash("nonexistent-hash")
        assert result is None


class TestProjectMethods:
    """Project methods should correctly interact with cerefox_projects table."""

    def test_list_projects_returns_data(
        self, cerefox_client: CerefoxClient, mock_supabase_client: MagicMock
    ) -> None:
        projects = [{"id": "p1", "name": "Work"}, {"id": "p2", "name": "Research"}]
        mock_supabase_client.table.return_value.select.return_value.order.return_value.execute.return_value.data = projects
        result = cerefox_client.list_projects()
        assert result == projects

    def test_list_projects_returns_empty_list_when_none(
        self, cerefox_client: CerefoxClient, mock_supabase_client: MagicMock
    ) -> None:
        mock_supabase_client.table.return_value.select.return_value.order.return_value.execute.return_value.data = []
        result = cerefox_client.list_projects()
        assert result == []

    def test_get_project_doc_counts_returns_counts(
        self, cerefox_client: CerefoxClient, mock_supabase_client: MagicMock
    ) -> None:
        rows = [{"project_id": "p1"}, {"project_id": "p1"}, {"project_id": "p2"}]
        mock_supabase_client.table.return_value.select.return_value.in_.return_value.execute.return_value.data = rows
        result = cerefox_client.get_project_doc_counts(["p1", "p2", "p3"])
        assert result == {"p1": 2, "p2": 1, "p3": 0}

    def test_get_project_doc_counts_empty_list(
        self, cerefox_client: CerefoxClient, mock_supabase_client: MagicMock
    ) -> None:
        result = cerefox_client.get_project_doc_counts([])
        assert result == {}
        mock_supabase_client.table.assert_not_called()

    def test_get_project_doc_counts_degrades_on_error(
        self, cerefox_client: CerefoxClient, mock_supabase_client: MagicMock
    ) -> None:
        mock_supabase_client.table.return_value.select.return_value.in_.return_value.execute.side_effect = Exception(
            "DB error"
        )
        result = cerefox_client.get_project_doc_counts(["p1", "p2"])
        assert result == {"p1": 0, "p2": 0}


class TestLookupMethods:
    """find_document_by_source_path and find_document_by_title should query the
    cerefox_documents table and return the first row or None."""

    def _mock_chain(self, mock_supabase_client, rows: list) -> None:
        """Wire table().select().eq().order().limit().execute().data to *rows*."""
        (
            mock_supabase_client.table.return_value
            .select.return_value
            .eq.return_value
            .order.return_value
            .limit.return_value
            .execute.return_value
        ).data = rows

    def test_find_by_source_path_returns_match(
        self, cerefox_client: CerefoxClient, mock_supabase_client: MagicMock
    ) -> None:
        doc = {"id": "doc-1", "title": "Note", "source_path": "note.md"}
        self._mock_chain(mock_supabase_client, [doc])
        result = cerefox_client.find_document_by_source_path("note.md")
        assert result == doc

    def test_find_by_source_path_returns_none_when_missing(
        self, cerefox_client: CerefoxClient, mock_supabase_client: MagicMock
    ) -> None:
        self._mock_chain(mock_supabase_client, [])
        result = cerefox_client.find_document_by_source_path("nonexistent.md")
        assert result is None

    def test_find_by_title_returns_match(
        self, cerefox_client: CerefoxClient, mock_supabase_client: MagicMock
    ) -> None:
        doc = {"id": "doc-2", "title": "My Note", "source_path": None}
        self._mock_chain(mock_supabase_client, [doc])
        result = cerefox_client.find_document_by_title("My Note")
        assert result == doc

    def test_find_by_title_returns_none_when_missing(
        self, cerefox_client: CerefoxClient, mock_supabase_client: MagicMock
    ) -> None:
        self._mock_chain(mock_supabase_client, [])
        result = cerefox_client.find_document_by_title("Ghost Title")
        assert result is None
