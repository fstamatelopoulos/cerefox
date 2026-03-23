"""Tests for audit log, review status, and version archival.

Tests cover:
  - Audit log: create_audit_entry inserts correct data, list_audit_entries filters
  - Review status: set_review_status validates values, creates audit entry, updates doc
  - Version archival: set_version_archived sets flag, creates audit entry
  - Pipeline integration: author/author_type threading, review_status auto-transition
"""

from __future__ import annotations

from unittest.mock import MagicMock, call, patch

import pytest

from cerefox.config import Settings
from cerefox.db.client import CerefoxClient


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture()
def mock_supabase():
    """A Supabase client mock with chainable table/rpc calls."""
    client = MagicMock()
    table_mock = MagicMock()
    table_mock.select.return_value = table_mock
    table_mock.insert.return_value = table_mock
    table_mock.update.return_value = table_mock
    table_mock.delete.return_value = table_mock
    table_mock.eq.return_value = table_mock
    table_mock.is_.return_value = table_mock
    table_mock.gte.return_value = table_mock
    table_mock.lte.return_value = table_mock
    table_mock.order.return_value = table_mock
    table_mock.limit.return_value = table_mock
    table_mock.execute.return_value = MagicMock(data=[], count=0)
    client.table.return_value = table_mock
    return client


@pytest.fixture()
def cerefox_client(mock_supabase):
    settings = Settings(_env_file=None)
    settings.supabase_url = "https://example.supabase.co"
    settings.supabase_key = "test-key"
    c = CerefoxClient(settings)
    c._client = mock_supabase
    return c


# ── Audit log: create_audit_entry ────────────────────────────────────────────


class TestCreateAuditEntry:
    def test_calls_rpc_with_correct_params(self, cerefox_client, mock_supabase):
        mock_supabase.rpc.return_value.execute.return_value = MagicMock(
            data=[{"audit_id": "audit-001", "created_at": "2026-03-23"}]
        )
        result = cerefox_client.create_audit_entry(
            operation="create",
            author="fotis",
            author_type="user",
            document_id="doc-001",
            size_after=500,
            description="Created test doc",
        )
        mock_supabase.rpc.assert_called_once_with(
            "cerefox_create_audit_entry",
            {
                "p_document_id": "doc-001",
                "p_version_id": None,
                "p_operation": "create",
                "p_author": "fotis",
                "p_author_type": "user",
                "p_size_before": None,
                "p_size_after": 500,
                "p_description": "Created test doc",
            },
        )

    def test_passes_none_for_omitted_nullable_fields(self, cerefox_client, mock_supabase):
        mock_supabase.rpc.return_value.execute.return_value = MagicMock(
            data=[{"audit_id": "audit-002", "created_at": "2026-03-23"}]
        )
        cerefox_client.create_audit_entry(operation="delete", author="system")
        call_params = mock_supabase.rpc.call_args[0][1]
        assert call_params["p_document_id"] is None
        assert call_params["p_version_id"] is None
        assert call_params["p_size_before"] is None
        assert call_params["p_size_after"] is None

    def test_agent_author_type_preserved(self, cerefox_client, mock_supabase):
        mock_supabase.rpc.return_value.execute.return_value = MagicMock(
            data=[{"audit_id": "audit-004", "created_at": "2026-03-23"}]
        )
        cerefox_client.create_audit_entry(
            operation="update-content", author="Claude Code", author_type="agent"
        )
        call_params = mock_supabase.rpc.call_args[0][1]
        assert call_params["p_author_type"] == "agent"
        assert call_params["p_author"] == "Claude Code"


# ── Audit log: list_audit_entries ────────────────────────────────────────────


class TestListAuditEntries:
    def test_calls_rpc_with_no_filters(self, cerefox_client, mock_supabase):
        cerefox_client.list_audit_entries()
        mock_supabase.rpc.assert_called_with(
            "cerefox_list_audit_entries",
            {
                "p_document_id": None,
                "p_author": None,
                "p_operation": None,
                "p_since": None,
                "p_until": None,
                "p_limit": 50,
            },
        )

    def test_passes_document_id_filter(self, cerefox_client, mock_supabase):
        cerefox_client.list_audit_entries(document_id="doc-001")
        call_args = mock_supabase.rpc.call_args
        assert call_args[0][1]["p_document_id"] == "doc-001"

    def test_passes_author_filter(self, cerefox_client, mock_supabase):
        cerefox_client.list_audit_entries(author="fotis")
        call_args = mock_supabase.rpc.call_args
        assert call_args[0][1]["p_author"] == "fotis"

    def test_passes_since_filter(self, cerefox_client, mock_supabase):
        cerefox_client.list_audit_entries(since="2026-03-22T00:00:00Z")
        call_args = mock_supabase.rpc.call_args
        assert call_args[0][1]["p_since"] == "2026-03-22T00:00:00Z"

    def test_passes_custom_limit(self, cerefox_client, mock_supabase):
        cerefox_client.list_audit_entries(limit=10)
        call_args = mock_supabase.rpc.call_args
        assert call_args[0][1]["p_limit"] == 10


