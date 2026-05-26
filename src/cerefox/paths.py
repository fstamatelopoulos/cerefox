"""Filesystem layout helpers for Cerefox.

The single source of truth for "where does Cerefox's config and state live?".
Used by `cerefox.config.Settings` to decide which `.env` to load, and by the
backup directory default.

Precedence (highest wins):

  1. ``CEREFOX_CONFIG_DIR`` environment variable (explicit override; supports ``~``).
  2. Repo-local ``.env`` in the current working directory (dev mode).
  3. ``~/.cerefox/`` — the user-state root for installed setups.

The dev-mode branch (#2) makes existing ``cd /path/to/cerefox && uv run cerefox …``
workflows keep working unchanged. New users with no repo-local ``.env`` get the
``~/.cerefox/`` flow.

**v1.0 revisit (planned)**: the dev-mode-wins precedence is defensive for the
v0.x line. At v1.0 the natural default flips to ``~/.cerefox/`` first, with
repo-local ``.env`` becoming an explicit opt-in (e.g. ``CEREFOX_CONFIG_DIR=.``).
See ``docs/plan.md`` § Iteration 20 → "v1.0 revisit" for the rationale.
"""

from __future__ import annotations

import os
from pathlib import Path

USER_STATE_DIR_NAME = ".cerefox"


def resolve_config_dir(cwd: Path | None = None) -> Path:
    """Return the directory where Cerefox looks for its ``.env`` file.

    Pure function — no filesystem writes, no logging side effects. The caller
    is responsible for materialising the directory if needed (see
    :func:`ensure_user_state_dir`).

    Args:
        cwd: Override the working directory used for the dev-mode check.
            Mainly for tests; production callers should leave this as ``None``
            so we read from :func:`os.getcwd`.

    Returns:
        Absolute :class:`Path` to the resolved config directory. Existence of
        the directory is not guaranteed by this function — for the
        ``~/.cerefox/`` branch the directory may not yet exist.
    """
    env_override = os.environ.get("CEREFOX_CONFIG_DIR", "").strip()
    if env_override:
        return Path(env_override).expanduser().resolve()

    here = Path(cwd) if cwd is not None else Path.cwd()
    if (here / ".env").is_file():
        return here.resolve()

    return (Path.home() / USER_STATE_DIR_NAME).resolve()


def resolve_env_file(cwd: Path | None = None) -> Path:
    """Return the absolute path to the ``.env`` file Cerefox would load.

    Just ``resolve_config_dir() / ".env"`` — convenience for callers that
    need the file path rather than the directory.
    """
    return resolve_config_dir(cwd=cwd) / ".env"


def user_state_dir() -> Path:
    """Return ``~/.cerefox/`` as an absolute :class:`Path`.

    This is the directory the resolver falls back to when no override and no
    repo-local ``.env`` is present. The directory may not yet exist; call
    :func:`ensure_user_state_dir` to materialise the subdirectory layout.
    """
    return (Path.home() / USER_STATE_DIR_NAME).resolve()


def ensure_user_state_dir(target: Path | None = None) -> Path:
    """Create the user-state directory and its subdirs if missing.

    Args:
        target: Override the directory to create. Defaults to
            :func:`user_state_dir` (``~/.cerefox/``). Other callers
            (config_dir set to a custom path) may pass it explicitly.

    Returns:
        The (now-existing) directory.
    """
    root = target if target is not None else user_state_dir()
    root.mkdir(parents=True, exist_ok=True)
    for sub in ("backups", "logs", "cache", "docs"):
        (root / sub).mkdir(exist_ok=True)
    env_file = root / ".env"
    if env_file.is_file():
        try:
            env_file.chmod(0o600)
        except OSError:
            # On platforms or filesystems where chmod is a no-op (Windows,
            # some network mounts), best-effort tightening is fine.
            pass
    return root


def is_dev_mode(cwd: Path | None = None) -> bool:
    """Return True if Cerefox would resolve config from a repo-local ``.env``.

    Useful for places that want to behave differently in dev mode (e.g.
    preferring repo-local frontend ``dist/`` over the bundled wheel asset).
    """
    if os.environ.get("CEREFOX_CONFIG_DIR", "").strip():
        return False
    here = Path(cwd) if cwd is not None else Path.cwd()
    return (here / ".env").is_file()


def default_backup_dir(cwd: Path | None = None) -> Path:
    """Return the default backup directory for the resolved config dir.

    In dev mode this is ``./backups`` (the pre-v0.3.0 default — preserves the
    existing dev workflow). In user-state mode it's ``~/.cerefox/backups``.
    When ``CEREFOX_CONFIG_DIR`` is set, it's ``<that-dir>/backups``.
    """
    if is_dev_mode(cwd=cwd):
        here = Path(cwd) if cwd is not None else Path.cwd()
        return (here / "backups").resolve()
    return resolve_config_dir(cwd=cwd) / "backups"
