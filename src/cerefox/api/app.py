"""FastAPI application factory for the Cerefox web UI."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from cerefox.api.routes import router
from cerefox.api.routes_api import api_router

# Resolve paths relative to this file so they work regardless of cwd.
_PKG_ROOT = Path(__file__).parent.parent.parent.parent  # project root
TEMPLATES_DIR = _PKG_ROOT / "web" / "templates"
STATIC_DIR = _PKG_ROOT / "web" / "static"
SPA_DIST_DIR = _PKG_ROOT / "frontend" / "dist"


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Cerefox",
        description="Personal knowledge base web UI",
        version="0.1.0",
    )

    # Jinja2 templates -- attached to app.state so routes can access them.
    templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
    app.state.templates = templates

    # Mount static files if the directory exists.
    if STATIC_DIR.exists():
        app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    # JSON API routes (consumed by the React SPA)
    app.include_router(api_router)

    # Jinja2 HTML routes (existing, kept during transition)
    app.include_router(router)

    # Serve the React SPA build output at /app/* (if built)
    if SPA_DIST_DIR.exists():
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
