# CLI ↔ Web parity audit (iter-27 / v0.9.0)

> **Historical snapshot (v0.9.0).** Parity as of the v0.9.0 CLI rename. The gaps
> deferred below have since **shipped**: `cerefox document edit`, `cerefox document
> restore`, and `cerefox project create/edit/delete` (v0.9.1), and later `cerefox
> document set-projects` (CLI parity with the `cerefox_set_document_projects` MCP
> tool); `cerefox_metadata_search` can now also list a project's documents. Treat
> the tables below as a point-in-time record — the live parity reference is the
> CLI↔MCP matrix in [`docs/guides/cli.md`](../guides/cli.md).

Produced for the v0.9.0 rename-only CLI redesign. Maps every web-UI surface to
its CLI equivalent and vice-versa, and records the gaps. Conclusion up front:
**the only real web→CLI gaps map to the new commands already deferred to
v0.9.1** (`document edit`, `document restore`, project create/edit) — so
**no in-scope gap-closures are needed for v0.9.0** (Part 27D closes zero).

## Web UI → CLI

| Web page (`frontend/src/pages`) | CLI equivalent | Status |
|---|---|---|
| `SearchPage` | `cerefox search` | ✓ parity |
| `DocumentPage` (view + version history) | `cerefox document get` · `cerefox version list` | ✓ parity |
| `IngestPage` | `cerefox document ingest` (+ `ingest-dir`) | ✓ parity |
| `ProjectsPage` / `ProjectDocumentsPage` | `cerefox project list` · `project delete` | ◑ partial — web also **creates/edits** projects; no CLI `project create/edit` |
| `MetadataSearchPage` | `cerefox metadata search` (+ `metadata keys`) | ✓ parity |
| `AuditLogPage` | `cerefox audit list` | ✓ parity |
| `DocumentEditPage` | — | ✗ gap → **v0.9.1 `document edit`** |
| `TrashPage` (restore / purge) | — | ✗ restore → **v0.9.1 `document restore`**; purge stays **web-only by design** (human-in-the-loop destructive op) |
| `AnalyticsPage` | — | web-only **by design** (charts) |
| `DashboardPage` | `cerefox status` / `doctor` (partial overlap) | web-only overview **by design** |
| `HelpPage` | `cerefox docs` (CLI) · `cerefox_get_help` (MCP) | ✓ parity |

## CLI → Web

| CLI command/group | Web equivalent | Status |
|---|---|---|
| `search`, `document get/list/delete/ingest`, `project list/delete`, `version list`, `metadata keys/search`, `audit list` | corresponding pages above | ✓ parity |
| `config get/set` | (no web config editor) | CLI-only — acceptable (runtime config is operator-level) |
| `backup create/restore` | — | CLI-only **by design** (operational) |
| `server deploy/reindex` | — | CLI-only **by design** (operational) |
| `init`, `doctor`, `status`, `configure-agent`, `self-update`, `mcp`, `web`, `completion`, `sync-docs`, `sync-self-docs` | — | CLI-only **by design** (lifecycle/local) |

## Gaps + dispositions

| Gap | Disposition |
|---|---|
| CLI has no `document edit` (web `DocumentEditPage`) | Deferred → **v0.9.1** (`document edit`). |
| CLI has no `document restore` (web Trash restore) | Deferred → **v0.9.1** (`document restore`). |
| CLI has no `project create` / `project edit` (web Projects) | Deferred → v0.9.1 candidate (additive; low demand — projects are usually created implicitly on ingest). |
| Trash **purge**, Analytics, Dashboard | Intentionally web-only (destructive human-in-loop / visualization). |
| `backup`, `server`, lifecycle | Intentionally CLI-only (operational). |

**Part 27D outcome:** no small must-fix closures for v0.9.0. Every actionable
gap is an *additive new command* already captured in the v0.9.1 scope block
(plan.md, Iteration 27). Pulling any forward would violate the rename-only
decision (L1) for v0.9.0.
