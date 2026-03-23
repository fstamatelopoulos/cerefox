"""Tests for cerefox.ingestion.pipeline.IngestionPipeline.

All tests mock the DB client and embedder — no network calls, no Supabase.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from cerefox.config import Settings
from cerefox.ingestion.pipeline import IngestResult, IngestionPipeline, _hash, _normalize


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture()
def settings(test_settings: Settings) -> Settings:
    return test_settings


@pytest.fixture()
def mock_client() -> MagicMock:
    client = MagicMock()
    client.get_document_by_hash.return_value = None        # not found by default
    client.insert_document.return_value = {"id": "doc-001", "title": "T"}
    client.insert_chunks.return_value = []
    client.get_or_create_project.return_value = {"id": "proj-001", "name": "work"}
    client.get_document_project_ids.return_value = []
    client.assign_document_projects.return_value = None
    # By default no metadata keys registered (validation passthrough)
    client.list_metadata_keys.return_value = []
    return client


@pytest.fixture()
def mock_embedder() -> MagicMock:
    emb = MagicMock()
    emb.model_name = "test-embedder"
    emb.embed_batch.return_value = [[0.0] * 768]
    return emb


@pytest.fixture()
def pipeline(mock_client, mock_embedder, settings) -> IngestionPipeline:
    return IngestionPipeline(mock_client, mock_embedder, settings)


# ── _hash helper ──────────────────────────────────────────────────────────────


class TestHash:
    def test_returns_64_hex_chars(self) -> None:
        h = _hash("hello")
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)

    def test_deterministic(self) -> None:
        assert _hash("same text") == _hash("same text")

    def test_different_text_different_hash(self) -> None:
        assert _hash("text A") != _hash("text B")

    def test_trailing_newline_same_hash(self) -> None:
        """Content with/without trailing newline hashes identically (strip normalisation)."""
        assert _hash("# Doc\n\nBody.") == _hash("# Doc\n\nBody.\n")

    def test_leading_whitespace_same_hash(self) -> None:
        assert _hash("# Doc\n\nBody.") == _hash("\n# Doc\n\nBody.")

    def test_excess_blank_lines_same_hash(self) -> None:
        """3+ consecutive newlines are collapsed to 2 before hashing."""
        assert _hash("# A\n\nBody A\n\n\n\n# B\n\nBody B") == _hash("# A\n\nBody A\n\n# B\n\nBody B")

    def test_crlf_same_hash_as_lf(self) -> None:
        """CRLF line endings (browser form submission) hash identically to LF."""
        assert _hash("# Doc\r\n\r\nBody.") == _hash("# Doc\n\nBody.")


class TestNormalize:
    def test_strips_trailing_newline(self) -> None:
        assert _normalize("hello\n") == "hello"

    def test_strips_leading_whitespace(self) -> None:
        assert _normalize("\n\nhello") == "hello"

    def test_collapses_triple_newlines(self) -> None:
        assert _normalize("a\n\n\nb") == "a\n\nb"

    def test_collapses_many_newlines(self) -> None:
        assert _normalize("a\n\n\n\n\n\nb") == "a\n\nb"

    def test_preserves_double_newlines(self) -> None:
        assert _normalize("a\n\nb") == "a\n\nb"

    def test_crlf_converted_to_lf(self) -> None:
        """Browser form submissions use CRLF; normalise to LF before hashing."""
        assert _normalize("line1\r\nline2\r\nline3") == "line1\nline2\nline3"

    def test_bare_cr_converted_to_lf(self) -> None:
        assert _normalize("line1\rline2") == "line1\nline2"

    def test_crlf_excess_blank_lines_collapsed(self) -> None:
        """CRLF blank lines should also be collapsed after conversion."""
        assert _normalize("a\r\n\r\n\r\nb") == "a\n\nb"


# ── Happy path ────────────────────────────────────────────────────────────────


class TestIngestText:
    def test_returns_ingest_result(self, pipeline, mock_client) -> None:
        mock_client.insert_document.return_value = {"id": "doc-001", "title": "My Note"}
        result = pipeline.ingest_text("# My Note\n\nContent.", title="My Note")
        assert isinstance(result, IngestResult)
        assert result.document_id == "doc-001"
        assert result.title == "My Note"
        assert not result.skipped

    def test_new_doc_action_is_created(self, pipeline, mock_client) -> None:
        result = pipeline.ingest_text("# T\n\nB.", title="T")
        assert result.action == "created"

    def test_insert_document_called_with_hash(self, pipeline, mock_client) -> None:
        text = "# Doc\n\nBody."
        pipeline.ingest_text(text, title="Doc")
        call_kwargs = mock_client.insert_document.call_args[0][0]
        assert call_kwargs["content_hash"] == _hash(text)
        assert call_kwargs["title"] == "Doc"

    def test_insert_document_called_with_source(self, pipeline, mock_client) -> None:
        pipeline.ingest_text("# T\n\nB.", title="T", source="file")
        call_kwargs = mock_client.insert_document.call_args[0][0]
        assert call_kwargs["source"] == "file"

    def test_insert_document_has_no_project_id_column(self, pipeline, mock_client) -> None:
        """project_id no longer lives on the document row — it goes through junction table."""
        pipeline.ingest_text("# T\n\nB.", title="T")
        call_kwargs = mock_client.insert_document.call_args[0][0]
        assert "project_id" not in call_kwargs

    def test_chunks_are_embedded_and_stored(self, pipeline, mock_client, mock_embedder) -> None:
        text = "# Section\n\nSome content."
        pipeline.ingest_text(text, title="Section")
        mock_embedder.embed_batch.assert_called_once()
        mock_client.insert_chunks.assert_called_once()
        chunk_rows = mock_client.insert_chunks.call_args[0][0]
        assert len(chunk_rows) >= 1
        assert chunk_rows[0]["document_id"] == "doc-001"
        assert chunk_rows[0]["embedder_primary"] == "test-embedder"

    def test_chunk_row_has_required_fields(self, pipeline, mock_client, mock_embedder) -> None:
        text = "# Title\n\nContent body."
        mock_embedder.embed_batch.return_value = [[0.1] * 768]
        pipeline.ingest_text(text, title="Title")
        chunk_row = mock_client.insert_chunks.call_args[0][0][0]
        required = {
            "document_id", "chunk_index", "heading_path", "heading_level",
            "title", "content", "char_count", "embedding_primary", "embedder_primary",
        }
        assert required.issubset(chunk_row.keys())

    def test_result_chunk_count_matches_actual(self, pipeline, mock_client, mock_embedder) -> None:
        # Doc with 3 H2 sections — each section (~3 000 chars) is large enough
        # that no two fit together within max_chunk_chars (4 000), so greedy
        # accumulation produces exactly 3 chunks (one per H2 section).
        body = "word " * 600  # ~3 000 chars per section; 3000+2+3000=6002 > 4000
        text = f"## A\n\n{body}\n\n## B\n\n{body}\n\n## C\n\n{body}"
        mock_embedder.embed_batch.return_value = [[0.0] * 768] * 3
        mock_client.insert_document.return_value = {"id": "doc-001", "title": "Doc"}
        result = pipeline.ingest_text(text, title="Doc")
        assert result.chunk_count == 3

    def test_with_project_name_calls_get_or_create(self, pipeline, mock_client) -> None:
        pipeline.ingest_text("# T\n\nB.", title="T", project_name="research")
        mock_client.get_or_create_project.assert_called_once_with("research")
        mock_client.assign_document_projects.assert_called_once_with("doc-001", ["proj-001"])

    def test_without_project_no_project_lookup(self, pipeline, mock_client) -> None:
        pipeline.ingest_text("# T\n\nB.", title="T")
        mock_client.get_or_create_project.assert_not_called()
        mock_client.assign_document_projects.assert_not_called()

    def test_result_project_ids_set_from_name(self, pipeline, mock_client) -> None:
        result = pipeline.ingest_text("# T\n\nB.", title="T", project_name="work")
        assert result.project_ids == ["proj-001"]

    def test_metadata_passed_to_document(self, pipeline, mock_client) -> None:
        meta = {"tags": "idea"}
        pipeline.ingest_text("# T\n\nB.", title="T", metadata=meta)
        doc_kwargs = mock_client.insert_document.call_args[0][0]
        assert doc_kwargs["metadata"] == meta

    def test_empty_text_still_calls_insert(self, pipeline, mock_client, mock_embedder) -> None:
        """Edge case: a document with no parseable chunks should still insert a document row."""
        mock_embedder.embed_batch.return_value = []
        result = pipeline.ingest_text("", title="Empty")
        mock_client.insert_document.assert_called_once()
        assert result.chunk_count == 0

    def test_paste_without_source_path_derives_slug(self, pipeline, mock_client) -> None:
        """Paste ingestion with no source_path should store a slugified filename derived from title."""
        pipeline.ingest_text("# My Research Notes\n\nContent.", title="My Research Notes")
        doc_kwargs = mock_client.insert_document.call_args[0][0]
        assert doc_kwargs["source_path"] == "my-research-notes.md"

    def test_paste_slug_strips_special_chars(self, pipeline, mock_client) -> None:
        """Special characters are removed from the slug; spaces become hyphens."""
        pipeline.ingest_text("# Hello, World! 2026\n\nContent.", title="Hello, World! 2026")
        doc_kwargs = mock_client.insert_document.call_args[0][0]
        assert doc_kwargs["source_path"] == "hello-world-2026.md"

    def test_explicit_source_path_is_not_overridden(self, pipeline, mock_client) -> None:
        """When source_path is provided explicitly, it must not be replaced with a slug."""
        pipeline.ingest_text("# T\n\nB.", title="T", source_path="custom/path.md")
        doc_kwargs = mock_client.insert_document.call_args[0][0]
        assert doc_kwargs["source_path"] == "custom/path.md"


# ── M2M project_ids ───────────────────────────────────────────────────────────


class TestProjectIdsM2M:
    def test_project_ids_list_assigned_via_junction(self, pipeline, mock_client) -> None:
        """project_ids list should be passed to assign_document_projects."""
        pipeline.ingest_text("# T\n\nB.", title="T", project_ids=["pid-1", "pid-2"])
        mock_client.assign_document_projects.assert_called_once_with(
            "doc-001", ["pid-1", "pid-2"]
        )
        mock_client.get_or_create_project.assert_not_called()

    def test_single_project_id_converted_to_list(self, pipeline, mock_client) -> None:
        """project_id (singular) should be wrapped in a list."""
        pipeline.ingest_text("# T\n\nB.", title="T", project_id="single-pid")
        mock_client.assign_document_projects.assert_called_once_with("doc-001", ["single-pid"])

    def test_project_ids_takes_precedence_over_project_id(self, pipeline, mock_client) -> None:
        """project_ids wins when both project_ids and project_id are provided."""
        pipeline.ingest_text(
            "# T\n\nB.", title="T",
            project_ids=["pid-a", "pid-b"],
            project_id="ignored",
        )
        mock_client.assign_document_projects.assert_called_once_with(
            "doc-001", ["pid-a", "pid-b"]
        )

    def test_project_ids_takes_precedence_over_project_name(self, pipeline, mock_client) -> None:
        """project_ids wins when both project_ids and project_name are provided."""
        pipeline.ingest_text(
            "# T\n\nB.", title="T",
            project_ids=["pid-a"],
            project_name="would-create-project",
        )
        mock_client.get_or_create_project.assert_not_called()
        mock_client.assign_document_projects.assert_called_once_with("doc-001", ["pid-a"])

    def test_empty_strings_stripped_from_project_ids(self, pipeline, mock_client) -> None:
        """Empty string values from multi-select should be ignored."""
        pipeline.ingest_text("# T\n\nB.", title="T", project_ids=["", "pid-1", ""])
        mock_client.assign_document_projects.assert_called_once_with("doc-001", ["pid-1"])

    def test_result_project_ids_matches_assigned(self, pipeline, mock_client) -> None:
        result = pipeline.ingest_text("# T\n\nB.", title="T", project_ids=["pid-x", "pid-y"])
        assert result.project_ids == ["pid-x", "pid-y"]

    def test_no_project_ids_result_is_empty_list(self, pipeline, mock_client) -> None:
        result = pipeline.ingest_text("# T\n\nB.", title="T")
        assert result.project_ids == []


# ── Deduplication ─────────────────────────────────────────────────────────────


class TestDeduplication:
    def test_existing_hash_returns_skipped(self, pipeline, mock_client) -> None:
        existing = {
            "id": "doc-existing",
            "title": "Already Here",
            "chunk_count": 5,
            "total_chars": 200,
        }
        mock_client.get_document_by_hash.return_value = existing
        mock_client.get_document_project_ids.return_value = ["proj-abc"]
        result = pipeline.ingest_text("# Already Here\n\nSome text.", title="Already Here")
        assert result.action == "skipped"
        assert result.skipped is True  # back-compat property
        assert result.document_id == "doc-existing"
        assert result.project_ids == ["proj-abc"]

    def test_skipped_result_does_not_insert(self, pipeline, mock_client) -> None:
        mock_client.get_document_by_hash.return_value = {
            "id": "old-id", "title": "Old", "chunk_count": 1, "total_chars": 10,
        }
        pipeline.ingest_text("Duplicate content.", title="Old")
        mock_client.insert_document.assert_not_called()
        mock_client.insert_chunks.assert_not_called()

    def test_different_content_not_deduplicated(self, pipeline, mock_client) -> None:
        mock_client.get_document_by_hash.return_value = None
        result = pipeline.ingest_text("# New Content\n\nUnique.", title="New")
        assert not result.skipped
        mock_client.insert_document.assert_called_once()


# ── ingest_file ───────────────────────────────────────────────────────────────


class TestIngestFile:
    def test_reads_file_and_ingests(self, pipeline, mock_client, tmp_path) -> None:
        md_file = tmp_path / "note.md"
        md_file.write_text("# File Note\n\nContent from file.", encoding="utf-8")
        result = pipeline.ingest_file(str(md_file))
        assert result.title == "note"  # stem of filename
        mock_client.insert_document.assert_called_once()
        doc_kwargs = mock_client.insert_document.call_args[0][0]
        assert doc_kwargs["source"] == "file"
        assert "note.md" in doc_kwargs["source_path"]

    def test_custom_title_overrides_stem(self, pipeline, mock_client, tmp_path) -> None:
        md_file = tmp_path / "untitled.md"
        md_file.write_text("# Hello\n\nWorld.", encoding="utf-8")
        pipeline.ingest_file(str(md_file), title="My Custom Title")
        doc_kwargs = mock_client.insert_document.call_args[0][0]
        assert doc_kwargs["title"] == "My Custom Title"


# ── Metadata validation ────────────────────────────────────────────────────────


class TestMetadataPassthrough:
    """Metadata is open-ended JSONB — no validation, no registry check."""

    def test_any_metadata_passes_through(self, pipeline, mock_client) -> None:
        pipeline.ingest_text(
            "# T\n\nB.", title="T", metadata={"anything": "goes", "custom": 42}
        )
        doc_kwargs = mock_client.insert_document.call_args[0][0]
        assert doc_kwargs["metadata"] == {"anything": "goes", "custom": 42}

    def test_no_metadata_defaults_to_empty(self, pipeline, mock_client) -> None:
        pipeline.ingest_text("# T\n\nB.", title="T")
        doc_kwargs = mock_client.insert_document.call_args[0][0]
        assert doc_kwargs["metadata"] == {}


# ── ingest_text: project_id kwarg (legacy) ────────────────────────────────────


class TestIngestTextProjectId:
    def test_project_id_direct_uses_junction_table(self, pipeline, mock_client) -> None:
        """Passing project_id UUID directly should bypass get_or_create_project."""
        pipeline.ingest_text("# T\n\nB.", title="T", project_id="uuid-from-ui")
        mock_client.get_or_create_project.assert_not_called()
        mock_client.assign_document_projects.assert_called_once_with(
            "doc-001", ["uuid-from-ui"]
        )

    def test_project_id_takes_precedence_over_name(self, pipeline, mock_client) -> None:
        """project_id wins when both are provided."""
        pipeline.ingest_text("# T\n\nB.", title="T", project_name="work", project_id="direct-id")
        mock_client.get_or_create_project.assert_not_called()
        mock_client.assign_document_projects.assert_called_once_with("doc-001", ["direct-id"])


# ── update_document ────────────────────────────────────────────────────────────


class TestUpdateDocument:
    @pytest.fixture()
    def existing_doc(self) -> dict:
        return {
            "id": "doc-001",
            "title": "Original Title",
            "content_hash": "oldhash",
            "metadata": {"topic": "test"},
            "chunk_count": 2,
            "total_chars": 100,
        }

    def test_happy_path_updates_and_reindexes(
        self, pipeline, mock_client, mock_embedder, existing_doc
    ) -> None:
        mock_client.get_document_by_id.return_value = existing_doc
        mock_client.get_document_by_hash.return_value = None  # no collision
        mock_client.update_document.return_value = {**existing_doc, "title": "New Title"}
        mock_client.get_document_project_ids.return_value = []
        mock_client.snapshot_version.return_value = {
            "version_id": "ver-001", "version_number": 1, "chunk_count": 2, "total_chars": 100
        }
        mock_embedder.embed_batch.return_value = [[0.1] * 768]

        result = pipeline.update_document("doc-001", "# New Title\n\nNew body.", "New Title")

        assert result.document_id == "doc-001"
        assert result.title == "New Title"
        assert result.action == "updated"
        assert result.reindexed is True
        assert not result.skipped  # back-compat property
        # snapshot_version archives current chunks; delete_chunks_for_document is NOT called
        mock_client.snapshot_version.assert_called_once_with(
            "doc-001", source="manual", retention_hours=48, cleanup_enabled=True
        )
        mock_client.delete_chunks_for_document.assert_not_called()
        # update_document is called twice: once for content, once for review_status
        assert mock_client.update_document.call_count == 2
        mock_client.insert_chunks.assert_called_once()

    def test_unchanged_content_action_is_updated_not_reindexed(
        self, pipeline, mock_client, existing_doc
    ) -> None:
        """Title-only edit: action='updated', reindexed=False."""
        text = "Same content."
        existing_doc["content_hash"] = _hash(text)
        mock_client.get_document_by_id.return_value = existing_doc
        mock_client.update_document.return_value = existing_doc
        mock_client.get_document_project_ids.return_value = []
        mock_client.list_chunks_for_document.return_value = [{"id": "c1"}]

        result = pipeline.update_document("doc-001", text, "New Title")

        assert result.action == "updated"
        assert result.reindexed is False
        mock_client.delete_chunks_for_document.assert_not_called()
        mock_client.insert_chunks.assert_not_called()

    def test_raises_when_document_not_found(self, pipeline, mock_client) -> None:
        mock_client.get_document_by_id.return_value = None
        with pytest.raises(ValueError, match="not found"):
            pipeline.update_document("missing-id", "Content.", "Title")

    def test_raises_on_hash_collision_with_different_doc(
        self, pipeline, mock_client, existing_doc
    ) -> None:
        mock_client.get_document_by_id.return_value = existing_doc
        mock_client.get_document_by_hash.return_value = {
            "id": "other-doc", "title": "Other Doc"
        }
        with pytest.raises(ValueError, match="already exists"):
            pipeline.update_document("doc-001", "Identical content.", "Title")

    def test_same_doc_hash_collision_is_allowed(
        self, pipeline, mock_client, mock_embedder, existing_doc
    ) -> None:
        """Re-saving identical content to the same document should succeed."""
        mock_client.get_document_by_id.return_value = existing_doc
        mock_client.get_document_by_hash.return_value = existing_doc
        mock_client.update_document.return_value = existing_doc
        mock_client.get_document_project_ids.return_value = []
        mock_embedder.embed_batch.return_value = [[0.0] * 768]

        result = pipeline.update_document("doc-001", "Same content.", "Original Title")
        assert result.document_id == "doc-001"

    def test_project_ids_none_preserves_existing_assignments(
        self, pipeline, mock_client, mock_embedder, existing_doc
    ) -> None:
        """Not passing project_ids should leave existing project associations unchanged."""
        mock_client.get_document_by_id.return_value = existing_doc
        mock_client.get_document_by_hash.return_value = None
        mock_client.update_document.return_value = existing_doc
        mock_client.get_document_project_ids.return_value = ["proj-abc"]
        mock_embedder.embed_batch.return_value = [[0.0] * 768]

        result = pipeline.update_document("doc-001", "# T\n\nBody.", "T")

        # assign_document_projects should NOT be called — no new assignment
        mock_client.assign_document_projects.assert_not_called()
        # The result should reflect the current (unchanged) project list
        assert result.project_ids == ["proj-abc"]

    def test_project_ids_empty_list_removes_all_assignments(
        self, pipeline, mock_client, mock_embedder, existing_doc
    ) -> None:
        """Passing project_ids=[] should remove the document from all projects."""
        mock_client.get_document_by_id.return_value = existing_doc
        mock_client.get_document_by_hash.return_value = None
        mock_client.update_document.return_value = existing_doc
        mock_embedder.embed_batch.return_value = [[0.0] * 768]

        result = pipeline.update_document("doc-001", "# T\n\nBody.", "T", project_ids=[])

        mock_client.assign_document_projects.assert_called_once_with("doc-001", [])
        assert result.project_ids == []

    def test_update_with_project_ids_list(
        self, pipeline, mock_client, mock_embedder, existing_doc
    ) -> None:
        mock_client.get_document_by_id.return_value = existing_doc
        mock_client.get_document_by_hash.return_value = None
        mock_client.update_document.return_value = existing_doc
        mock_embedder.embed_batch.return_value = [[0.0] * 768]

        result = pipeline.update_document(
            "doc-001", "# T\n\nBody.", "T", project_ids=["pid-1", "pid-2"]
        )
        mock_client.assign_document_projects.assert_called_once_with(
            "doc-001", ["pid-1", "pid-2"]
        )
        assert result.project_ids == ["pid-1", "pid-2"]

    def test_embeddings_computed_before_db_changes(
        self, pipeline, mock_client, mock_embedder, existing_doc
    ) -> None:
        """Embed first so a model failure doesn't corrupt the DB state."""
        mock_client.get_document_by_id.return_value = existing_doc
        mock_client.get_document_by_hash.return_value = None
        mock_embedder.embed_batch.side_effect = RuntimeError("GPU OOM")

        with pytest.raises(RuntimeError, match="GPU OOM"):
            pipeline.update_document("doc-001", "# T\n\nBody.", "T")

        # DB should NOT have been touched (embed happens before any DB write)
        mock_client.snapshot_version.assert_not_called()
        mock_client.update_document.assert_not_called()