# ── Review status ────────────────────────────────────────────────────────────


class TestSetReviewStatus:
    def test_valid_status_approved(self, cerefox_client, mock_supabase):
        # set_review_status calls: get_document_by_id (select), update (documents), insert (audit_log)
        # Since mock returns same table_mock for all table() calls, just verify no error raised
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "doc-001", "review_status": "pending_review"}]
        )
        mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "doc-001", "review_status": "approved"}]
        )
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock(
            data=[{"id": "audit-001"}]
        )
        # Should not raise
        cerefox_client.set_review_status("doc-001", "approved", author="fotis")

    def test_valid_status_pending_review(self, cerefox_client, mock_supabase):
        mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "doc-001", "review_status": "pending_review"}]
        )
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "doc-001", "review_status": "approved"}]
        )
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock(
            data=[{"id": "audit-001"}]
        )
        cerefox_client.set_review_status("doc-001", "pending_review")

    def test_invalid_status_raises_value_error(self, cerefox_client):
        with pytest.raises(ValueError, match="Invalid review_status"):
            cerefox_client.set_review_status("doc-001", "archived")

    def test_creates_audit_entry_on_status_change(self, cerefox_client, mock_supabase):
        mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "doc-001", "review_status": "approved"}]
        )
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "doc-001", "review_status": "pending_review"}]
        )
        mock_supabase.rpc.return_value.execute.return_value = MagicMock(
            data=[{"audit_id": "audit-001", "created_at": "2026-03-23"}]
        )
        cerefox_client.set_review_status("doc-001", "approved", author="fotis")
        # Verify audit RPC was called
        rpc_calls = [c[0][0] for c in mock_supabase.rpc.call_args_list]
        assert "cerefox_create_audit_entry" in rpc_calls


# ── Version archival ─────────────────────────────────────────────────────────


class TestSetVersionArchived:
    def test_archive_calls_update_with_true(self, cerefox_client, mock_supabase):
        mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "ver-001", "document_id": "doc-001", "version_number": 2, "archived": True}]
        )
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock(
            data=[{"id": "audit-001"}]
        )
        cerefox_client.set_version_archived("ver-001", True, author="fotis")
        # Verify update was called with archived=True
        mock_supabase.table.return_value.update.assert_called_with({"archived": True})

    def test_unarchive_calls_update_with_false(self, cerefox_client, mock_supabase):
        mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "ver-001", "document_id": "doc-001", "version_number": 2, "archived": False}]
        )
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock(
            data=[{"id": "audit-001"}]
        )
        cerefox_client.set_version_archived("ver-001", False)
        mock_supabase.table.return_value.update.assert_called_with({"archived": False})

    def test_creates_audit_entry_for_archive(self, cerefox_client, mock_supabase):
        mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "ver-001", "document_id": "doc-001", "version_number": 3, "archived": True}]
        )
        mock_supabase.rpc.return_value.execute.return_value = MagicMock(
            data=[{"audit_id": "audit-001", "created_at": "2026-03-23"}]
        )
        cerefox_client.set_version_archived("ver-001", True, author="fotis")
        rpc_calls = [c[0][0] for c in mock_supabase.rpc.call_args_list]
        assert "cerefox_create_audit_entry" in rpc_calls

    def test_creates_audit_entry_for_unarchive(self, cerefox_client, mock_supabase):
        mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "ver-001", "document_id": "doc-001", "version_number": 3, "archived": False}]
        )
        mock_supabase.rpc.return_value.execute.return_value = MagicMock(
            data=[{"audit_id": "audit-001", "created_at": "2026-03-23"}]
        )
        cerefox_client.set_version_archived("ver-001", False, author="fotis")
        rpc_calls = [c[0][0] for c in mock_supabase.rpc.call_args_list]
        assert "cerefox_create_audit_entry" in rpc_calls


# ── Pipeline: author_type threading and review_status auto-transition ────────


