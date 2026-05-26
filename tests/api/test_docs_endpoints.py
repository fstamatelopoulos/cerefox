"""Tests for the bundled-docs and schema-version REST endpoints."""

from __future__ import annotations

from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from cerefox.api.app import create_app
from cerefox.api.deps import get_client


def _client_with_mock_db() -> tuple[TestClient, MagicMock]:
    """Spin up a TestClient with the DB dependency replaced by a mock."""
    app = create_app()
    mock_client = MagicMock()
    app.dependency_overrides[get_client] = lambda: mock_client
    return TestClient(app), mock_client


class TestListDocs:
    def test_returns_index(self) -> None:
        client, _ = _client_with_mock_db()
        response = client.get("/api/v1/docs")
        assert response.status_code == 200
        body = response.json()
        assert isinstance(body, list)
        assert len(body) > 0
        # Each entry has the expected shape
        for entry in body:
            assert set(entry.keys()) == {"path", "title", "category"}

    def test_readme_present(self) -> None:
        client, _ = _client_with_mock_db()
        response = client.get("/api/v1/docs")
        paths = [e["path"] for e in response.json()]
        assert "README.md" in paths


class TestGetDoc:
    def test_returns_markdown_content(self) -> None:
        client, _ = _client_with_mock_db()
        response = client.get("/api/v1/docs/README.md")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/markdown")
        assert "Cerefox" in response.text

    def test_returns_404_for_unknown(self) -> None:
        client, _ = _client_with_mock_db()
        response = client.get("/api/v1/docs/guides/nonexistent.md")
        assert response.status_code == 404

    def test_rejects_path_traversal(self) -> None:
        """The endpoint should never return content from outside the bundled
        docs directory, regardless of how the path is constructed."""
        client, _ = _client_with_mock_db()
        # Direct ../ — FastAPI's path:path converter passes them through.
        # Our docs_resources.read_doc() guards against this.
        for bad in (
            "/api/v1/docs/../../etc/passwd",
            "/api/v1/docs/guides/../../etc/passwd",
        ):
            response = client.get(bad)
            # Either 404 (our guard caught it) or normalized-away by HTTP.
            assert response.status_code in (404, 400)
            # And the body should NEVER contain /etc/passwd-like content.
            assert "root:x:" not in response.text


class TestSchemaVersion:
    def test_returns_bundled_value(self) -> None:
        """The bundled schema version is read from schema.sql's @version marker."""
        client, mock_client = _client_with_mock_db()
        # Mock the RPC to return a value matching the bundled version, so
        # no mismatch is reported.
        mock_client.client.rpc.return_value.execute.return_value = MagicMock(
            data=[{"cerefox_schema_version": "0.3.1"}],
        )
        response = client.get("/api/v1/schema-version")
        assert response.status_code == 200
        body = response.json()
        assert "bundled" in body
        assert "deployed" in body
        assert "mismatch" in body
        assert body["bundled"] == "0.3.1"

    def test_reports_mismatch_when_deployed_differs(self) -> None:
        client, mock_client = _client_with_mock_db()
        mock_client.client.rpc.return_value.execute.return_value = MagicMock(
            data=[{"cerefox_schema_version": "0.2.0"}],
        )
        response = client.get("/api/v1/schema-version")
        body = response.json()
        assert body["bundled"] == "0.3.1"
        assert body["deployed"] == "0.2.0"
        assert body["mismatch"] is True

    def test_no_mismatch_reported_when_rpc_unavailable(self) -> None:
        """Legacy deployments that lack the RPC should not trigger a banner."""
        client, mock_client = _client_with_mock_db()
        mock_client.client.rpc.side_effect = RuntimeError("function does not exist")
        response = client.get("/api/v1/schema-version")
        assert response.status_code == 200
        body = response.json()
        assert body["deployed"] is None
        assert body["mismatch"] is False

    def test_handles_scalar_rpc_response(self) -> None:
        """Some supabase-py versions return the scalar directly, not as a list."""
        client, mock_client = _client_with_mock_db()
        mock_client.client.rpc.return_value.execute.return_value = MagicMock(
            data="0.3.1",
        )
        response = client.get("/api/v1/schema-version")
        body = response.json()
        assert body["deployed"] == "0.3.1"
        assert body["mismatch"] is False


class TestVersionEndpoint:
    """Sanity check that the existing /api/v1/version endpoint still works."""

    def test_returns_version_info(self) -> None:
        client, _ = _client_with_mock_db()
        response = client.get("/api/v1/version")
        assert response.status_code == 200
        body = response.json()
        assert set(body.keys()) == {"version", "git_commit_short", "build_date"}
        assert body["version"]  # non-empty