# ── Client: metadata key methods ──────────────────────────────────────────────


class TestClientMetadataKeys:
    """Unit tests for CerefoxClient.list_metadata_keys (data-driven RPC)."""

    @pytest.fixture()
    def client_with_rpc(self) -> MagicMock:
        """Client mock where rpc() is the single point of control."""
        from cerefox.db.client import CerefoxClient
        from cerefox.config import Settings

        client = CerefoxClient.__new__(CerefoxClient)
        with patch.dict("os.environ", {"CEREFOX_EMBEDDER": "openai", "OPENAI_API_KEY": "test-key"}, clear=False):
            client._settings = Settings(
                supabase_url="http://fake", supabase_key="fake",
                database_url="",
            )
        client._client = None
        client.rpc = MagicMock()
        return client

    def test_list_metadata_keys_calls_rpc(self, client_with_rpc) -> None:
        client_with_rpc.rpc.return_value = [
            {"key": "author", "doc_count": 5, "example_values": ["Alice", "Bob"]},
        ]
        result = client_with_rpc.list_metadata_keys()
        client_with_rpc.rpc.assert_called_once_with("cerefox_list_metadata_keys", {})
        assert result == [
            {"key": "author", "doc_count": 5, "example_values": ["Alice", "Bob"]},
        ]

    def test_list_metadata_keys_empty(self, client_with_rpc) -> None:
        client_with_rpc.rpc.return_value = []
        result = client_with_rpc.list_metadata_keys()
        assert result == []


