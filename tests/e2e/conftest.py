"""Shared fixtures for e2e tests.

These tests hit a real Supabase instance. Run with: uv run pytest -m e2e

All test data is tagged with an [E2E] prefix and cleaned up after the session,
even on failure.
"""

from __future__ import annotations

import logging
import os
import uuid
from typing import Any

import httpx
import pytest

from cerefox.config import Settings
from cerefox.db.client import CerefoxClient
from cerefox.embeddings.cloud import CloudEmbedder
from cerefox.ingestion.pipeline import IngestionPipeline

logger = logging.getLogger(__name__)

E2E_PREFIX = "[E2E]"
E2E_UI_PREFIX = "[E2E-UI]"
E2E_MCP_PREFIX = "[E2E-MCP]"
E2E_EF_PREFIX = "[E2E-EF]"
E2E_PREFIXES = (E2E_PREFIX, E2E_UI_PREFIX, E2E_MCP_PREFIX, E2E_EF_PREFIX)


def _make_unique_title(label: str) -> str:
    """Generate a unique test title to avoid collisions between runs."""
    return f"{E2E_PREFIX} {label} {uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="session")
def e2e_settings() -> Settings:
    """Real settings from .env — must have valid Supabase credentials."""
    settings = Settings()
    if not settings.is_supabase_configured():
        pytest.skip("Supabase not configured (CEREFOX_SUPABASE_URL / CEREFOX_SUPABASE_KEY)")
    return settings


def _purge_stale_test_data(client: CerefoxClient) -> None:
    """Delete any documents/projects left over from previous test runs."""
    try:
        docs = client.list_documents(limit=200)
        for doc in docs:
            title = doc.get("title", "")
            if any(title.startswith(p) for p in E2E_PREFIXES):
                logger.info("Purging stale test document: %s (%s)", title, doc["id"])
                client.delete_document(doc["id"])
    except Exception as exc:
        logger.warning("Stale document cleanup failed: %s", exc)
    try:
        projects = client.list_projects()
        for proj in projects:
            name = proj.get("name", "")
            if any(name.startswith(p) for p in E2E_PREFIXES):
                logger.info("Purging stale test project: %s (%s)", name, proj["id"])
                client.delete_project(proj["id"])
    except Exception as exc:
        logger.warning("Stale project cleanup failed: %s", exc)


@pytest.fixture(scope="session")
def e2e_client(e2e_settings: Settings) -> CerefoxClient:
    """A CerefoxClient connected to the real Supabase instance.

    On first use, purges any stale test data from previous runs.
    """
    client = CerefoxClient(e2e_settings)
    _purge_stale_test_data(client)
    return client


@pytest.fixture(scope="session")
def e2e_embedder(e2e_settings: Settings) -> CloudEmbedder | None:
    """The configured cloud embedder, or None if API key is missing."""
    api_key = e2e_settings.get_embedder_api_key()
    if not api_key:
        return None
    return CloudEmbedder(
        api_key=api_key,
        base_url=e2e_settings.get_embedder_base_url(),
        model=e2e_settings.get_embedder_model(),
        dimensions=e2e_settings.get_embedder_dimensions(),
    )


@pytest.fixture(scope="session")
def e2e_pipeline(
    e2e_client: CerefoxClient,
    e2e_embedder: CloudEmbedder | None,
    e2e_settings: Settings,
) -> IngestionPipeline | None:
    """An IngestionPipeline connected to the real backend, or None if no embedder."""
    if e2e_embedder is None:
        return None
    return IngestionPipeline(e2e_client, e2e_embedder, e2e_settings)


