"""Tests for cerefox.cli — Click command-line interface.

Uses Click's CliRunner so no real Supabase connection is needed.
Embedder and pipeline are mocked.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner

from cerefox.cli import cli
from cerefox.ingestion.pipeline import IngestResult


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture()
def runner() -> CliRunner:
    return CliRunner()


def _make_pipeline_mock(result: IngestResult | None = None) -> MagicMock:
    """Return a mock IngestionPipeline that returns a preset IngestResult."""
    mock = MagicMock()
    default_result = result or IngestResult(
        document_id="doc-abc",
        title="Test Note",
        chunk_count=3,
        total_chars=500,
        action="created",
    )
    mock.ingest_text.return_value = default_result
    mock.ingest_file.return_value = default_result
    return mock


def _make_client_mock() -> MagicMock:
    client = MagicMock()
    client.list_documents.return_value = [
        {"id": "doc-1", "title": "Alpha", "chunk_count": 2, "total_chars": 300},
        {"id": "doc-2", "title": "Beta", "chunk_count": 1, "total_chars": 150},
    ]
    client.list_projects.return_value = [
        {"id": "proj-1", "name": "Personal"},
        {"id": "proj-2", "name": "Work"},
    ]
    client.list_all_documents_basic.return_value = [
        {"id": "doc-1", "title": "Alpha"},
        {"id": "doc-2", "title": "Beta"},
    ]
    return client


# ── ingest (paste mode) ───────────────────────────────────────────────────────


class TestIngestPaste:
    def test_paste_requires_title(self, runner) -> None:
        result = runner.invoke(cli, ["ingest", "--paste"])
        assert result.exit_code != 0
        assert "--title" in result.output

    def test_paste_ingests_stdin(self, runner, tmp_path) -> None:
        pipeline_mock = _make_pipeline_mock()
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=MagicMock()),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
            patch("cerefox.ingestion.pipeline.IngestionPipeline", return_value=pipeline_mock),
        ):
            result = runner.invoke(
                cli,
                ["ingest", "--paste", "--title", "My Thought"],
                input="# My Thought\n\nSome content.",
            )
        assert result.exit_code == 0
        assert "Ingested" in result.output

    def test_paste_shows_skipped_message(self, runner) -> None:
        skipped = IngestResult("old-id", "Old", 2, 100, action="skipped")
        pipeline_mock = _make_pipeline_mock(result=skipped)
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=MagicMock()),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
            patch("cerefox.ingestion.pipeline.IngestionPipeline", return_value=pipeline_mock),
        ):
            result = runner.invoke(
                cli,
                ["ingest", "--paste", "--title", "Old"],
                input="Duplicate content.",
            )
        assert result.exit_code == 0
        assert "Skipped" in result.output


# ── ingest (file mode) ────────────────────────────────────────────────────────


class TestIngestFile:
    def test_file_ingestion(self, runner, tmp_path) -> None:
        md_file = tmp_path / "note.md"
        md_file.write_text("# Note\n\nContent.", encoding="utf-8")

        pipeline_mock = _make_pipeline_mock()
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=MagicMock()),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
            patch("cerefox.ingestion.pipeline.IngestionPipeline", return_value=pipeline_mock),
        ):
            result = runner.invoke(cli, ["ingest", str(md_file)])
        assert result.exit_code == 0
        assert "Ingested" in result.output

    def test_nonexistent_file_fails(self, runner) -> None:
        result = runner.invoke(cli, ["ingest", "/nonexistent/file.md"])
        assert result.exit_code != 0

    def test_no_path_and_no_paste_fails(self, runner) -> None:
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=MagicMock()),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
        ):
            result = runner.invoke(cli, ["ingest"])
        assert result.exit_code != 0

    def test_invalid_metadata_json_fails(self, runner, tmp_path) -> None:
        md_file = tmp_path / "note.md"
        md_file.write_text("# T\n\nB.", encoding="utf-8")
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=MagicMock()),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
        ):
            result = runner.invoke(cli, ["ingest", str(md_file), "--metadata", "not-json"])
        assert result.exit_code != 0
        assert "JSON" in result.output


# ── list-docs ─────────────────────────────────────────────────────────────────


class TestListDocs:
    def test_shows_document_list(self, runner) -> None:
        client_mock = _make_client_mock()
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(cli, ["list-docs"])
        assert result.exit_code == 0
        assert "Alpha" in result.output
        assert "Beta" in result.output

    def test_empty_list_shows_message(self, runner) -> None:
        client_mock = MagicMock()
        client_mock.list_documents.return_value = []
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(cli, ["list-docs"])
        assert result.exit_code == 0
        assert "No documents" in result.output


# ── delete-doc ────────────────────────────────────────────────────────────────


class TestDeleteDoc:
    def test_delete_with_yes_flag(self, runner) -> None:
        client_mock = _make_client_mock()
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(cli, ["delete-doc", "doc-1", "--yes"])
        assert result.exit_code == 0
        assert "Deleted" in result.output
        client_mock.delete_document.assert_called_once_with("doc-1")

    def test_delete_aborted_on_no(self, runner) -> None:
        client_mock = _make_client_mock()
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(cli, ["delete-doc", "doc-1"], input="n\n")
        # Aborted — delete should not be called
        client_mock.delete_document.assert_not_called()


# ── list-projects ─────────────────────────────────────────────────────────────


class TestListProjects:
    def test_shows_projects(self, runner) -> None:
        client_mock = _make_client_mock()
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(cli, ["list-projects"])
        assert result.exit_code == 0
        assert "Personal" in result.output
        assert "Work" in result.output

    def test_empty_projects_shows_message(self, runner) -> None:
        client_mock = MagicMock()
        client_mock.list_projects.return_value = []
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(cli, ["list-projects"])
        assert result.exit_code == 0
        assert "No projects" in result.output


# ── ingest --update flag ──────────────────────────────────────────────────────


class TestIngestUpdate:
    """--update flag should pass update_existing=True to the pipeline and
    display an 'Updated' confirmation when content was re-indexed."""

    def test_update_flag_passes_update_existing_to_pipeline(self, runner, tmp_path) -> None:
        md_file = tmp_path / "note.md"
        md_file.write_text("# Note\n\nContent.", encoding="utf-8")
        updated_result = IngestResult(
            document_id="doc-abc", title="Note",
            chunk_count=1, total_chars=100,
            action="updated", reindexed=True,
        )
        pipeline_mock = _make_pipeline_mock(updated_result)
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=_make_client_mock()),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
            patch("cerefox.ingestion.pipeline.IngestionPipeline", return_value=pipeline_mock),
        ):
            result = runner.invoke(cli, ["ingest", str(md_file), "--update"])
        assert result.exit_code == 0
        pipeline_mock.ingest_file.assert_called_once()
        call_kwargs = pipeline_mock.ingest_file.call_args[1]
        assert call_kwargs.get("update_existing") is True

    def test_update_reindexed_shows_updated_message(self, runner, tmp_path) -> None:
        md_file = tmp_path / "note.md"
        md_file.write_text("# Note\n\nContent.", encoding="utf-8")
        updated_result = IngestResult(
            document_id="doc-abc", title="Note",
            chunk_count=1, total_chars=100,
            action="updated", reindexed=True,
        )
        pipeline_mock = _make_pipeline_mock(updated_result)
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=_make_client_mock()),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
            patch("cerefox.ingestion.pipeline.IngestionPipeline", return_value=pipeline_mock),
        ):
            result = runner.invoke(cli, ["ingest", str(md_file), "--update"])
        assert result.exit_code == 0
        assert "Updated" in result.output

    def test_ingest_without_update_flag_does_not_set_flag(self, runner, tmp_path) -> None:
        md_file = tmp_path / "note.md"
        md_file.write_text("# Note\n\nContent.", encoding="utf-8")
        pipeline_mock = _make_pipeline_mock()
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=_make_client_mock()),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
            patch("cerefox.ingestion.pipeline.IngestionPipeline", return_value=pipeline_mock),
        ):
            runner.invoke(cli, ["ingest", str(md_file)])
        call_kwargs = pipeline_mock.ingest_file.call_args[1]
        assert not call_kwargs.get("update_existing", False)


# ── ingest-dir ────────────────────────────────────────────────────────────────


class TestIngestDir:
    def test_ingests_matching_files(self, runner, tmp_path) -> None:
        (tmp_path / "a.md").write_text("# A\n\nContent A.", encoding="utf-8")
        (tmp_path / "b.md").write_text("# B\n\nContent B.", encoding="utf-8")
        pipeline_mock = _make_pipeline_mock()
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=_make_client_mock()),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
            patch("cerefox.ingestion.pipeline.IngestionPipeline", return_value=pipeline_mock),
        ):
            result = runner.invoke(cli, ["ingest-dir", str(tmp_path)])
        assert result.exit_code == 0
        assert pipeline_mock.ingest_file.call_count == 2

    def test_dry_run_does_not_ingest(self, runner, tmp_path) -> None:
        (tmp_path / "note.md").write_text("# Note\n\nBody.", encoding="utf-8")
        pipeline_mock = _make_pipeline_mock()
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=_make_client_mock()),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
            patch("cerefox.ingestion.pipeline.IngestionPipeline", return_value=pipeline_mock),
        ):
            result = runner.invoke(cli, ["ingest-dir", str(tmp_path), "--dry-run"])
        assert result.exit_code == 0
        pipeline_mock.ingest_file.assert_not_called()

    def test_no_matching_files_exits_cleanly(self, runner, tmp_path) -> None:
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=_make_client_mock()),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
        ):
            result = runner.invoke(cli, ["ingest-dir", str(tmp_path)])
        assert result.exit_code == 0
        assert "No files" in result.output


# ── reindex ───────────────────────────────────────────────────────────────────


class TestReindex:
    def _make_chunk(self, chunk_id: str, embedder: str = "old-model", doc_id: str = "doc-1") -> dict:
        return {"id": chunk_id, "content": "Some text.", "embedder_primary": embedder, "document_id": doc_id}

    def test_nothing_to_reindex_when_all_current(self, runner) -> None:
        client_mock = _make_client_mock()
        client_mock.list_all_chunks.return_value = []
        embedder_mock = MagicMock()
        embedder_mock.model_name = "text-embedding-3-small"
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=client_mock),
            patch("cerefox.cli._get_embedder", return_value=embedder_mock),
        ):
            result = runner.invoke(cli, ["reindex"])
        assert result.exit_code == 0
        assert "Nothing to reindex" in result.output

    def test_reindexes_stale_chunks(self, runner) -> None:
        client_mock = _make_client_mock()
        client_mock.list_all_chunks.return_value = [
            self._make_chunk("c-1"), self._make_chunk("c-2"),
        ]
        embedder_mock = MagicMock()
        embedder_mock.model_name = "text-embedding-3-small"
        embedder_mock.embed_batch.return_value = [[0.1] * 768, [0.2] * 768]
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=client_mock),
            patch("cerefox.cli._get_embedder", return_value=embedder_mock),
        ):
            result = runner.invoke(cli, ["reindex"])
        assert result.exit_code == 0
        assert client_mock.update_chunk_embedding.call_count == 2

    def test_reindex_all_flag_passes_none_skip_model(self, runner) -> None:
        client_mock = _make_client_mock()
        client_mock.list_all_chunks.return_value = []
        embedder_mock = MagicMock()
        embedder_mock.model_name = "text-embedding-3-small"
        with (
            patch("cerefox.cli.Settings"),
            patch("cerefox.cli._get_client", return_value=client_mock),
            patch("cerefox.cli._get_embedder", return_value=embedder_mock),
        ):
            runner.invoke(cli, ["reindex", "--all"])
        client_mock.list_all_chunks.assert_called_once_with(embedder_not=None)


# ── caller-identity flags (--author, --author-type, --requestor) ──────────────
# Tests for cerefox#28. See also docs/guides/setup-supabase.md for the principle
# being amended (per the Q2 2026 Decision Log entry).


def _patched_settings_default():
    """Settings instance with built-in CLI identity defaults (no env overrides)."""
    from cerefox.config import Settings  # noqa: PLC0415
    # Construct without reading .env so test environment doesn't leak in.
    return Settings(
        _env_file=None,
        cli_author_name="unknown",
        cli_author_type="user",
        cli_requestor_name="user",
    )


class TestIngestCallerIdentityFlags:
    """Writes: --author and --author-type plumbed through to the pipeline."""

    def _run_paste(self, runner, extra_args: list[str], pipeline_mock: MagicMock):
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=MagicMock()),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
            patch("cerefox.ingestion.pipeline.IngestionPipeline", return_value=pipeline_mock),
        ):
            return runner.invoke(
                cli,
                ["ingest", "--paste", "--title", "T", *extra_args],
                input="# T\n\nBody",
            )

    def test_default_author_is_unknown_user(self, runner) -> None:
        pipeline_mock = _make_pipeline_mock()
        result = self._run_paste(runner, [], pipeline_mock)
        assert result.exit_code == 0
        call_kwargs = pipeline_mock.ingest_text.call_args.kwargs
        assert call_kwargs["author"] == "unknown"
        assert call_kwargs["author_type"] == "user"

    def test_author_flag_plumbed_through(self, runner) -> None:
        pipeline_mock = _make_pipeline_mock()
        result = self._run_paste(runner, ["--author", "alice"], pipeline_mock)
        assert result.exit_code == 0
        call_kwargs = pipeline_mock.ingest_text.call_args.kwargs
        assert call_kwargs["author"] == "alice"
        assert call_kwargs["author_type"] == "user"

    def test_author_type_agent_plumbed_through(self, runner) -> None:
        pipeline_mock = _make_pipeline_mock()
        result = self._run_paste(
            runner, ["--author", "claude-code", "--author-type", "agent"], pipeline_mock
        )
        assert result.exit_code == 0
        call_kwargs = pipeline_mock.ingest_text.call_args.kwargs
        assert call_kwargs["author"] == "claude-code"
        assert call_kwargs["author_type"] == "agent"

    def test_author_type_invalid_value_rejected(self, runner) -> None:
        result = runner.invoke(
            cli, ["ingest", "--paste", "--title", "T", "--author-type", "robot"],
            input="x",
        )
        # Click rejects invalid Choice before reaching the body — exit code != 0.
        assert result.exit_code != 0
        assert "robot" in result.output or "Invalid value" in result.output

    def test_empty_author_rejected(self, runner) -> None:
        pipeline_mock = _make_pipeline_mock()
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=MagicMock()),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
            patch("cerefox.ingestion.pipeline.IngestionPipeline", return_value=pipeline_mock),
        ):
            result = runner.invoke(
                cli, ["ingest", "--paste", "--title", "T", "--author", ""],
                input="x",
            )
        assert result.exit_code != 0
        assert "--author cannot be empty" in result.output
        pipeline_mock.ingest_text.assert_not_called()

    def test_env_var_default_used_when_no_flag(self, runner) -> None:
        from cerefox.config import Settings  # noqa: PLC0415
        env_settings = Settings(
            _env_file=None,
            cli_author_name="claude-code",
            cli_author_type="agent",
            cli_requestor_name="user",
        )
        pipeline_mock = _make_pipeline_mock()
        with (
            patch("cerefox.cli.Settings", return_value=env_settings),
            patch("cerefox.cli._get_client", return_value=MagicMock()),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
            patch("cerefox.ingestion.pipeline.IngestionPipeline", return_value=pipeline_mock),
        ):
            result = runner.invoke(
                cli, ["ingest", "--paste", "--title", "T"], input="x",
            )
        assert result.exit_code == 0
        call_kwargs = pipeline_mock.ingest_text.call_args.kwargs
        assert call_kwargs["author"] == "claude-code"
        assert call_kwargs["author_type"] == "agent"

    def test_cli_flag_overrides_env_var(self, runner) -> None:
        from cerefox.config import Settings  # noqa: PLC0415
        env_settings = Settings(
            _env_file=None,
            cli_author_name="alice",
            cli_author_type="user",
            cli_requestor_name="user",
        )
        pipeline_mock = _make_pipeline_mock()
        with (
            patch("cerefox.cli.Settings", return_value=env_settings),
            patch("cerefox.cli._get_client", return_value=MagicMock()),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
            patch("cerefox.ingestion.pipeline.IngestionPipeline", return_value=pipeline_mock),
        ):
            result = runner.invoke(
                cli, ["ingest", "--paste", "--title", "T", "--author", "bob"],
                input="x",
            )
        assert result.exit_code == 0
        # CLI flag wins; env-var default ignored.
        assert pipeline_mock.ingest_text.call_args.kwargs["author"] == "bob"


class TestIngestDirCallerIdentityFlags:
    """ingest-dir: --author and --author-type apply across the whole run."""

    def test_author_flags_applied_to_every_file(self, runner, tmp_path) -> None:
        (tmp_path / "a.md").write_text("# A\n\nbody", encoding="utf-8")
        (tmp_path / "b.md").write_text("# B\n\nbody", encoding="utf-8")
        pipeline_mock = _make_pipeline_mock()
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=MagicMock()),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
            patch("cerefox.ingestion.pipeline.IngestionPipeline", return_value=pipeline_mock),
        ):
            result = runner.invoke(
                cli, ["ingest-dir", str(tmp_path),
                      "--author", "sync-script", "--author-type", "agent"],
            )
        assert result.exit_code == 0
        # Every ingest_file call should have the same author / author_type.
        assert pipeline_mock.ingest_file.call_count == 2
        for call in pipeline_mock.ingest_file.call_args_list:
            assert call.kwargs["author"] == "sync-script"
            assert call.kwargs["author_type"] == "agent"


class TestReadCommandRequestorFlag:
    """Reads: --requestor plumbed through to the usage log."""

    def _client_with_search(self) -> MagicMock:
        client = MagicMock()
        # SearchClient stub: return an empty result so we exit cleanly past rendering.
        return client

    @staticmethod
    def _make_search_result() -> "object":
        from cerefox.retrieval.search import SearchResult  # noqa: PLC0415
        return SearchResult(
            chunk_id="c-1", document_id="d-1", chunk_index=0,
            title="T", content="x", heading_path=[], heading_level=1,
            score=0.5, doc_title="T", doc_source="paste",
            doc_project_ids=[], doc_project_names=[], doc_metadata={},
        )

    def test_search_requestor_flag_recorded_in_usage_log(self, runner) -> None:
        from cerefox.retrieval.search import SearchResponse  # noqa: PLC0415
        client_mock = MagicMock()
        search_mock = MagicMock()
        search_mock.hybrid.return_value = SearchResponse(
            results=[self._make_search_result()],
            query="q", mode="hybrid",
            total_found=1, response_bytes=10, truncated=False,
        )
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=client_mock),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
            patch("cerefox.retrieval.search.SearchClient", return_value=search_mock),
        ):
            result = runner.invoke(cli, ["search", "q", "--requestor", "claude-code"])
        assert result.exit_code == 0
        # log_usage called with requestor='claude-code'
        assert client_mock.log_usage.called
        call_kwargs = client_mock.log_usage.call_args.kwargs
        assert call_kwargs["requestor"] == "claude-code"
        assert call_kwargs["access_path"] == "cli"
        assert call_kwargs["operation"] == "search"

    def test_search_default_requestor_is_user(self, runner) -> None:
        """Empty results path returns early, so verify with one result + default flags."""
        from cerefox.retrieval.search import SearchResponse  # noqa: PLC0415
        client_mock = MagicMock()
        search_mock = MagicMock()
        search_mock.hybrid.return_value = SearchResponse(
            results=[self._make_search_result()],
            query="q", mode="hybrid",
            total_found=1, response_bytes=10, truncated=False,
        )
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=client_mock),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
            patch("cerefox.retrieval.search.SearchClient", return_value=search_mock),
        ):
            result = runner.invoke(cli, ["search", "anything"])
        assert result.exit_code == 0
        assert client_mock.log_usage.call_args.kwargs["requestor"] == "user"

    def test_get_doc_requestor_recorded(self, runner) -> None:
        client_mock = MagicMock()
        client_mock.get_document_content.return_value = {
            "doc_title": "T", "doc_source": "paste", "chunk_count": 1,
            "total_chars": 10, "full_content": "x",
        }
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(cli, ["get-doc", "doc-1", "--requestor", "alice"])
        assert result.exit_code == 0
        assert client_mock.log_usage.call_args.kwargs["requestor"] == "alice"

    def test_list_versions_requestor_recorded(self, runner) -> None:
        client_mock = MagicMock()
        client_mock.list_document_versions.return_value = [
            {"version_id": "v1", "version_number": 1, "created_at": "2026-01-01",
             "source": "paste", "chunk_count": 1, "total_chars": 10},
        ]
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(cli, ["list-versions", "d-1", "--requestor", "agent-x"])
        assert result.exit_code == 0
        assert client_mock.log_usage.call_args.kwargs["requestor"] == "agent-x"

    def test_list_projects_requestor_recorded(self, runner) -> None:
        client_mock = _make_client_mock()
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(cli, ["list-projects", "--requestor", "scripted"])
        assert result.exit_code == 0
        assert client_mock.log_usage.call_args.kwargs["requestor"] == "scripted"

    def test_metadata_search_requestor_recorded(self, runner) -> None:
        client_mock = _make_client_mock()
        client_mock.metadata_search.return_value = []
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(
                cli, ["metadata-search",
                      "--filter", '{"type":"note"}',
                      "--requestor", "researcher"],
            )
        assert result.exit_code == 0
        assert client_mock.log_usage.call_args.kwargs["requestor"] == "researcher"

    def test_empty_requestor_rejected(self, runner) -> None:
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=MagicMock()),
        ):
            result = runner.invoke(cli, ["list-projects", "--requestor", ""])
        assert result.exit_code != 0
        assert "--requestor cannot be empty" in result.output

    def test_env_var_default_for_requestor(self, runner) -> None:
        from cerefox.config import Settings  # noqa: PLC0415
        env_settings = Settings(
            _env_file=None,
            cli_author_name="unknown", cli_author_type="user",
            cli_requestor_name="claude-code",
        )
        client_mock = _make_client_mock()
        with (
            patch("cerefox.cli.Settings", return_value=env_settings),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(cli, ["list-projects"])
        assert result.exit_code == 0
        assert client_mock.log_usage.call_args.kwargs["requestor"] == "claude-code"


# ── ingest parity flags: --document-id, --source, ingest-dir --metadata (#29) ──


def _ingest_patches(pipeline_mock: MagicMock):
    """Common patches for CLI ingest tests; returns a tuple of context managers."""
    return (
        patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
        patch("cerefox.cli._get_client", return_value=MagicMock()),
        patch("cerefox.cli._get_embedder", return_value=MagicMock()),
        patch("cerefox.ingestion.pipeline.IngestionPipeline", return_value=pipeline_mock),
    )


class TestIngestDocumentIdFlag:
    """ingest --document-id: deterministic ID-based update path."""

    def test_document_id_passed_to_pipeline(self, runner) -> None:
        pipeline_mock = _make_pipeline_mock(
            IngestResult("known-id", "T", 2, 100, action="updated", reindexed=True),
        )
        s, c, e, p = _ingest_patches(pipeline_mock)
        with s, c, e, p:
            result = runner.invoke(
                cli, ["ingest", "--paste", "--title", "T",
                      "--document-id", "known-id"],
                input="updated body",
            )
        assert result.exit_code == 0, result.output
        assert pipeline_mock.ingest_text.call_args.kwargs["document_id"] == "known-id"

    def test_document_id_and_update_mutually_exclusive(self, runner) -> None:
        pipeline_mock = _make_pipeline_mock()
        s, c, e, p = _ingest_patches(pipeline_mock)
        with s, c, e, p:
            result = runner.invoke(
                cli, ["ingest", "--paste", "--title", "T",
                      "--document-id", "x", "--update"],
                input="x",
            )
        assert result.exit_code != 0
        assert "mutually exclusive" in result.output
        pipeline_mock.ingest_text.assert_not_called()

    def test_document_id_not_found_returns_clean_error(self, runner) -> None:
        pipeline_mock = MagicMock()
        pipeline_mock.ingest_text.side_effect = ValueError("Document not found: bogus-id")
        s, c, e, p = _ingest_patches(pipeline_mock)
        with s, c, e, p:
            result = runner.invoke(
                cli, ["ingest", "--paste", "--title", "T", "--document-id", "bogus-id"],
                input="x",
            )
        assert result.exit_code != 0
        assert "Document not found: bogus-id" in result.output

    def test_default_no_document_id(self, runner) -> None:
        pipeline_mock = _make_pipeline_mock()
        s, c, e, p = _ingest_patches(pipeline_mock)
        with s, c, e, p:
            result = runner.invoke(
                cli, ["ingest", "--paste", "--title", "T"], input="x",
            )
        assert result.exit_code == 0
        assert pipeline_mock.ingest_text.call_args.kwargs["document_id"] is None


class TestIngestSourceFlag:
    """ingest --source: override of default 'paste' / 'file' source labels."""

    def test_paste_default_source_is_paste(self, runner) -> None:
        pipeline_mock = _make_pipeline_mock()
        s, c, e, p = _ingest_patches(pipeline_mock)
        with s, c, e, p:
            result = runner.invoke(
                cli, ["ingest", "--paste", "--title", "T"], input="x",
            )
        assert result.exit_code == 0
        assert pipeline_mock.ingest_text.call_args.kwargs["source"] == "paste"

    def test_source_override_paste(self, runner) -> None:
        pipeline_mock = _make_pipeline_mock()
        s, c, e, p = _ingest_patches(pipeline_mock)
        with s, c, e, p:
            result = runner.invoke(
                cli, ["ingest", "--paste", "--title", "T",
                      "--source", "agent"],
                input="x",
            )
        assert result.exit_code == 0
        assert pipeline_mock.ingest_text.call_args.kwargs["source"] == "agent"

    def test_source_override_file(self, runner, tmp_path) -> None:
        md_file = tmp_path / "n.md"
        md_file.write_text("# n\n\nbody", encoding="utf-8")
        pipeline_mock = _make_pipeline_mock()
        s, c, e, p = _ingest_patches(pipeline_mock)
        with s, c, e, p:
            result = runner.invoke(
                cli, ["ingest", str(md_file), "--source", "sync-script"],
            )
        assert result.exit_code == 0
        assert pipeline_mock.ingest_file.call_args.kwargs["source"] == "sync-script"


class TestIngestDirMetadataFlag:
    """ingest-dir --metadata: shared metadata applied to every file in the run."""

    def test_metadata_applied_to_every_file(self, runner, tmp_path) -> None:
        (tmp_path / "a.md").write_text("# A\n\nbody", encoding="utf-8")
        (tmp_path / "b.md").write_text("# B\n\nbody", encoding="utf-8")
        pipeline_mock = _make_pipeline_mock()
        s, c, e, p = _ingest_patches(pipeline_mock)
        with s, c, e, p:
            result = runner.invoke(
                cli, ["ingest-dir", str(tmp_path),
                      "--metadata", '{"type":"research","status":"active"}'],
            )
        assert result.exit_code == 0
        assert pipeline_mock.ingest_file.call_count == 2
        for call in pipeline_mock.ingest_file.call_args_list:
            assert call.kwargs["metadata"] == {"type": "research", "status": "active"}

    def test_invalid_metadata_json_rejected(self, runner, tmp_path) -> None:
        (tmp_path / "a.md").write_text("# A\n\nbody", encoding="utf-8")
        result = runner.invoke(
            cli, ["ingest-dir", str(tmp_path), "--metadata", "not-json"],
        )
        assert result.exit_code != 0
        assert "JSON" in result.output

    def test_metadata_non_object_rejected(self, runner, tmp_path) -> None:
        (tmp_path / "a.md").write_text("# A\n\nbody", encoding="utf-8")
        result = runner.invoke(
            cli, ["ingest-dir", str(tmp_path), "--metadata", '["not", "object"]'],
        )
        assert result.exit_code != 0
        assert "JSON object" in result.output

    def test_no_metadata_flag_preserves_default(self, runner, tmp_path) -> None:
        """When --metadata is not passed, metadata={} is forwarded (back-compat)."""
        (tmp_path / "a.md").write_text("# A\n\nbody", encoding="utf-8")
        pipeline_mock = _make_pipeline_mock()
        s, c, e, p = _ingest_patches(pipeline_mock)
        with s, c, e, p:
            result = runner.invoke(cli, ["ingest-dir", str(tmp_path)])
        assert result.exit_code == 0
        assert pipeline_mock.ingest_file.call_args.kwargs["metadata"] == {}


# ── get-audit-log (#30) ────────────────────────────────────────────────────────


def _make_audit_entries() -> list[dict]:
    return [
        {
            "id": "a1", "document_id": "d1", "version_id": "v1",
            "operation": "create", "author": "alice", "author_type": "user",
            "size_before": None, "size_after": 500, "description": "Initial create",
            "created_at": "2026-05-18T12:00:00Z",
        },
        {
            "id": "a2", "document_id": "d1", "version_id": "v2",
            "operation": "update-content", "author": "claude-code", "author_type": "agent",
            "size_before": 500, "size_after": 650, "description": "Refined section 2",
            "created_at": "2026-05-18T13:00:00Z",
        },
    ]


class TestGetAuditLogCommand:
    """cerefox get-audit-log: filters, output formats, usage logging."""

    def test_default_table_output(self, runner) -> None:
        client_mock = MagicMock()
        client_mock.list_audit_entries.return_value = _make_audit_entries()
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(cli, ["get-audit-log"])
        assert result.exit_code == 0
        # Both entries show up with author and operation
        assert "alice (user)" in result.output
        assert "claude-code (agent)" in result.output
        assert "Initial create" in result.output
        assert "2 entries" in result.output

    def test_json_output(self, runner) -> None:
        client_mock = MagicMock()
        client_mock.list_audit_entries.return_value = _make_audit_entries()
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(cli, ["get-audit-log", "--json"])
        assert result.exit_code == 0
        # One JSON object per line — should be parseable
        import json as _json
        lines = [line for line in result.output.strip().split("\n") if line.strip()]
        assert len(lines) == 2
        parsed = [_json.loads(line) for line in lines]
        assert parsed[0]["author"] == "alice"
        assert parsed[1]["operation"] == "update-content"

    def test_empty_result_message(self, runner) -> None:
        client_mock = MagicMock()
        client_mock.list_audit_entries.return_value = []
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(cli, ["get-audit-log"])
        assert result.exit_code == 0
        assert "No audit-log entries" in result.output

    def test_filters_passed_to_client(self, runner) -> None:
        client_mock = MagicMock()
        client_mock.list_audit_entries.return_value = []
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(cli, [
                "get-audit-log",
                "--document-id", "d1",
                "--author", "alice",
                "--operation", "create",
                "--since", "2026-05-01",
                "--until", "2026-05-19",
                "--limit", "10",
            ])
        assert result.exit_code == 0
        call_kwargs = client_mock.list_audit_entries.call_args.kwargs
        assert call_kwargs == {
            "document_id": "d1", "author": "alice", "operation": "create",
            "since": "2026-05-01", "until": "2026-05-19", "limit": 10,
        }

    def test_invalid_operation_rejected(self, runner) -> None:
        client_mock = MagicMock()
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(cli, ["get-audit-log", "--operation", "bogus"])
        assert result.exit_code != 0
        # Click's Choice validation catches it
        client_mock.list_audit_entries.assert_not_called()

    def test_requestor_recorded_in_usage_log(self, runner) -> None:
        client_mock = MagicMock()
        client_mock.list_audit_entries.return_value = _make_audit_entries()
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(
                cli, ["get-audit-log", "--requestor", "researcher"],
            )
        assert result.exit_code == 0
        assert client_mock.log_usage.called
        call_kwargs = client_mock.log_usage.call_args.kwargs
        assert call_kwargs["requestor"] == "researcher"
        assert call_kwargs["operation"] == "get_audit_log"
        assert call_kwargs["access_path"] == "cli"
        assert call_kwargs["result_count"] == 2


# ── MCP-parity flag long forms ────────────────────────────────────────────────
#
# Six flags gained MCP-parity long-form names with the short forms kept as
# aliases. These tests confirm both forms work and bind to the same parameter.


class TestMcpParityFlagAliases:
    """All MCP-parity flag renames preserve the short form as an alias."""

    # ── --project-name / --project / -p ──────────────────────────────────────

    def test_ingest_project_name_long_form(self, runner) -> None:
        pipeline_mock = _make_pipeline_mock()
        s, c, e, p = _ingest_patches(pipeline_mock)
        with s, c, e, p:
            result = runner.invoke(
                cli, ["ingest", "--paste", "--title", "T",
                      "--project-name", "Research"],
                input="x",
            )
        assert result.exit_code == 0, result.output
        assert pipeline_mock.ingest_text.call_args.kwargs["project_name"] == "Research"

    def test_ingest_project_short_alias(self, runner) -> None:
        pipeline_mock = _make_pipeline_mock()
        s, c, e, p = _ingest_patches(pipeline_mock)
        with s, c, e, p:
            result = runner.invoke(
                cli, ["ingest", "--paste", "--title", "T", "--project", "Research"],
                input="x",
            )
        assert result.exit_code == 0
        assert pipeline_mock.ingest_text.call_args.kwargs["project_name"] == "Research"

    def test_ingest_p_short_alias(self, runner) -> None:
        pipeline_mock = _make_pipeline_mock()
        s, c, e, p = _ingest_patches(pipeline_mock)
        with s, c, e, p:
            result = runner.invoke(
                cli, ["ingest", "--paste", "--title", "T", "-p", "Research"],
                input="x",
            )
        assert result.exit_code == 0
        assert pipeline_mock.ingest_text.call_args.kwargs["project_name"] == "Research"

    # ── --update-if-exists / --update ────────────────────────────────────────

    def test_ingest_update_if_exists_long_form(self, runner) -> None:
        pipeline_mock = _make_pipeline_mock(
            IngestResult("d", "T", 1, 50, action="updated", reindexed=True),
        )
        s, c, e, p = _ingest_patches(pipeline_mock)
        with s, c, e, p:
            result = runner.invoke(
                cli, ["ingest", "--paste", "--title", "T", "--update-if-exists"],
                input="x",
            )
        assert result.exit_code == 0
        assert pipeline_mock.ingest_text.call_args.kwargs["update_existing"] is True

    def test_ingest_update_short_alias_still_works(self, runner) -> None:
        pipeline_mock = _make_pipeline_mock(
            IngestResult("d", "T", 1, 50, action="updated", reindexed=True),
        )
        s, c, e, p = _ingest_patches(pipeline_mock)
        with s, c, e, p:
            result = runner.invoke(
                cli, ["ingest", "--paste", "--title", "T", "--update"], input="x",
            )
        assert result.exit_code == 0
        assert pipeline_mock.ingest_text.call_args.kwargs["update_existing"] is True

    def test_document_id_and_update_if_exists_mutually_exclusive(self, runner) -> None:
        """The new long-form name still triggers the mutual-exclusivity check."""
        pipeline_mock = _make_pipeline_mock()
        s, c, e, p = _ingest_patches(pipeline_mock)
        with s, c, e, p:
            result = runner.invoke(
                cli, ["ingest", "--paste", "--title", "T",
                      "--document-id", "x", "--update-if-exists"],
                input="x",
            )
        assert result.exit_code != 0
        assert "mutually exclusive" in result.output

    # ── search: --match-count / --count / -n ─────────────────────────────────

    @staticmethod
    def _empty_search_response():
        from cerefox.retrieval.search import SearchResponse  # noqa: PLC0415
        return SearchResponse(
            results=[], query="q", mode="hybrid",
            total_found=0, response_bytes=0, truncated=False,
        )

    def _run_search(self, runner, args: list[str], search_mock: MagicMock):
        client_mock = MagicMock()
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=client_mock),
            patch("cerefox.cli._get_embedder", return_value=MagicMock()),
            patch("cerefox.retrieval.search.SearchClient", return_value=search_mock),
        ):
            return runner.invoke(cli, args)

    def test_search_match_count_long_form(self, runner) -> None:
        search_mock = MagicMock()
        search_mock.hybrid.return_value = self._empty_search_response()
        result = self._run_search(runner, ["search", "q", "--match-count", "25"], search_mock)
        assert result.exit_code == 0
        assert search_mock.hybrid.call_args.kwargs["match_count"] == 25

    def test_search_count_short_alias(self, runner) -> None:
        search_mock = MagicMock()
        search_mock.hybrid.return_value = self._empty_search_response()
        result = self._run_search(runner, ["search", "q", "--count", "25"], search_mock)
        assert result.exit_code == 0
        assert search_mock.hybrid.call_args.kwargs["match_count"] == 25

    # ── search: --metadata-filter / --filter / -f ────────────────────────────

    def test_search_metadata_filter_long_form(self, runner) -> None:
        search_mock = MagicMock()
        search_mock.hybrid.return_value = self._empty_search_response()
        result = self._run_search(
            runner, ["search", "q", "--metadata-filter", '{"type":"note"}'], search_mock,
        )
        assert result.exit_code == 0
        assert search_mock.hybrid.call_args.kwargs["metadata_filter"] == {"type": "note"}

    def test_search_filter_short_alias(self, runner) -> None:
        search_mock = MagicMock()
        search_mock.hybrid.return_value = self._empty_search_response()
        result = self._run_search(
            runner, ["search", "q", "--filter", '{"type":"note"}'], search_mock,
        )
        assert result.exit_code == 0
        assert search_mock.hybrid.call_args.kwargs["metadata_filter"] == {"type": "note"}

    # ── metadata-search: --metadata-filter / --filter ────────────────────────

    def test_metadata_search_metadata_filter_long_form(self, runner) -> None:
        client_mock = MagicMock()
        client_mock.metadata_search.return_value = []
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(
                cli, ["metadata-search", "--metadata-filter", '{"type":"note"}'],
            )
        assert result.exit_code == 0
        assert client_mock.metadata_search.call_args.kwargs["metadata_filter"] == {"type": "note"}

    def test_metadata_search_project_name_long_form(self, runner) -> None:
        client_mock = MagicMock()
        client_mock.metadata_search.return_value = []
        client_mock.list_projects.return_value = [{"id": "p1", "name": "Research"}]
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(
                cli, ["metadata-search",
                      "--metadata-filter", '{"x":"y"}',
                      "--project-name", "Research"],
            )
        assert result.exit_code == 0
        # Resolved to project_id by the command
        assert client_mock.metadata_search.call_args.kwargs["project_id"] == "p1"

    # ── get-doc: --version-id / --version ────────────────────────────────────

    def test_get_doc_version_id_long_form(self, runner) -> None:
        client_mock = MagicMock()
        client_mock.get_document_content.return_value = {
            "doc_title": "T", "doc_source": "paste", "chunk_count": 1,
            "total_chars": 10, "full_content": "x",
        }
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(cli, ["get-doc", "d-1", "--version-id", "v-1"])
        assert result.exit_code == 0
        assert client_mock.get_document_content.call_args.kwargs["version_id"] == "v-1"

    def test_get_doc_version_short_alias(self, runner) -> None:
        client_mock = MagicMock()
        client_mock.get_document_content.return_value = {
            "doc_title": "T", "doc_source": "paste", "chunk_count": 1,
            "total_chars": 10, "full_content": "x",
        }
        with (
            patch("cerefox.cli.Settings", return_value=_patched_settings_default()),
            patch("cerefox.cli._get_client", return_value=client_mock),
        ):
            result = runner.invoke(cli, ["get-doc", "d-1", "--version", "v-1"])
        assert result.exit_code == 0
        assert client_mock.get_document_content.call_args.kwargs["version_id"] == "v-1"
