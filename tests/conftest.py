"""Shared pytest fixtures for Cerefox tests.

Unit tests must never hit a real database. Use the mocked client fixtures below.
Integration tests (marked @pytest.mark.integration) use real Supabase credentials
and are skipped by default. Run them with: pytest -m integration
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from cerefox.config import Settings
from cerefox.db.client import CerefoxClient


# ── Settings fixtures ─────────────────────────────────────────────────────────


@pytest.fixture
def test_settings() -> Settings:
    """Settings with safe test defaults (no real credentials needed)."""
    with patch.dict(
        "os.environ",
        {
            "CEREFOX_SUPABASE_URL": "https://test.supabase.co",
            "CEREFOX_SUPABASE_KEY": "test-key",
            "CEREFOX_DATABASE_URL": "postgresql://test:test@localhost/test",
            "CEREFOX_EMBEDDER": "openai",
            "OPENAI_API_KEY": "test-openai-key",
            "CEREFOX_MAX_CHUNK_CHARS": "4000",
            "CEREFOX_MIN_CHUNK_CHARS": "100",
            "CEREFOX_MAX_RESPONSE_BYTES": "65000",
            "CEREFOX_METADATA_STRICT": "true",
            "CEREFOX_LOG_LEVEL": "DEBUG",
            # Pin to config defaults so tests don't inherit values from .env
            "CEREFOX_VERSION_RETENTION_HOURS": "48",
            "CEREFOX_SMALL_TO_BIG_THRESHOLD": "40000",
            "CEREFOX_CONTEXT_WINDOW": "1",
        },
        clear=False,
    ):
        yield Settings()


@pytest.fixture
def minimal_settings() -> Settings:
    """Settings with only the absolute minimum set — all defaults."""
    with patch.dict("os.environ", {}, clear=True):
        # Suppress .env file loading for minimal settings
        with patch("cerefox.config.Settings.model_config", {"env_prefix": "CEREFOX_"}):
            yield Settings()


# ── Supabase client mock fixtures ─────────────────────────────────────────────


@pytest.fixture
def mock_supabase_client() -> MagicMock:
    """A MagicMock standing in for a supabase.Client instance."""
    mock = MagicMock()

    # Default: rpc() returns an empty list
    mock.rpc.return_value.execute.return_value.data = []

    # Default: table operations return empty lists
    mock.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
    mock.table.return_value.insert.return_value.execute.return_value.data = []
    mock.table.return_value.update.return_value.eq.return_value.execute.return_value.data = []
    mock.table.return_value.delete.return_value.eq.return_value.execute.return_value.data = []

    return mock


@pytest.fixture
def cerefox_client(test_settings: Settings, mock_supabase_client: MagicMock) -> CerefoxClient:
    """A CerefoxClient with an injected mock Supabase client (no network calls)."""
    client = CerefoxClient(test_settings)
    client._client = mock_supabase_client  # inject mock, bypassing lazy init
    return client


# ── Sample data fixtures ──────────────────────────────────────────────────────


@pytest.fixture
def sample_chunk_row() -> dict:
    """A typical row returned by a search RPC."""
    return {
        "chunk_id": "aaaaaaaa-0000-0000-0000-000000000001",
        "document_id": "bbbbbbbb-0000-0000-0000-000000000002",
        "chunk_index": 0,
        "title": "Introduction",
        "content": "This is a test chunk about AI agents.",
        "heading_path": ["Introduction"],
        "heading_level": 1,
        "score": 0.87,
        "doc_title": "AI Research Notes",
        "doc_source": "file",
        "doc_project_ids": [],
        "doc_metadata": {"tags": ["ai", "research"]},
    }


@pytest.fixture
def sample_embedding() -> list[float]:
    """A 768-dim zero vector for testing (real embeddings are normalized floats)."""
    return [0.0] * 768
