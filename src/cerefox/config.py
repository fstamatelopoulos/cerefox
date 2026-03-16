"""Cerefox configuration via pydantic-settings.

All settings are read from environment variables with the CEREFOX_ prefix,
or from a .env file in the working directory. See .env.example for reference.
"""

from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="CEREFOX_",
        env_file=".env",
        env_file_encoding="utf-8",
        env_ignore_empty=False,
        extra="ignore",
    )

    # ── Supabase ──────────────────────────────────────────────────────────────
    # API URL and service role key — used by the application (supabase-py)
    supabase_url: str = ""
    supabase_key: str = ""

    # Direct Postgres connection URL — used by deployment scripts (psycopg2)
    database_url: str = ""

    # ── Embeddings ────────────────────────────────────────────────────────────
    # Cloud-based embedders only. Local models (mpnet, Ollama) are no longer
    # supported — they create installation complexity and fail on some platforms.
    #
    # "openai"    — OpenAI text-embedding-3-small (default, low per-token cost)
    # "fireworks" — Fireworks AI nomic-embed-text-v1.5 (OpenAI-compatible API)
    embedder: Literal["openai", "fireworks"] = "openai"

    # OpenAI API settings (used when embedder="openai")
    # Accepts CEREFOX_OPENAI_API_KEY or the standard OPENAI_API_KEY env var.
    openai_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("CEREFOX_OPENAI_API_KEY", "OPENAI_API_KEY"),
    )
    openai_base_url: str = "https://api.openai.com/v1"
    openai_embedding_model: str = "text-embedding-3-small"
    openai_embedding_dimensions: int = 768  # must match VECTOR(768) schema

    # Fireworks AI settings (used when embedder="fireworks")
    # Fireworks uses an OpenAI-compatible API; the CloudEmbedder handles both.
    fireworks_api_key: str = ""
    fireworks_base_url: str = "https://api.fireworks.ai/inference/v1"
    fireworks_embedding_model: str = "nomic-ai/nomic-embed-text-v1.5"

    # ── Chunking ──────────────────────────────────────────────────────────────
    max_chunk_chars: int = 4000
    min_chunk_chars: int = 100

    # ── Retrieval ─────────────────────────────────────────────────────────────
    max_response_bytes: int = 65000
    # Minimum cosine similarity score for hybrid and semantic search results (0.0–1.0).
    # Results below this threshold are dropped. FTS results are not affected.
    #
    # OpenAI text-embedding-3-small cosine scores: noise floor ~0.20, genuine
    # matches typically 0.45+. 0.50 is a reasonable default.
    min_search_score: float = 0.50

    # ── Storage ───────────────────────────────────────────────────────────────
    backup_dir: str = "./backups"

    # ── Logging ───────────────────────────────────────────────────────────────
    log_level: str = "INFO"

    def is_supabase_configured(self) -> bool:
        """Return True if Supabase API credentials are set."""
        return bool(self.supabase_url and self.supabase_key)

    def is_db_configured(self) -> bool:
        """Return True if a direct Postgres connection URL is set."""
        return bool(self.database_url)

    def get_embedder_api_key(self) -> str:
        """Return the API key for the configured embedder."""
        if self.embedder == "fireworks":
            return self.fireworks_api_key
        return self.openai_api_key

    def get_embedder_base_url(self) -> str:
        """Return the base URL for the configured embedder."""
        if self.embedder == "fireworks":
            return self.fireworks_base_url
        return self.openai_base_url

    def get_embedder_model(self) -> str:
        """Return the model name for the configured embedder."""
        if self.embedder == "fireworks":
            return self.fireworks_embedding_model
        return self.openai_embedding_model

    def get_embedder_dimensions(self) -> int:
        """Return the output dimensions for the configured embedder."""
        # Both default to 768 to match the schema.
        return self.openai_embedding_dimensions
