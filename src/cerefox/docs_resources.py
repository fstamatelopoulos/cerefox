"""Bundled documentation resolution helpers.

Single source of truth for "what docs ship with this Cerefox install and how
do we read them?" — consumed by the ``cerefox docs`` CLI command and the
``/api/v1/docs`` REST endpoints. The bundled docs are placed under
``cerefox/_docs/`` at wheel-build time (see ``pyproject.toml`` →
``[tool.hatch.build.targets.wheel.force-include]``).

In dev mode (running from a repo checkout via ``uv run``) we look at the
repo-relative ``docs/``, ``AGENT_GUIDE.md``, etc. so doc changes are visible
without reinstall. In installed-wheel mode we read from the bundled
``cerefox/_docs/`` package resource.

This module deliberately serves only **user-facing** docs:

* ``README.md``
* ``AGENT_GUIDE.md``, ``AGENT_QUICK_REFERENCE.md``
* ``docs/guides/*.md``

Contributor-only docs (``CLAUDE.md``, ``docs/research/*``, ``docs/specs/*``,
``docs/plan.md``, ``docs/TODO.md``) are intentionally excluded — they don't
belong in an end-user-facing surface.
"""

from __future__ import annotations

from dataclasses import dataclass
from importlib.resources import files as _pkg_files
from pathlib import Path


@dataclass(frozen=True)
class DocEntry:
    """A single bundled documentation file.

    Attributes:
        path: Forward-slash-separated path used as the identifier on both the
            CLI (``cerefox docs <path>``) and the API
            (``GET /api/v1/docs/<path>``). Examples: ``README.md``,
            ``guides/quickstart.md``.
        title: Best-effort title — the first H1 in the file, or a slug-cased
            fallback derived from the filename if no H1 exists.
        category: ``readme``, ``agent-guide``, or ``guide`` for grouping in
            the UI sidebar.
    """

    path: str
    title: str
    category: str


_REPO_ROOT_DOCS = ("README.md", "AGENT_GUIDE.md", "AGENT_QUICK_REFERENCE.md")
_GUIDES_SUBDIR = "guides"


def _resolve_docs_root() -> Path:
    """Return the absolute path to the docs root, bundled or repo.

    Two modes:

    1. **Wheel-bundled**: ``importlib.resources.files("cerefox") / "_docs"``
       exists when the package is installed from a wheel built with the
       force-include block in ``pyproject.toml``.
    2. **Repo / editable install**: the repo root has ``README.md``,
       ``AGENT_GUIDE.md``, and ``docs/guides/`` at well-known relative
       locations.

    In dev mode the function returns a *virtual* root — a :class:`Path` that
    doesn't physically exist but whose ``/ "guides" / x.md`` form resolves to
    real repo files (see :func:`open_doc`). This complication lets the rest
    of the module treat both modes uniformly.
    """
    bundled = Path(str(_pkg_files("cerefox").joinpath("_docs")))
    if bundled.is_dir():
        return bundled
    return _repo_root() / "_docs_virtual"


def _repo_root() -> Path:
    """Best-effort guess at the repo root for dev-mode lookups.

    Walks up from ``src/cerefox/docs_resources.py`` to find the repo root
    (the parent of ``src/``). When the package is installed as a wheel this
    path is meaningless and the bundled branch above wins.
    """
    here = Path(__file__).resolve()
    # ``here.parents[2]`` == ``<repo>/src``; ``parents[3]`` == ``<repo>``.
    return here.parents[2] if len(here.parents) >= 3 else here.parent


def _resolve_real_path(rel_path: str) -> Path | None:
    """Map a logical doc path (e.g. ``guides/quickstart.md``) to a real file.

    Tries the bundled location first, then the repo-relative location for
    dev mode. Returns ``None`` if neither resolves to a regular file.

    Path-traversal guard: any ``rel_path`` containing ``..`` segments or
    starting with ``/`` is rejected.
    """
    if not rel_path:
        return None
    if rel_path.startswith("/") or ".." in Path(rel_path).parts:
        return None

    bundled = Path(str(_pkg_files("cerefox").joinpath("_docs"))) / rel_path
    if bundled.is_file():
        return bundled

    repo = _repo_root()
    if rel_path in _REPO_ROOT_DOCS:
        candidate = repo / rel_path
    elif rel_path.startswith(f"{_GUIDES_SUBDIR}/"):
        candidate = repo / "docs" / rel_path
    else:
        return None
    return candidate if candidate.is_file() else None


