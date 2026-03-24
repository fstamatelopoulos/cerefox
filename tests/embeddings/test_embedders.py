"""Tests for embedder implementations and the Embedder protocol.

All tests use mocked httpx calls — no network access.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from cerefox.embeddings.base import Embedder


# ── Embedder protocol ─────────────────────────────────────────────────────────


class TestEmbedderProtocol:
    def test_cloud_embedder_satisfies_protocol(self) -> None:
        from cerefox.embeddings.cloud import CloudEmbedder

        embedder = CloudEmbedder(api_key="test-key")
        assert isinstance(embedder, Embedder)

    def test_protocol_is_runtime_checkable(self) -> None:
        # A minimal duck-typed object satisfies the Protocol at runtime.
        class FakeEmbedder:
            dimensions = 768
            model_name = "fake"

            def embed(self, text: str) -> list[float]:
                return [0.0] * 768

            def embed_batch(self, texts: list[str]) -> list[list[float]]:
                return [[0.0] * 768 for _ in texts]

        assert isinstance(FakeEmbedder(), Embedder)


# ── CloudEmbedder ─────────────────────────────────────────────────────────────


def _make_openai_response(embeddings: list[list[float]]) -> MagicMock:
    """Build a fake httpx response matching the OpenAI embeddings API shape."""
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "data": [
            {"index": i, "embedding": emb}
            for i, emb in enumerate(embeddings)
        ]
    }
    return mock_resp


class TestCloudEmbedderInit:
    def test_requires_api_key(self) -> None:
        from cerefox.embeddings.cloud import CloudEmbedder

        with pytest.raises(ValueError, match="API key"):
            CloudEmbedder(api_key="")

    def test_dimensions_property(self) -> None:
        from cerefox.embeddings.cloud import CloudEmbedder

        embedder = CloudEmbedder(api_key="key", dimensions=768)
        assert embedder.dimensions == 768

    def test_model_name_property(self) -> None:
        from cerefox.embeddings.cloud import CloudEmbedder

        embedder = CloudEmbedder(api_key="key", model="text-embedding-3-small")
        assert embedder.model_name == "text-embedding-3-small"

    def test_default_model(self) -> None:
        from cerefox.embeddings.cloud import CloudEmbedder

        embedder = CloudEmbedder(api_key="key")
        assert embedder.model_name == "text-embedding-3-small"

    def test_default_dimensions(self) -> None:
        from cerefox.embeddings.cloud import CloudEmbedder

        embedder = CloudEmbedder(api_key="key")
        assert embedder.dimensions == 768

    def test_trailing_slash_stripped_from_base_url(self) -> None:
        from cerefox.embeddings.cloud import CloudEmbedder

        embedder = CloudEmbedder(api_key="key", base_url="https://api.openai.com/v1/")
        assert not embedder._base_url.endswith("/")


class TestCloudEmbedderEmbed:
    @pytest.fixture()
    def embedder(self):
        from cerefox.embeddings.cloud import CloudEmbedder

        return CloudEmbedder(api_key="test-key", model="text-embedding-3-small", dimensions=768)

    def test_embed_returns_768_floats(self, embedder) -> None:
        fake_vec = [0.1] * 768
        with patch("httpx.post", return_value=_make_openai_response([fake_vec])):
            result = embedder.embed("hello world")
        assert isinstance(result, list)
        assert len(result) == 768

    def test_embed_posts_to_correct_url(self, embedder) -> None:
        fake_vec = [0.1] * 768
        with patch("httpx.post", return_value=_make_openai_response([fake_vec])) as mock_post:
            embedder.embed("hello")
        called_url = mock_post.call_args[0][0]
        assert called_url.endswith("/embeddings")
        assert "openai.com" in called_url

    def test_embed_sends_authorization_header(self, embedder) -> None:
        with patch("httpx.post", return_value=_make_openai_response([[0.0] * 768])) as mock_post:
            embedder.embed("test")
        headers = mock_post.call_args[1]["headers"]
        assert headers["Authorization"] == "Bearer test-key"

    def test_embed_sends_model_and_input(self, embedder) -> None:
        with patch("httpx.post", return_value=_make_openai_response([[0.0] * 768])) as mock_post:
            embedder.embed("my text")
        payload = mock_post.call_args[1]["json"]
        assert payload["model"] == "text-embedding-3-small"
        assert payload["input"] == ["my text"]

    def test_embed_sends_dimensions_when_not_1536(self, embedder) -> None:
        with patch("httpx.post", return_value=_make_openai_response([[0.0] * 768])) as mock_post:
            embedder.embed("text")
        payload = mock_post.call_args[1]["json"]
        assert payload.get("dimensions") == 768

    def test_embed_omits_dimensions_when_1536(self) -> None:
        from cerefox.embeddings.cloud import CloudEmbedder

        embedder = CloudEmbedder(api_key="key", dimensions=1536)
        with patch("httpx.post", return_value=_make_openai_response([[0.0] * 1536])) as mock_post:
            embedder.embed("text")
        payload = mock_post.call_args[1]["json"]
        assert "dimensions" not in payload

    def test_embed_raises_on_http_error(self, embedder) -> None:
        import httpx

        with patch("httpx.post", side_effect=httpx.HTTPError("connection refused")):
            with pytest.raises(RuntimeError, match="Embedding API failed after"):
                embedder.embed("boom")

    def test_embed_raises_on_status_error(self, embedder) -> None:
        import httpx

        mock_resp = MagicMock()
        mock_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            "401 Unauthorized", request=MagicMock(), response=MagicMock(status_code=401, text="Unauthorized")
        )
        mock_resp.status_code = 401
        with patch("httpx.post", return_value=mock_resp):
            with pytest.raises(RuntimeError, match="Embedding API error"):
                embedder.embed("bad key")


class TestCloudEmbedderBatch:
    @pytest.fixture()
    def embedder(self):
        from cerefox.embeddings.cloud import CloudEmbedder

        return CloudEmbedder(api_key="test-key")

    def test_embed_batch_empty_input_returns_empty(self, embedder) -> None:
        with patch("httpx.post") as mock_post:
            result = embedder.embed_batch([])
        assert result == []
        mock_post.assert_not_called()

    def test_embed_batch_returns_one_vector_per_input(self, embedder) -> None:
        vecs = [[float(i)] * 768 for i in range(3)]
        with patch("httpx.post", return_value=_make_openai_response(vecs)):
            result = embedder.embed_batch(["a", "b", "c"])
        assert len(result) == 3

    def test_embed_batch_preserves_order(self, embedder) -> None:
        """API may return embeddings out of order; result must be sorted by index."""
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        # Return in reverse order (index 1 before index 0)
        mock_resp.json.return_value = {
            "data": [
                {"index": 1, "embedding": [0.2] * 768},
                {"index": 0, "embedding": [0.1] * 768},
            ]
        }
        with patch("httpx.post", return_value=mock_resp):
            result = embedder.embed_batch(["first", "second"])
        assert result[0][0] == pytest.approx(0.1)
        assert result[1][0] == pytest.approx(0.2)

    def test_embed_batch_splits_into_batches(self) -> None:
        """Large inputs must be split into multiple API calls."""
        from cerefox.embeddings.cloud import CloudEmbedder, _BATCH_SIZE

        embedder = CloudEmbedder(api_key="key")
        n = _BATCH_SIZE + 5  # one call-over
        texts = [f"text {i}" for i in range(n)]

        # Each call returns the right number of embeddings
        call_count = [0]

        def fake_post(*args, **kwargs):
            batch = kwargs["json"]["input"]
            call_count[0] += 1
            return _make_openai_response([[0.0] * 768 for _ in batch])

        with patch("httpx.post", side_effect=fake_post):
            result = embedder.embed_batch(texts)

        assert call_count[0] == 2  # ceil(n / BATCH_SIZE)
        assert len(result) == n


class TestCloudEmbedderFireworks:
    """Verify the Fireworks-compatible configuration works correctly."""

    def test_fireworks_base_url(self) -> None:
        from cerefox.embeddings.cloud import CloudEmbedder

        embedder = CloudEmbedder(
            api_key="fw_key",
            base_url="https://api.fireworks.ai/inference/v1",
            model="nomic-ai/nomic-embed-text-v1.5",
            dimensions=768,
        )
        with patch("httpx.post", return_value=_make_openai_response([[0.0] * 768])) as mock_post:
            embedder.embed("test")
        called_url = mock_post.call_args[0][0]
        assert "fireworks.ai" in called_url

    def test_fireworks_uses_correct_api_key(self) -> None:
        from cerefox.embeddings.cloud import CloudEmbedder

        embedder = CloudEmbedder(
            api_key="fw_secret",
            base_url="https://api.fireworks.ai/inference/v1",
            model="nomic-ai/nomic-embed-text-v1.5",
        )
        with patch("httpx.post", return_value=_make_openai_response([[0.0] * 768])) as mock_post:
            embedder.embed("test")
        headers = mock_post.call_args[1]["headers"]
        assert headers["Authorization"] == "Bearer fw_secret"
