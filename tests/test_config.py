"""Tests for cerefox.config.Settings.

All tests are unit tests — no network or file system access needed.
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from cerefox.config import Settings


# ── Defaults ──────────────────────────────────────────────────────────────────


class TestDefaults:
    """Settings should have safe, working defaults for all optional fields."""

    def test_default_embedder(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            s = Settings(_env_file=None)
        assert s.embedder == "openai"

    def test_default_openai_model(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            s = Settings(_env_file=None)
        assert s.openai_embedding_model == "text-embedding-3-small"

    def test_default_openai_dimensions(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            s = Settings(_env_file=None)
        assert s.openai_embedding_dimensions == 768

    def test_default_fireworks_model(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            s = Settings(_env_file=None)
        assert s.fireworks_embedding_model == "nomic-ai/nomic-embed-text-v1.5"

    def test_default_max_chunk_chars(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            s = Settings(_env_file=None)
        assert s.max_chunk_chars == 4000

    def test_default_min_chunk_chars(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            s = Settings(_env_file=None)
        assert s.min_chunk_chars == 100

    def test_default_max_response_bytes(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            s = Settings(_env_file=None)
        assert s.max_response_bytes == 200000

    def test_default_supabase_url_empty(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            s = Settings(_env_file=None)
        assert s.supabase_url == ""

    def test_default_log_level(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            s = Settings(_env_file=None)
        assert s.log_level == "INFO"

    def test_default_min_search_score(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            s = Settings(_env_file=None)
        assert s.min_search_score == pytest.approx(0.50)


# ── Env overrides ─────────────────────────────────────────────────────────────


class TestEnvOverrides:
    """Environment variables with CEREFOX_ prefix should override defaults."""

    def test_supabase_url_override(self) -> None:
        with patch.dict(os.environ, {"CEREFOX_SUPABASE_URL": "https://myproject.supabase.co"}, clear=True):
            s = Settings(_env_file=None)
        assert s.supabase_url == "https://myproject.supabase.co"

    def test_embedder_fireworks_override(self) -> None:
        with patch.dict(os.environ, {"CEREFOX_EMBEDDER": "fireworks"}, clear=True):
            s = Settings(_env_file=None)
        assert s.embedder == "fireworks"

    def test_max_chunk_chars_override(self) -> None:
        with patch.dict(os.environ, {"CEREFOX_MAX_CHUNK_CHARS": "2000"}, clear=True):
            s = Settings(_env_file=None)
        assert s.max_chunk_chars == 2000

    def test_max_response_bytes_override(self) -> None:
        with patch.dict(os.environ, {"CEREFOX_MAX_RESPONSE_BYTES": "32000"}, clear=True):
            s = Settings(_env_file=None)
        assert s.max_response_bytes == 32000

    def test_min_search_score_override(self) -> None:
        with patch.dict(os.environ, {"CEREFOX_MIN_SEARCH_SCORE": "0.4"}, clear=True):
            s = Settings(_env_file=None)
        assert s.min_search_score == pytest.approx(0.4)

    def test_log_level_override(self) -> None:
        with patch.dict(os.environ, {"CEREFOX_LOG_LEVEL": "DEBUG"}, clear=True):
            s = Settings(_env_file=None)
        assert s.log_level == "DEBUG"

    def test_openai_api_key_override(self) -> None:
        with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}, clear=True):
            s = Settings(_env_file=None)
        assert s.openai_api_key == "sk-test"

    def test_fireworks_api_key_override(self) -> None:
        with patch.dict(os.environ, {"CEREFOX_FIREWORKS_API_KEY": "fw-test"}, clear=True):
            s = Settings(_env_file=None)
        assert s.fireworks_api_key == "fw-test"


# ── Validation ────────────────────────────────────────────────────────────────


class TestValidation:
    """Settings should validate field values and reject invalid inputs."""

    def test_invalid_embedder_raises(self) -> None:
        with patch.dict(os.environ, {"CEREFOX_EMBEDDER": "mpnet"}, clear=True):
            with pytest.raises(ValidationError):
                Settings(_env_file=None)

    def test_embedder_openai_valid(self) -> None:
        with patch.dict(os.environ, {"CEREFOX_EMBEDDER": "openai"}, clear=True):
            s = Settings(_env_file=None)
        assert s.embedder == "openai"

    def test_embedder_fireworks_valid(self) -> None:
        with patch.dict(os.environ, {"CEREFOX_EMBEDDER": "fireworks"}, clear=True):
            s = Settings(_env_file=None)
        assert s.embedder == "fireworks"

    def test_max_chunk_chars_must_be_int(self) -> None:
        with patch.dict(os.environ, {"CEREFOX_MAX_CHUNK_CHARS": "notanumber"}, clear=True):
            with pytest.raises(ValidationError):
                Settings(_env_file=None)


# ── Helper methods ────────────────────────────────────────────────────────────


class TestHelperMethods:
    """is_supabase_configured() and is_db_configured() should return correct booleans."""

    def test_not_configured_when_empty(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            s = Settings(_env_file=None)
        assert s.is_supabase_configured() is False
        assert s.is_db_configured() is False

    def test_supabase_configured_when_both_set(self) -> None:
        with patch.dict(
            os.environ,
            {
                "CEREFOX_SUPABASE_URL": "https://x.supabase.co",
                "CEREFOX_SUPABASE_KEY": "secret",
            },
            clear=True,
        ):
            s = Settings(_env_file=None)
        assert s.is_supabase_configured() is True

    def test_supabase_not_configured_with_only_url(self) -> None:
        with patch.dict(
            os.environ,
            {"CEREFOX_SUPABASE_URL": "https://x.supabase.co", "CEREFOX_SUPABASE_KEY": ""},
            clear=True,
        ):
            s = Settings(_env_file=None)
        assert s.is_supabase_configured() is False

    def test_db_configured_when_url_set(self) -> None:
        with patch.dict(
            os.environ,
            {"CEREFOX_DATABASE_URL": "postgresql://postgres:pass@localhost/postgres"},
            clear=True,
        ):
            s = Settings(_env_file=None)
        assert s.is_db_configured() is True


# ── Embedder helper methods ───────────────────────────────────────────────────


class TestEmbedderHelpers:
    """get_embedder_*() methods should return correct values per embedder selection."""

    def test_get_embedder_api_key_openai(self) -> None:
        with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}, clear=True):
            s = Settings(_env_file=None)
        assert s.get_embedder_api_key() == "sk-test"

    def test_get_embedder_api_key_fireworks(self) -> None:
        with patch.dict(
            os.environ,
            {"CEREFOX_EMBEDDER": "fireworks", "CEREFOX_FIREWORKS_API_KEY": "fw-key"},
            clear=True,
        ):
            s = Settings(_env_file=None)
        assert s.get_embedder_api_key() == "fw-key"

    def test_get_embedder_base_url_openai(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            s = Settings(_env_file=None)
        assert s.get_embedder_base_url() == "https://api.openai.com/v1"

    def test_get_embedder_base_url_fireworks(self) -> None:
        with patch.dict(os.environ, {"CEREFOX_EMBEDDER": "fireworks"}, clear=True):
            s = Settings(_env_file=None)
        assert "fireworks.ai" in s.get_embedder_base_url()

    def test_get_embedder_model_openai(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            s = Settings(_env_file=None)
        assert s.get_embedder_model() == "text-embedding-3-small"

    def test_get_embedder_model_fireworks(self) -> None:
        with patch.dict(os.environ, {"CEREFOX_EMBEDDER": "fireworks"}, clear=True):
            s = Settings(_env_file=None)
        assert "nomic" in s.get_embedder_model()

    def test_get_embedder_dimensions_returns_768(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            s = Settings(_env_file=None)
        assert s.get_embedder_dimensions() == 768