def _extract_title(content: str, fallback_slug: str) -> str:
    """Return the first H1 heading, or a humanized fallback from the slug."""
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    return fallback_slug.replace("-", " ").replace("_", " ").title()


def _categorize(rel_path: str) -> str:
    if rel_path == "README.md":
        return "readme"
    if rel_path in ("AGENT_GUIDE.md", "AGENT_QUICK_REFERENCE.md"):
        return "agent-guide"
    return "guide"


def list_bundled_docs() -> list[DocEntry]:
    """Return every user-facing bundled doc as a list of :class:`DocEntry`.

    Ordered: README first, agent guides next, then ``guides/`` alphabetically.
    Each entry's ``path`` is the same identifier the
    ``GET /api/v1/docs/{path}`` endpoint expects.
    """
    entries: list[DocEntry] = []
    for root_file in _REPO_ROOT_DOCS:
        real = _resolve_real_path(root_file)
        if real is None:
            continue
        title = _extract_title(real.read_text(encoding="utf-8"), Path(root_file).stem)
        entries.append(DocEntry(path=root_file, title=title, category=_categorize(root_file)))

    guides = _list_guides()
    for guide_path in sorted(guides):
        real = _resolve_real_path(guide_path)
        if real is None:
            continue
        title = _extract_title(real.read_text(encoding="utf-8"), Path(guide_path).stem)
        entries.append(DocEntry(path=guide_path, title=title, category="guide"))

    return entries


def _list_guides() -> list[str]:
    """Enumerate guide paths from whichever location is available."""
    # Bundled mode
    bundled_guides = Path(str(_pkg_files("cerefox").joinpath("_docs"))) / _GUIDES_SUBDIR
    if bundled_guides.is_dir():
        return [f"{_GUIDES_SUBDIR}/{p.name}" for p in bundled_guides.iterdir() if p.suffix == ".md"]

    # Dev mode
    repo_guides = _repo_root() / "docs" / _GUIDES_SUBDIR
    if repo_guides.is_dir():
        return [f"{_GUIDES_SUBDIR}/{p.name}" for p in repo_guides.iterdir() if p.suffix == ".md"]

    return []


def read_doc(rel_path: str) -> str | None:
    """Return the raw markdown content of a bundled doc, or ``None`` if not found.

    Args:
        rel_path: The logical path identifier (e.g. ``guides/quickstart.md``).
            Path-traversal attempts return ``None`` rather than raising.
    """
    real = _resolve_real_path(rel_path)
    if real is None:
        return None
    return real.read_text(encoding="utf-8")


def real_path(rel_path: str) -> Path | None:
    """Return the resolved filesystem path for a bundled doc, or ``None``.

    Used by the CLI to pass a path to :func:`webbrowser.open`.
    """
    return _resolve_real_path(rel_path)


def find_doc(query: str) -> DocEntry | None:
    """Find a single doc by fuzzy match against title and path.

    Used by ``cerefox docs <query>`` to translate a user-typed topic into a
    real document. Match rules (most → least specific):

    1. Exact path match.
    2. Exact basename match (e.g. ``quickstart`` matches ``guides/quickstart.md``).
    3. Case-insensitive substring match against title.
    4. Case-insensitive substring match against path.

    Returns the first hit, or ``None`` if nothing matches.
    """
    if not query:
        return None
    entries = list_bundled_docs()
    q = query.strip()
    ql = q.lower()

    for e in entries:
        if e.path == q:
            return e
    for e in entries:
        stem = Path(e.path).stem
        if stem == q:
            return e
    for e in entries:
        if ql in e.title.lower():
            return e
    for e in entries:
        if ql in e.path.lower():
            return e
    return None