class EdgeFunctionClient:
    """Thin wrapper that invokes Supabase Edge Functions via httpx.

    Edge Functions require a valid JWT for Authorization. The Supabase anon key
    is a JWT; the service role key may or may not be depending on the setup.
    Set CEREFOX_SUPABASE_ANON_KEY in .env if it differs from CEREFOX_SUPABASE_KEY.
    """

    def __init__(self, base_url: str, anon_key: str) -> None:
        self._http = httpx.Client(
            base_url=f"{base_url}/functions/v1",
            headers={
                "Authorization": f"Bearer {anon_key}",
                "apikey": anon_key,
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )

    def invoke(self, function_name: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        """Invoke an Edge Function and return the parsed JSON response."""
        resp = self._http.post(f"/{function_name}", json=body or {})
        resp.raise_for_status()
        return resp.json()


@pytest.fixture(scope="session")
def e2e_edge(e2e_settings: Settings) -> EdgeFunctionClient | None:
    """An Edge Function client using the anon key for JWT auth.

    Returns None (and tests skip) if no valid JWT key is available.
    Reads CEREFOX_SUPABASE_ANON_KEY from .env (via dotenv) or os env,
    falling back to CEREFOX_SUPABASE_KEY if it looks like a JWT.
    """
    from dotenv import dotenv_values

    dotenv = dotenv_values(".env")
    anon_key = os.environ.get("CEREFOX_SUPABASE_ANON_KEY", "") or dotenv.get(
        "CEREFOX_SUPABASE_ANON_KEY", ""
    )
    if not anon_key:
        main_key = e2e_settings.supabase_key
        if main_key.startswith("eyJ"):
            anon_key = main_key
    if not anon_key:
        return None
    return EdgeFunctionClient(e2e_settings.supabase_url, anon_key)


class MCPClient:
    """Thin wrapper for calling the cerefox-mcp Edge Function via MCP JSON-RPC 2.0.

    Sends raw JSON-RPC 2.0 POST requests. Does not use any MCP SDK. This makes
    failures unambiguous -- protocol errors are clearly from the Edge Function,
    not from a client library.
    """

    def __init__(self, base_url: str, anon_key: str) -> None:
        self._http = httpx.Client(
            base_url=f"{base_url}/functions/v1/cerefox-mcp",
            headers={
                "Authorization": f"Bearer {anon_key}",
                "Content-Type": "application/json",
            },
            timeout=60.0,
        )
        self._req_id = 0

    def _next_id(self) -> int:
        self._req_id += 1
        return self._req_id

    def call(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """Send a JSON-RPC 2.0 request and return the full response dict."""
        body: dict[str, Any] = {"jsonrpc": "2.0", "id": self._next_id(), "method": method}
        if params is not None:
            body["params"] = params
        resp = self._http.post("", json=body)
        resp.raise_for_status()
        return resp.json()

    def tool(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        """Call a tools/call method and return the full JSON-RPC response."""
        return self.call("tools/call", {"name": name, "arguments": arguments or {}})

    def tool_text(self, name: str, arguments: dict[str, Any] | None = None) -> str:
        """Call a tool and return the text content. Raises if the call returned an error."""
        resp = self.tool(name, arguments)
        if "error" in resp:
            raise RuntimeError(f"MCP error: {resp['error']}")
        return resp["result"]["content"][0]["text"]

    def get(self) -> dict[str, Any]:
        """GET health check."""
        resp = self._http.get("")
        resp.raise_for_status()
        return resp.json()


@pytest.fixture(scope="session")
def e2e_mcp(e2e_settings: Settings) -> MCPClient | None:
    """An MCP client that calls the deployed cerefox-mcp Edge Function directly.

    Returns None (and tests skip) if no valid anon key is available.
    """
    from dotenv import dotenv_values

    dotenv = dotenv_values(".env")
    anon_key = os.environ.get("CEREFOX_SUPABASE_ANON_KEY", "") or dotenv.get(
        "CEREFOX_SUPABASE_ANON_KEY", ""
    )
    if not anon_key:
        main_key = e2e_settings.supabase_key
        if main_key.startswith("eyJ"):
            anon_key = main_key
    if not anon_key:
        return None
    return MCPClient(e2e_settings.supabase_url, anon_key)


class E2ECleanup:
    """Tracks created resources for cleanup."""

    def __init__(self, client: CerefoxClient) -> None:
        self._client = client
        self.document_ids: list[str] = []
        self.project_ids: list[str] = []

    def track_document(self, doc_id: str) -> None:
        self.document_ids.append(doc_id)

    def track_project(self, project_id: str) -> None:
        self.project_ids.append(project_id)

    def cleanup(self) -> None:
        for doc_id in self.document_ids:
            try:
                self._client.delete_document(doc_id)
            except Exception as exc:
                logger.warning("E2E cleanup: failed to delete document %s: %s", doc_id, exc)
        for project_id in self.project_ids:
            try:
                self._client.delete_project(project_id)
            except Exception as exc:
                logger.warning("E2E cleanup: failed to delete project %s: %s", project_id, exc)


@pytest.fixture
def cleanup(e2e_client: CerefoxClient) -> E2ECleanup:
    """Per-test cleanup tracker. Resources are deleted after the test."""
    tracker = E2ECleanup(e2e_client)
    yield tracker
    tracker.cleanup()


@pytest.fixture
def unique_title():
    """Factory fixture that generates unique [E2E] titles."""
    return _make_unique_title