# ── Client: M2M project assignment ────────────────────────────────────────────


class TestClientProjectAssignment:
    """Unit tests for CerefoxClient M2M project methods."""

    @pytest.fixture()
    def supabase_client(self) -> MagicMock:
        """A mock of the raw supabase Client object."""
        sc = MagicMock()
        # Chain: table().select().eq().execute() → data
        table_mock = MagicMock()
        sc.table.return_value = table_mock
        table_mock.select.return_value = table_mock
        table_mock.eq.return_value = table_mock
        table_mock.delete.return_value = table_mock
        table_mock.insert.return_value = table_mock
        table_mock.execute.return_value = MagicMock(data=[])
        return sc

    @pytest.fixture()
    def cerefox_client(self, supabase_client) -> "CerefoxClient":
        from cerefox.db.client import CerefoxClient

        c = CerefoxClient.__new__(CerefoxClient)
        c._settings = MagicMock()
        c._client = supabase_client
        return c

    def test_get_document_project_ids_returns_ids(self, cerefox_client, supabase_client) -> None:
        supabase_client.table.return_value.select.return_value\
            .eq.return_value.execute.return_value = MagicMock(
                data=[{"project_id": "pid-1"}, {"project_id": "pid-2"}]
            )
        result = cerefox_client.get_document_project_ids("doc-001")
        assert result == ["pid-1", "pid-2"]

    def test_get_document_project_ids_empty(self, cerefox_client, supabase_client) -> None:
        supabase_client.table.return_value.select.return_value\
            .eq.return_value.execute.return_value = MagicMock(data=[])
        result = cerefox_client.get_document_project_ids("doc-001")
        assert result == []

    def test_assign_document_projects_inserts_rows(
        self, cerefox_client, supabase_client
    ) -> None:
        table_mock = MagicMock()
        table_mock.delete.return_value = table_mock
        table_mock.insert.return_value = table_mock
        table_mock.eq.return_value = table_mock
        table_mock.execute.return_value = MagicMock(data=[])
        supabase_client.table.return_value = table_mock

        cerefox_client.assign_document_projects("doc-001", ["pid-a", "pid-b"])

        # Should delete then insert
        table_mock.delete.assert_called_once()
        table_mock.insert.assert_called_once()
        inserted = table_mock.insert.call_args[0][0]
        assert len(inserted) == 2
        assert {"document_id": "doc-001", "project_id": "pid-a"} in inserted

    def test_assign_document_projects_empty_list_only_deletes(
        self, cerefox_client, supabase_client
    ) -> None:
        table_mock = MagicMock()
        table_mock.delete.return_value = table_mock
        table_mock.eq.return_value = table_mock
        table_mock.execute.return_value = MagicMock(data=[])
        supabase_client.table.return_value = table_mock

        cerefox_client.assign_document_projects("doc-001", [])

        table_mock.delete.assert_called_once()
        table_mock.insert.assert_not_called()


