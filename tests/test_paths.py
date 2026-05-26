"""Tests for ``cerefox.paths`` — the config-resolution helpers.

The resolver is the load-bearing piece of v0.3.0's "install anywhere" goal,
so the test surface is deliberately thorough: every branch of the precedence
rule, the dev-mode detection, and the default-backup-dir derivation.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from cerefox.paths import (
    USER_STATE_DIR_NAME,
    default_backup_dir,
    ensure_user_state_dir,
    is_dev_mode,
    resolve_config_dir,
    resolve_env_file,
    user_state_dir,
)


@pytest.fixture
def clean_env(monkeypatch):
    """Remove the env-var override so each test starts from a known state."""
    monkeypatch.delenv("CEREFOX_CONFIG_DIR", raising=False)


@pytest.fixture
def empty_cwd(tmp_path: Path) -> Path:
    """A working directory with NO .env file — forces user-state-dir branch."""
    return tmp_path


@pytest.fixture
def dev_cwd(tmp_path: Path) -> Path:
    """A working directory WITH a .env file — simulates dev mode."""
    (tmp_path / ".env").write_text("CEREFOX_FOO=bar\n", encoding="utf-8")
    return tmp_path


# ── resolve_config_dir ─────────────────────────────────────────────────────


class TestResolveConfigDir:
    def test_env_override_wins_over_dev_mode(
        self, monkeypatch, tmp_path: Path, dev_cwd: Path
    ) -> None:
        """`CEREFOX_CONFIG_DIR` beats a repo-local .env."""
        explicit = tmp_path / "explicit"
        explicit.mkdir()
        monkeypatch.setenv("CEREFOX_CONFIG_DIR", str(explicit))
        assert resolve_config_dir(cwd=dev_cwd) == explicit.resolve()

    def test_env_override_expands_tilde(self, monkeypatch, empty_cwd: Path) -> None:
        """`~` in the env var is expanded relative to $HOME."""
        monkeypatch.setenv("CEREFOX_CONFIG_DIR", "~/custom-cerefox")
        result = resolve_config_dir(cwd=empty_cwd)
        assert result == (Path.home() / "custom-cerefox").resolve()

    def test_dev_mode_wins_over_user_state(self, clean_env, dev_cwd: Path) -> None:
        """Repo-local .env in CWD beats `~/.cerefox/`."""
        assert resolve_config_dir(cwd=dev_cwd) == dev_cwd.resolve()

    def test_user_state_dir_is_fallback(self, clean_env, empty_cwd: Path) -> None:
        """No override, no repo-local .env → `~/.cerefox/`."""
        result = resolve_config_dir(cwd=empty_cwd)
        assert result == (Path.home() / USER_STATE_DIR_NAME).resolve()

    def test_empty_env_value_treated_as_unset(
        self, monkeypatch, dev_cwd: Path
    ) -> None:
        """`CEREFOX_CONFIG_DIR=` (empty) does not override — falls through."""
        monkeypatch.setenv("CEREFOX_CONFIG_DIR", "")
        assert resolve_config_dir(cwd=dev_cwd) == dev_cwd.resolve()

    def test_whitespace_only_env_value_treated_as_unset(
        self, monkeypatch, dev_cwd: Path
    ) -> None:
        monkeypatch.setenv("CEREFOX_CONFIG_DIR", "   ")
        assert resolve_config_dir(cwd=dev_cwd) == dev_cwd.resolve()


# ── resolve_env_file ───────────────────────────────────────────────────────


class TestResolveEnvFile:
    def test_returns_env_under_resolved_dir(self, clean_env, dev_cwd: Path) -> None:
        assert resolve_env_file(cwd=dev_cwd) == dev_cwd.resolve() / ".env"

    def test_uses_user_state_dir_in_fallback(self, clean_env, empty_cwd: Path) -> None:
        result = resolve_env_file(cwd=empty_cwd)
        assert result == (Path.home() / USER_STATE_DIR_NAME).resolve() / ".env"


# ── user_state_dir ─────────────────────────────────────────────────────────


class TestUserStateDir:
    def test_returns_home_dot_cerefox(self) -> None:
        assert user_state_dir() == (Path.home() / USER_STATE_DIR_NAME).resolve()


# ── ensure_user_state_dir ──────────────────────────────────────────────────


class TestEnsureUserStateDir:
    def test_creates_dir_and_subdirs(self, tmp_path: Path) -> None:
        target = tmp_path / ".cerefox"
        result = ensure_user_state_dir(target=target)

        assert result == target
        assert target.is_dir()
        for sub in ("backups", "logs", "cache", "docs"):
            assert (target / sub).is_dir(), f"{sub}/ should have been created"

    def test_idempotent(self, tmp_path: Path) -> None:
        """Running twice doesn't error and doesn't destroy existing files."""
        target = tmp_path / ".cerefox"
        ensure_user_state_dir(target=target)
        (target / "backups" / "marker.txt").write_text("hello", encoding="utf-8")
        ensure_user_state_dir(target=target)  # should not raise
        assert (target / "backups" / "marker.txt").read_text() == "hello"

    def test_chmod_600_on_existing_env_file(self, tmp_path: Path) -> None:
        target = tmp_path / ".cerefox"
        target.mkdir()
        env = target / ".env"
        env.write_text("KEY=value\n", encoding="utf-8")
        env.chmod(0o644)

        ensure_user_state_dir(target=target)

        if os.name != "nt":  # chmod is a no-op on Windows
            mode = env.stat().st_mode & 0o777
            assert mode == 0o600

    def test_no_chmod_when_no_env_file(self, tmp_path: Path) -> None:
        """ensure_user_state_dir doesn't create an .env file from thin air."""
        target = tmp_path / ".cerefox"
        ensure_user_state_dir(target=target)
        assert not (target / ".env").exists()


