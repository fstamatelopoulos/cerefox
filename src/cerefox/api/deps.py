"""Shared FastAPI dependency injection functions for the JSON API."""

from __future__ import annotations

import logging
from functools import lru_cache

from cerefox.config import Settings
from cerefox.db.client import CerefoxClient
from cerefox.embeddings.base import Embedder
from cerefox.embeddings.cloud import CloudEmbedder

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _cached_settings() -> Settings:
    return Settings()


@lru_cache(maxsize=1)
def _cached_client() -> CerefoxClient:
    return CerefoxClient(_cached_settings())


@lru_cache(maxsize=1)
def _cached_embedder() -> Embedder | None:
    settings = _cached_settings()
    try:
        api_key = settings.get_embedder_api_key()
        if not api_key:
            logger.warning(
                "Embedding API key not set (CEREFOX_OPENAI_API_KEY or "
                "CEREFOX_FIREWORKS_API_KEY). Semantic search will be unavailable."
            )
            return None
        return CloudEmbedder(
            api_key=api_key,
            base_url=settings.get_embedder_base_url(),
            model=settings.get_embedder_model(),
            dimensions=settings.get_embedder_dimensions(),
        )
    except Exception as exc:
        logger.warning("Embedder unavailable: %s", exc)
        return None


def get_settings() -> Settings:
    return _cached_settings()


def get_client() -> CerefoxClient:
    return _cached_client()


def get_embedder() -> Embedder | None:
    return _cached_embedder()
