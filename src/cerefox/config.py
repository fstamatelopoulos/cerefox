"""Cerefox configuration via pydantic-settings.

Settings are read from environment variables with the ``CEREFOX_`` prefix,
or from a ``.env`` file discovered via :func:`cerefox.paths.resolve_env_file`.

Resolution precedence (see ``cerefox.paths`` for the full rule):
  1. ``CEREFOX_CONFIG_DIR`` env var override.
  2. Repo-local ``.env`` in the current working directory (dev mode).
  3. ``~/.cerefox/.env`` (user-state root, the default for installed setups).

See ``.env.example`` for the full list of supported settings.
"""

from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from cerefox.paths import default_backup_dir, resolve_env_file


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="CEREFOX_",
        # Resolved at class-import time. Dev users with a repo-local `.env`
        # see the same behavior as pre-v0.3.0. Installed users (no repo-local
        # `.env`) get `~/.cerefox/.env`.
        env_file=str(resolve_env_file()),
        env_file_encoding="utf-8",
        env_ignore_empty=False,
        extra="ignore",
        # Allow construction via field names (e.g. cli_author_name=...) even when
        # validation_alias is set. Important for tests that construct Settings
        # directly with explicit values.
        populate_by_name=True,
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
    max_response_bytes: int = 200000
    # Minimum cosine similarity score for hybrid and semantic search results (0.0–1.0).
    # Results below this threshold are dropped. FTS results are not affected.
    #
    # OpenAI text-embedding-3-small cosine scores: noise floor ~0.20, genuine
    # matches typically 0.45+. 0.50 is a reasonable default.
    min_search_score: float = 0.50

    # ── Versioning ────────────────────────────────────────────────────────────
    # How long to retain archived document versions. The most recent version is
    # always kept regardless of this setting (accidental-deletion protection).
    # Older versions beyond this window are lazily deleted on the next update.
    version_retention_hours: int = 48
    # When false, all versions are immutable (no cleanup ever runs).
    # Archived versions (archived=true) are always protected regardless of this setting.
    version_cleanup_enabled: bool = True

    # ── Storage ───────────────────────────────────────────────────────────────
    # Resolved at Settings construction time. Dev mode (repo-local `.env`
    # present) → `./backups` relative to CWD (preserves pre-v0.3.0 behavior).
    # User-state mode → `~/.cerefox/backups`. Explicit `CEREFOX_BACKUP_DIR`
    # env var always wins. See `cerefox.paths.default_backup_dir` for the
    # full rule.
    backup_dir: str = Field(default_factory=lambda: str(default_backup_dir()))

    # ── CLI caller identity ───────────────────────────────────────────────────
    # Default attribution for CLI invocations when --author / --author-type /
    # --requestor are not passed. Used by `cerefox ingest`, `ingest-dir`,
    # `search`, `get-doc`, `list-versions`, `list-projects`, `metadata-search`,
    # and `get-audit-log`. Per the Q2 2026 decision-log entry
    # ("CLI gains caller-set author / author_type / requestor"), `access_path`
    # remains "cli" regardless — only the caller identity is configurable.
    #
    # Precedence: CLI flag > env var > built-in default. Env vars are named
    # without the CEREFOX_CLI_ prefix because they apply to all CLI invocations
    # (a single identity per machine is the typical case for agent harnesses).
    cli_author_name: str = Field(
        default="unknown",
        validation_alias=AliasChoices("CEREFOX_AUTHOR_NAME"),
    )
    cli_author_type: Literal["user", "agent"] = Field(
        default="user",
        validation_alias=AliasChoices("CEREFOX_AUTHOR_TYPE"),
    )
    cli_requestor_name: str = Field(
        default="user",
        validation_alias=AliasChoices("CEREFOX_REQUESTOR_NAME"),
    )

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