# ── update_existing flag ───────────────────────────────────────────────────────


class TestUpdateExisting:
    """update_existing=True should route to update_document when a match is found,
    and fall through to normal creation when no match exists."""

    @pytest.fixture()
    def existing_doc(self) -> dict:
        return {
            "id": "doc-existing",
            "title": "My Note",
            "content_hash": "oldhash",
            "chunk_count": 2,
            "total_chars": 100,
            "metadata": {},
        }

    def test_source_path_match_calls_update(
        self, pipeline, mock_client, mock_embedder, existing_doc
    ) -> None:
        mock_client.find_document_by_source_path.return_value = existing_doc
        mock_client.get_document_by_id.return_value = existing_doc
        mock_client.get_document_by_hash.return_value = None
        mock_client.update_document.return_value = existing_doc
        mock_client.get_document_project_ids.return_value = []
        mock_embedder.embed_batch.return_value = [[0.0] * 768]

        result = pipeline.ingest_text(
            "# My Note\n\nUpdated content.",
            title="My Note",
            source_path="my-note.md",
            update_existing=True,
        )

        assert result.document_id == "doc-existing"
        mock_client.find_document_by_source_path.assert_called_once_with("my-note.md")
        mock_client.insert_document.assert_not_called()

    def test_title_fallback_when_source_path_unset(
        self, pipeline, mock_client, mock_embedder, existing_doc
    ) -> None:
        mock_client.find_document_by_title.return_value = existing_doc
        mock_client.get_document_by_id.return_value = existing_doc
        mock_client.get_document_by_hash.return_value = None
        mock_client.update_document.return_value = existing_doc
        mock_client.get_document_project_ids.return_value = []
        mock_embedder.embed_batch.return_value = [[0.0] * 768]

        result = pipeline.ingest_text(
            "# My Note\n\nNew body.",
            title="My Note",
            update_existing=True,
            # no source_path — should fall back to title lookup
        )

        assert result.document_id == "doc-existing"
        mock_client.find_document_by_title.assert_called_once_with("My Note")
        mock_client.insert_document.assert_not_called()

    def test_title_fallback_when_source_path_misses(
        self, pipeline, mock_client, mock_embedder, existing_doc
    ) -> None:
        """Even when source_path is provided but yields no match, title is tried."""
        mock_client.find_document_by_source_path.return_value = None
        mock_client.find_document_by_title.return_value = existing_doc
        mock_client.get_document_by_id.return_value = existing_doc
        mock_client.get_document_by_hash.return_value = None
        mock_client.update_document.return_value = existing_doc
        mock_client.get_document_project_ids.return_value = []
        mock_embedder.embed_batch.return_value = [[0.0] * 768]

        result = pipeline.ingest_text(
            "# My Note\n\nBody.",
            title="My Note",
            source_path="new-name.md",
            update_existing=True,
        )

        mock_client.find_document_by_source_path.assert_called_once()
        mock_client.find_document_by_title.assert_called_once()
        assert result.document_id == "doc-existing"

    def test_no_match_creates_new_document(
        self, pipeline, mock_client, mock_embedder
    ) -> None:
        mock_client.find_document_by_source_path.return_value = None
        mock_client.find_document_by_title.return_value = None
        mock_client.insert_document.return_value = {"id": "doc-new", "title": "Fresh"}

        result = pipeline.ingest_text(
            "# Fresh\n\nContent.",
            title="Fresh",
            source_path="fresh.md",
            update_existing=True,
        )

        mock_client.insert_document.assert_called_once()
        assert result.document_id == "doc-new"

    def test_no_match_fallthrough_action_is_created(
        self, pipeline, mock_client
    ) -> None:
        """update_existing=True with no match falls through to create — action must be 'created',
        not 'updated', so callers know a new document was created rather than an existing one found."""
        mock_client.find_document_by_source_path.return_value = None
        mock_client.find_document_by_title.return_value = None
        mock_client.insert_document.return_value = {"id": "doc-new", "title": "T"}

        result = pipeline.ingest_text("# T\n\nB.", title="T", update_existing=True)

        assert result.action == "created"

    def test_update_existing_false_skips_lookup(self, pipeline, mock_client) -> None:
        """When update_existing is False (default), no lookup should happen."""
        pipeline.ingest_text("# T\n\nB.", title="T")
        mock_client.find_document_by_source_path.assert_not_called()
        mock_client.find_document_by_title.assert_not_called()

    def test_ingest_file_update_existing_passes_through(
        self, pipeline, mock_client, mock_embedder, tmp_path, existing_doc
    ) -> None:
        md_file = tmp_path / "my-note.md"
        md_file.write_text("# My Note\n\nFile content.", encoding="utf-8")
        mock_client.find_document_by_source_path.return_value = existing_doc
        mock_client.get_document_by_id.return_value = existing_doc
        mock_client.get_document_by_hash.return_value = None
        mock_client.update_document.return_value = existing_doc
        mock_client.get_document_project_ids.return_value = []
        mock_embedder.embed_batch.return_value = [[0.0] * 768]

        result = pipeline.ingest_file(str(md_file), update_existing=True)

        assert result.document_id == "doc-existing"
        mock_client.insert_document.assert_not_called()
