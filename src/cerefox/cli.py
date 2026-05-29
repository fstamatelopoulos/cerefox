"""Cerefox command-line interface (Python — legacy, frozen at v0.9.0).

The Python CLI is **retired** as of v0.9.0. Every subcommand except ``mcp``
is now a husk that points at the canonical TypeScript CLI shipped as
``@cerefox/memory`` on npm::

    npm install -g @cerefox/memory      # or: bun install -g @cerefox/memory

The only command that still does real work here is ``cerefox mcp`` — the
in-tree Python MCP server, kept as a repo-clone fallback for people migrating
to the TS world. It is unmaintained and frozen; new development happens in the
TS implementation. See ``docs/guides/migration-v0.9.md``.
"""

from __future__ import annotations

import click

from cerefox import __version__

# old Python verb → new TypeScript CLI form (resource-verb, v0.9.0).
_RENAMED: dict[str, str] = {
    "ingest": "document ingest",
    "ingest-dir": "document ingest-dir",
    "search": "search",
    "list-docs": "document list",
    "delete-doc": "document delete",
    "list-projects": "project list",
    "list-metadata-keys": "metadata keys",
    "metadata-search": "metadata search",
    "config-get": "config get",
    "config-set": "config set",
    "reindex": "server reindex",
    "get-doc": "document get",
    "list-versions": "version list",
    "get-audit-log": "audit list",
    "web": "web",
    "docs": "docs",
}


@click.group()
@click.version_option(version=__version__, prog_name="cerefox")
def cli() -> None:
    """Cerefox — user-owned shared memory for AI agents.

    .. deprecated:: 0.9.0
       The Python CLI is retired. All subcommands except ``mcp`` are husks
       that redirect to the TypeScript CLI (``@cerefox/memory`` on npm). The
       Python MCP server (``cerefox mcp``) stays as a frozen repo-clone
       fallback. See ``docs/guides/migration-v0.9.md``.
    """


def _make_husk(old_name: str, new_form: str) -> click.Command:
    """Build a husk command: print a redirect to the TS CLI and exit 1."""

    @click.command(
        name=old_name,
        context_settings={"ignore_unknown_options": True, "allow_extra_args": True},
        help=f"Removed in v0.9.0 — use the TypeScript CLI `cerefox {new_form}`.",
    )
    @click.argument("args", nargs=-1, type=click.UNPROCESSED)
    def _husk(args: tuple[str, ...]) -> None:  # noqa: ARG001 — args swallowed on purpose
        click.echo(
            f"✗  `cerefox {old_name}` (Python CLI) was removed in v0.9.0.\n"
            f"   Use the TypeScript CLI:  cerefox {new_form}\n"
            f"   Install it once:         npm install -g @cerefox/memory\n"
            f"   (The Python MCP server still works: `uv run cerefox mcp`.)\n"
            f"   Migration guide: "
            f"https://github.com/fstamatelopoulos/cerefox/blob/main/docs/guides/migration-v0.9.md",
            err=True,
        )
        raise SystemExit(1)

    return _husk


for _old, _new in _RENAMED.items():
    cli.add_command(_make_husk(_old, _new))


# ── mcp (the one command that still runs) ──────────────────────────────────────


@cli.command("mcp")
def mcp_server() -> None:
    """Start the Cerefox MCP server (Python; stdio transport).

    The in-tree Python MCP server — functionally identical to the TS MCP
    server in ``@cerefox/memory`` (same 10 tools, same wire shapes). Kept as a
    frozen, offline / no-npm repo-clone fallback. Configure your MCP client to
    invoke ``uv run cerefox mcp``.
    """
    _run_mcp()


def _run_mcp() -> None:
    """Start the in-tree Python MCP server."""
    from cerefox.mcp_server import run  # noqa: PLC0415

    run()