class TestPipelineAuditIntegration:
    """Test that the ingestion pipeline correctly threads author/author_type
    and triggers review_status auto-transitions."""

    @pytest.fixture()
    def pipeline(self):
        from cerefox.ingestion.pipeline import IngestionPipeline

        mock_client = MagicMock()
        mock_embedder = MagicMock()
        mock_embedder.model_name = "test-model"
        settings = Settings(_env_file=None)
        settings.supabase_url = "https://example.supabase.co"
        settings.supabase_key = "test-key"
        p = IngestionPipeline(mock_client, mock_embedder, settings)
        return p, mock_client, mock_embedder

    def test_ingest_text_passes_author_and_author_type_to_rpc(self, pipeline):
        p, mock_client, mock_embedder = pipeline
        mock_client.get_document_by_hash.return_value = None
        mock_client.ingest_document_rpc.return_value = {
            "document_id": "doc-new", "chunk_count": 1, "total_chars": 50,
            "operation": "create", "version_id": None,
        }
        mock_embedder.embed_batch.return_value = [[0.1] * 768]

        p.ingest_text(
            "# Test\n\nBody", "Test", author="Claude Code", author_type="agent"
        )

        mock_client.ingest_document_rpc.assert_called_once()
        rpc_kwargs = mock_client.ingest_document_rpc.call_args[1]
        assert rpc_kwargs["author"] == "Claude Code"
        assert rpc_kwargs["author_type"] == "agent"

    def test_update_document_agent_sets_pending_review(self, pipeline):
        p, mock_client, mock_embedder = pipeline
        mock_client.get_document_by_id.return_value = {
            "id": "doc-001", "content_hash": "old-hash",
            "chunk_count": 1, "total_chars": 50, "review_status": "approved",
            "source_path": "test.md", "metadata": {},
        }
        mock_client.get_document_by_hash.return_value = None
        mock_client.ingest_document_rpc.return_value = {
            "document_id": "doc-001", "chunk_count": 1, "total_chars": 50,
            "operation": "update-content", "version_id": "ver-001",
        }
        mock_client.get_document_project_ids.return_value = []
        mock_embedder.embed_batch.return_value = [[0.1] * 768]

        p.update_document(
            "doc-001", "# New\n\nChanged content", "New",
            author="Claude Code", author_type="agent"
        )

        rpc_kwargs = mock_client.ingest_document_rpc.call_args[1]
        assert rpc_kwargs["review_status"] == "pending_review"
        assert rpc_kwargs["document_id"] == "doc-001"

    def test_update_document_user_sets_approved(self, pipeline):
        p, mock_client, mock_embedder = pipeline
        mock_client.get_document_by_id.return_value = {
            "id": "doc-001", "content_hash": "old-hash",
            "chunk_count": 1, "total_chars": 50, "review_status": "pending_review",
            "source_path": "test.md", "metadata": {},
        }
        mock_client.get_document_by_hash.return_value = None
        mock_client.ingest_document_rpc.return_value = {
            "document_id": "doc-001", "chunk_count": 1, "total_chars": 50,
            "operation": "update-content", "version_id": "ver-001",
        }
        mock_client.get_document_project_ids.return_value = []
        mock_embedder.embed_batch.return_value = [[0.1] * 768]

        p.update_document(
            "doc-001", "# New\n\nChanged by human", "New",
            author="fotis", author_type="user"
        )

        rpc_kwargs = mock_client.ingest_document_rpc.call_args[1]
        assert rpc_kwargs["review_status"] == "approved"

    def test_metadata_only_update_does_not_change_review_status(self, pipeline):
        """When content is unchanged, review_status should not be modified."""
        p, mock_client, mock_embedder = pipeline
        mock_client.get_document_by_id.return_value = {
            "id": "doc-001",
            "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            "chunk_count": 0, "total_chars": 0, "review_status": "pending_review",
        }
        mock_client.list_chunks_for_document.return_value = [{"id": "chunk-1"}]
        mock_client.update_document.return_value = {"id": "doc-001"}
        mock_client.get_document_project_ids.return_value = []
        mock_client.create_audit_entry.return_value = {}

        p.update_document(
            "doc-001", "", "Updated Title",  # empty string hashes to e3b0c4...
            author="fotis", author_type="user"
        )

        # Only one update_document call (metadata), no review_status change
        assert mock_client.update_document.call_count == 1
        update_data = mock_client.update_document.call_args[0][1]
        assert "review_status" not in update_data


# ── Config: version_cleanup_enabled ──────────────────────────────────────────


class TestVersionCleanupEnabled:
    def test_default_is_true(self):
        settings = Settings(_env_file=None)
        assert settings.version_cleanup_enabled is True

    def test_can_be_set_to_false(self):
        settings = Settings(_env_file=None, version_cleanup_enabled=False)
        assert settings.version_cleanup_enabled is False

    def test_cleanup_enabled_passed_to_ingest_rpc(self):
        """When version_cleanup_enabled=False, ingest_document_rpc gets cleanup_enabled=False."""
        from cerefox.ingestion.pipeline import IngestionPipeline

        mock_client = MagicMock()
        mock_embedder = MagicMock()
        mock_embedder.model_name = "test-model"
        settings = Settings(_env_file=None)
        settings.supabase_url = "https://example.supabase.co"
        settings.supabase_key = "test-key"
        settings.version_cleanup_enabled = False

        p = IngestionPipeline(mock_client, mock_embedder, settings)

        mock_client.get_document_by_id.return_value = {
            "id": "doc-001", "content_hash": "old-hash",
            "chunk_count": 1, "total_chars": 50,
            "source_path": "test.md", "metadata": {},
        }
        mock_client.get_document_by_hash.return_value = None
        mock_client.ingest_document_rpc.return_value = {
            "document_id": "doc-001", "chunk_count": 1, "total_chars": 50,
            "operation": "update-content", "version_id": "v1",
        }
        mock_client.get_document_project_ids.return_value = []
        mock_embedder.embed_batch.return_value = [[0.1] * 768]

        p.update_document("doc-001", "# New\n\nChanged", "New")

        rpc_kwargs = mock_client.ingest_document_rpc.call_args[1]
        assert rpc_kwargs["cleanup_enabled"] is False