# ── is_dev_mode ────────────────────────────────────────────────────────────


class TestIsDevMode:
    def test_true_when_env_in_cwd(self, clean_env, dev_cwd: Path) -> None:
        assert is_dev_mode(cwd=dev_cwd) is True

    def test_false_when_no_env_in_cwd(self, clean_env, empty_cwd: Path) -> None:
        assert is_dev_mode(cwd=empty_cwd) is False

    def test_false_when_env_override_set(
        self, monkeypatch, tmp_path: Path, dev_cwd: Path
    ) -> None:
        """An explicit override means we're NOT in dev mode, even if .env exists."""
        explicit = tmp_path / "explicit"
        explicit.mkdir()
        monkeypatch.setenv("CEREFOX_CONFIG_DIR", str(explicit))
        assert is_dev_mode(cwd=dev_cwd) is False


# ── default_backup_dir ─────────────────────────────────────────────────────


class TestDefaultBackupDir:
    def test_dev_mode_uses_cwd_backups(self, clean_env, dev_cwd: Path) -> None:
        """Dev mode preserves the pre-v0.3.0 `./backups` default."""
        assert default_backup_dir(cwd=dev_cwd) == (dev_cwd / "backups").resolve()

    def test_user_state_mode_uses_home_backups(
        self, clean_env, empty_cwd: Path
    ) -> None:
        result = default_backup_dir(cwd=empty_cwd)
        assert result == (Path.home() / USER_STATE_DIR_NAME / "backups").resolve()

    def test_env_override_routes_to_override_backups(
        self, monkeypatch, tmp_path: Path, dev_cwd: Path
    ) -> None:
        """`CEREFOX_CONFIG_DIR=/x` → backup dir is `/x/backups`."""
        explicit = tmp_path / "explicit"
        explicit.mkdir()
        monkeypatch.setenv("CEREFOX_CONFIG_DIR", str(explicit))
        assert default_backup_dir(cwd=dev_cwd) == explicit.resolve() / "backups"


# ── regression: the repo itself looks like dev mode ────────────────────────


class TestRegression:
    def test_repo_root_is_dev_mode(self) -> None:
        """Sanity: when run from the repo root with .env present, we're in dev mode.

        This test is what guarantees existing dev users see no behavior change
        in v0.3.0. If it ever fails, the backward-compat invariant is broken.
        """
        repo_root = Path(__file__).resolve().parents[1]
        if (repo_root / ".env").is_file():
            assert is_dev_mode(cwd=repo_root) is True
            assert resolve_config_dir(cwd=repo_root) == repo_root.resolve()
        else:
            pytest.skip("No repo-local .env present — can't validate dev-mode branch")
