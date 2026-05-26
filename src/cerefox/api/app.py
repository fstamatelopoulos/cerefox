"""FastAPI application factory for Cerefox."""

from __future__ import annotations

from importlib.resources import files as _pkg_files
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from cerefox import __version__ as _CEREFOX_VERSION
from cerefox.api.routes_api import api_router


def _resolve_static_dir() -> Path | None:
    """Locate the legacy `web/static/` assets (logo, favicon)."""
    # Repo layout: <repo>/src/cerefox/api/app.py → <repo>/web/static.
    here = Path(__file__).resolve()
    repo_static = here.parents[3] / "web" / "static"
    if repo_static.is_dir():
        return repo_static
    return None


def _resolve_spa_dist() -> Path | None:
    """Locate the React SPA build output.

    Two locations, in order:
      1. Bundled in the wheel at ``cerefox/_frontend_dist`` (production install).
      2. ``<repo>/frontend/dist`` (dev mode — Vite output).

    Returns ``None`` if neither exists (web UI is unreachable but the API
    still works).
    """
    bundled = Path(str(_pkg_files("cerefox").joinpath("_frontend_dist")))
    if bundled.is_dir():
        return bundled
    here = Path(__file__).resolve()
    repo_dist = here.parents[3] / "frontend" / "dist"
    if repo_dist.is_dir():
        return repo_dist
    return None


STATIC_DIR = _resolve_static_dir()
SPA_DIST_DIR = _resolve_spa_dist()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Cerefox",
        description="Personal knowledge base for AI agents",
        version=_CEREFOX_VERSION,
    )

    # Mount static files (logo, favicon) if the directory exists.
    if STATIC_DIR is not None and STATIC_DIR.exists():
        app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    # JSON API routes (consumed by the React SPA and external clients)
    app.include_router(api_router)

    # Root redirect: point users to the SPA
    @app.get("/", response_class=HTMLResponse)
    def root_redirect():
        """Redirect root to the SPA, with a fallback message for old bookmarks."""
        return HTMLResponse(
            content="""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="2;url=/app/">
  <title>Cerefox</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex; justify-content: center; align-items: center;
      min-height: 100vh; margin: 0;
      background: #f8f9fa; color: #333;
    }
    .card {
      text-align: center; padding: 3rem; background: #fff;
      border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      max-width: 420px;
    }
    a { color: #228be6; text-decoration: none; font-weight: 600; }
    a:hover { text-decoration: underline; }
    .dimmed { color: #868e96; font-size: 0.85rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Cerefox</h2>
    <p>The web interface has moved to <a href="/app/">/app/</a></p>
    <p>Redirecting automatically...</p>
    <p class="dimmed">
      API endpoints are available at <code>/api/v1/</code><br>
      MCP access via Edge Functions (see docs)
    </p>
  </div>
</body>
</html>""",
            status_code=200,
        )

    # Serve the React SPA build output at /app/* (if built / bundled)
    if SPA_DIST_DIR is not None and SPA_DIST_DIR.exists():
        # Vite puts hashed JS/CSS in assets/
        assets_dir = SPA_DIST_DIR / "assets"
        if assets_dir.exists():
            app.mount(
                "/app/assets",
                StaticFiles(directory=str(assets_dir)),
                name="spa-assets",
            )

        @app.get("/app/{rest_of_path:path}")
        def spa_catch_all(rest_of_path: str) -> FileResponse:
            """Serve the SPA index.html for all /app/* routes (client-side routing)."""
            return FileResponse(str(SPA_DIST_DIR / "index.html"))

    return app


# Module-level app instance for uvicorn / CLI.
app = create_app()
