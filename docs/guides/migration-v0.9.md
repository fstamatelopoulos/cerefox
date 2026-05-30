# Migrating to v0.9.0

v0.9.0 is the **contract-hardening release** before v1.0. Two user-visible
changes: the CLI moved to a **resource-verb** shape, and the **Python surfaces
were retired** to husks. Nothing about your data, schema, or Edge Functions
changes — this is a client/CLI release.

> **TL;DR**
> - CLI verbs renamed: `cerefox get-doc X` → `cerefox document get X`, etc. The
>   old names still run but print the new form and exit non-zero. (Removed in v1.0.)
> - The **Python** `cerefox` CLI (except `mcp`) and the Python web app are now
>   husks that redirect to the TypeScript CLI. `uv run cerefox mcp` still works.

## 1. CLI verb rename (TypeScript CLI)

The flat verbs are now grouped under a resource. **Pure rename — no behavior
changed, no flags changed.** Old names are hidden husks that fail loudly with a
pointer:

```
$ cerefox get-doc abc
✗ `cerefox get-doc` was renamed in v0.9.0.
  Use `cerefox document get` instead (run `cerefox document --help`).
```

| Old (v0.8) | New (v0.9) |
|---|---|
| `cerefox get-doc <id>` | `cerefox document get <id>` |
| `cerefox list-docs` | `cerefox document list` |
| `cerefox delete-doc <id>` | `cerefox document delete <id>` |
| `cerefox ingest <path>` | `cerefox document ingest <path>` |
| `cerefox ingest-dir <dir>` | `cerefox document ingest-dir <dir>` |
| `cerefox list-projects` | `cerefox project list` |
| `cerefox delete-project <name>` | `cerefox project delete <name>` |
| `cerefox list-versions <id>` | `cerefox version list <id>` |
| `cerefox list-metadata-keys` | `cerefox metadata keys` |
| `cerefox metadata-search …` | `cerefox metadata search …` |
| `cerefox get-audit-log` | `cerefox audit list` |
| `cerefox config-get <key>` | `cerefox config get <key>` |
| `cerefox config-set <k> <v>` | `cerefox config set <k> <v>` |
| `cerefox backup [dir]` | `cerefox backup create [dir]` |
| `cerefox restore <file>` | `cerefox backup restore <file>` |
| `cerefox deploy-server` | `cerefox server deploy` |
| `cerefox reindex` | `cerefox server reindex` |

**Unchanged (still flat):** `search`, `init`, `doctor`, `status`,
`configure-agent`, `self-update`, `mcp`, `web`, `completion`.

**Action:** update any scripts/aliases. Re-run `cerefox completion install`
(v0.9.1+) or `cerefox completion <shell>` to refresh tab-completion (it includes
the new groups; the old names remain as "renamed" hints). The husks are removed
in **v1.0**, so migrate now.

### Also changed in v0.9.1

| Old (v0.9.0) | New (v0.9.1) |
|---|---|
| `cerefox version <verb>` | `cerefox document version <verb>` (versions belong to a document) |
| `cerefox docs <topic>` | `cerefox guides open <topic>` / `cerefox guides show <topic>` |
| `cerefox docs --list` | `cerefox guides list` |
| `cerefox sync-self-docs` | `cerefox guides ingest` |
| `cerefox sync-docs` | **removed from the CLI** — repo-clone contributor op; use `bun scripts/sync_docs.ts` |

**New commands added in v0.9.1** (additive): `document edit` (`--title` /
`--set-meta key=value` / `--unset-meta key` — non-destructive metadata patch),
`document restore` (undelete), `document version archive`/`unarchive`,
`project create`/`edit`, `config list`, `cerefox search --only-metadata`, and
`cerefox completion install` (auto-wires shell tab-completion). (`document
restore` and `version archive`/`unarchive` actually shipped in v0.9.0.)

## 2. Python surfaces retired

The Python implementation has been superseded by the TypeScript runtime since
v0.6–v0.8. In v0.9.0:

- **Python CLI** — every `uv run cerefox <cmd>` **except `mcp`** is now a husk
  that points at the TypeScript CLI (`npm install -g @cerefox/memory`). The
  `CEREFOX_NO_DEPRECATION_BANNER` env var is gone (the husks replace it).
- **Python web app** — removed. `cerefox.api.app` is a husk; use the TypeScript
  `cerefox web`.
- **Python MCP server** — **still works.** `uv run cerefox mcp` launches the
  in-tree Python MCP server, kept as a frozen, offline / no-npm repo-clone
  fallback. It is unmaintained going forward; the TypeScript MCP server
  (`cerefox mcp` from `@cerefox/memory`, or the remote `cerefox-mcp` Edge
  Function) is canonical.
- **Tests** — `pytest` is retired as a test runner; the suite is `bun test`.
  `pyproject.toml` / `uv.lock` / `.python-version` stay (the Python MCP runtime
  remains).

**If you only use Cerefox via the installed `@cerefox/memory` CLI / MCP:** the
Python changes don't affect you at all.

**If you `git pull` and run from source:** `uv run cerefox mcp` is the only
Python command that still does work; everything else redirects you to the npm
CLI.
