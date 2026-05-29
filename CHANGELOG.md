# Changelog

All notable changes to Cerefox are documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — all `v0.x` releases may include breaking changes.

---

## [Unreleased]

### Fixed

- `cerefox doctor` no longer warns that the Edge Functions are "older than this
  client" right after a fresh redeploy. The EF version check baselined the
  deployed EF version against the npm package version (`PKG_VERSION`) instead of
  the version of the Edge Functions the package actually bundles (`EF_VERSION`).
  Because a client-only release bumps `PKG_VERSION` without changing the EFs,
  doctor flagged up-to-date EFs as stale. Now baselined against `EF_VERSION`.

---

## [v0.8.1] -- 2026-05-29

**v0.8.1 — deploy-server handles updates, not just fresh installs.** Fixes a
gap in v0.8.0: `cerefox deploy-server` only ever did a *fresh* deploy (apply
schema + RPCs, then stamp every migration as already-applied). Run against a
database that already had a Cerefox schema, it silently re-stamped migrations
without running them — so a release that shipped a new migration never applied
it. `deploy-server` is now the catch-all for both standing up *and updating*
the server side.

### Added

- `cerefox delete-project <name-or-id>` — new CLI subcommand. Looks up by
  UUID or exact name; refuses if documents are still linked unless `--force`;
  `--yes` skips the prompt for scripts. Symmetric to the existing Projects page
  DELETE action in the web UI. Used by `write-commands.test.ts` to reap the
  `_e2e-v0.5` test project so prior runs don't leave stray projects behind.

### Changed

- **`cerefox deploy-server` detects fresh vs. existing databases.** On a fresh
  database it deploys schema + RPCs and stamps migrations (unchanged). On a
  database that already has a Cerefox schema it applies any *pending*
  migrations (each in its own transaction) and re-applies `rpcs.sql` to refresh
  the RPCs — i.e. an in-place update. Re-running after a release that changes
  RPCs and/or adds a migration now does the right thing; no separate migrate
  step is needed. The dry-run plan shows which path will run and lists pending
  migrations.
- **`cerefox doctor`** relabels the `schema` row to `schema + RPCs` and now
  classifies the deployed schema/RPC version against the client's required
  minimum (error if below) and bundled version (warning if older). When the
  schema and/or Edge Functions are out of date, doctor prints a single
  consolidated remediation line: `cerefox deploy-server` when both are stale,
  or the matching `--schema-only` / `--functions-only` when only one is.
- **`cerefox web` log lines now carry a local-time timestamp**
  (`YYYY-MM-DD HH:mm:ss.SSS`) — both the per-request logger and the
  start/shutdown lines. Makes the daemon log (`~/.cerefox/web.log`) readable
  after the fact (previously lines like `Received SIGTERM; shutting down` had
  no time).

### Removed

- **`cerefox deploy-server --reset`.** The destructive drop-everything flag is
  gone from the user-facing command — a full wipe is a contributor/recovery
  operation. It remains in the low-level `bun scripts/db_deploy.ts --reset`
  (repo clone only, behind its typed-`yes` guard).

### Internal

- Extracted `runDbMigrate`, `migrationStatus`, `detectExistingSchema`, and
  `applyRpcs` into `_shared/db-deploy/` so the `deploy-server` command and the
  low-level `scripts/db_migrate.ts` share one implementation. `db_migrate.ts`
  is now a thin wrapper (with a new `--status` flag).

---

## [v0.8.0] -- 2026-05-29

**v0.8.0 — "Production-Ready Install".** The npm package can now stand up
the entire Cerefox server side without a repo clone, every server surface
is versioned with a client↔server compatibility matrix, and `cerefox web`
gains background daemon mode.

> **⚠ Upgrading requires a server redeploy.** v0.8 changes the Edge
> Functions (adds `GET /version` to all 9) and ships them bundled in the
> npm package. After upgrading the client, redeploy the server so the
> compatibility checks pass:
>
> ```bash
> cerefox deploy-server              # schema + RPCs + all 9 Edge Functions
> # or just the functions, if your schema is already current:
> cerefox deploy-server --functions-only
> ```
>
> Until you redeploy, `cerefox doctor` reports the Edge Functions as
> "predate v0.8" (non-blocking) and the version aggregator is unavailable.

### Added

- **`cerefox deploy-server`** — deploys the schema + RPCs (in-process) and
  all 9 Edge Functions (`npx supabase functions deploy`) from assets
  bundled in the npm package. Comprehensive pre-flight (Node/npx, Supabase
  CLI, login, link, env vars, secrets) prints one all-or-nothing
  remediation list. Flags: `--dry-run`, `--reset`, `--schema-only`,
  `--functions-only`. Eliminates the repo-clone requirement for fresh
  installs.
- **Server-side asset bundling** — `dist/server-assets/` ships `schema.sql`,
  `rpcs.sql`, `migrations/`, and `supabase/functions/` (with the `_shared`
  subtrees the EFs import), mirroring the repo's relative layout so EF
  imports resolve from the bundled copy.
- **`GET /version` on every Edge Function** — `{name, version}`; plus an
  aggregator on `cerefox-mcp` (`GET /version?peers=true`) returning the
  schema version + all peer EF versions in one round-trip.
- **Client ↔ server compatibility matrix** (`_shared/compatibility/`) —
  `cerefox doctor` asserts deployed schema + EF versions against the
  client's `minSchema`/`minEdgeFunctions`; `cerefox web` refuses to bind
  against a below-min server; the `SchemaVersionBanner` is now two-tier
  (red below-min, yellow above-min-but-old). Bump policy in CONTRIBUTING.
- **`cerefox web start/stop/status`** — background daemon mode. Pidfile
  `~/.cerefox/web.pid`, append-only log `~/.cerefox/web.log`, graceful
  SIGTERM→SIGKILL stop, stale-pidfile detection. Bare `cerefox web` stays
  foreground. Unix-first (Windows daemon is a follow-up).
- **`cerefox init` auto-offers `deploy-server`** when the schema is missing
  (404) or below `minSchema`. Existing, compatible installs see no prompt.
- **`scripts/cerefox_export.ts`** — one-way export of every document to a
  folder of markdown files (one folder per project; multi-project docs
  duplicated). For easy local copies/backups; `backup_create/restore`
  remain the JSON round-trip path.
- **`RELEASING.md`** — maintainer release playbook (versioning model,
  pre-release checklist, cut steps, post-release verification, rollback).

### Changed

- **`scripts/backup_create.py` / `backup_restore.py` → TypeScript.** The
  backup module ported to `_shared/backup/` (+ `scripts/backup_*.ts`);
  identical JSON format (`version: 1`) so backups round-trip across
  runtimes. Python scripts become husks; `fs_backup.py` removed.
- **`cut_release.ts`** bumps `EF_VERSION` only when Edge Function source
  changed since the last tag (client-only releases leave it untouched).
- **Test-runner cutover (phase 1)** — the Edge Function, remote-MCP, and
  UI e2e suites are ported from pytest to TS (`bun test` +
  `@playwright/test`); the Python originals are removed. The Python API
  e2e (`test_api_e2e.py`) stays for now.
- `resolveSpaDist` prefers the repo's fresh `frontend/dist` over a stale
  `packages/memory/dist/frontend` bundle in source mode (dev-UX).

### Fixed

- The two state-dependent `write-commands.test.ts` flakes (leftover
  `[E2E v0.5-test]` docs tripping the v0.7 content-hash collision check)
  — the suite now hard-purges them before/after.

### Deprecated

- The Python CLI deprecation banner's policy text updated: the CLI stays
  functional through v0.8; subcommands become husks in v0.9. (The Python
  **MCP server** is NOT deprecated — it stays as a repo-clone fallback
  through v1.x.)

---

## [v0.7.2] -- 2026-05-29

**v0.7.2 — "Docs honesty + web-server glitches".** README correction
on npm, two SchemaVersionBanner/Layout fixes, plus three web-server
glitches surfaced during v0.7.1 testing (favicon routing, in-app logo
broken on npm installs, no request logging).

### Docs

- npm `@cerefox/memory` README rewrites for v0.7.2:
  - Distinguishes the server side (Postgres schema + RPCs + Edge Functions,
    shipped with the source repo) from the client side (this package). Adds
    the clone-and-deploy step explicitly — a fresh `npm install -g
    @cerefox/memory` is not enough to stand up Cerefox; the user also needs
    to clone the repo, run `bun scripts/db_deploy.ts`, and deploy the 9 Edge
    Functions.
  - Adds a "Why cloud-backed?" paragraph explaining the design rationale —
    same memory reachable from every agent on every device via hybrid
    (semantic + full-text) search.
  - Single-binary table now includes `cerefox web` (the in-process Hono
    server + bundled React UI — was missing despite shipping in v0.6).
  - `configure-agent` block lists all 5 writers (Claude Code, Claude
    Desktop, Cursor, Codex CLI, Gemini CLI); drops the stale "Cursor /
    Codex / Gemini ship in a follow-up" note (they shipped in v0.6).
  - Drops the stale "Schema deploy (v0.5)" callout that promised v0.6
    would port the deploy logic (v0.7 actually did).
  - Minor fixes: `cerefox doctor` description completed; "Path C in the
    architecture" parenthetical dropped (unexplained).

### Fixed

- **Favicon now actually loads.** v0.7.1 added the asset and the
  `<link rel="icon">` to `frontend/index.html`, but `cerefox web`'s
  middleware order had `/app/*` catch-all returning `index.html` for
  every `/app/*` path — including `/app/cerefox_icon.png`. The catch-all
  ran before any file-serving middleware for the SPA root. A new
  `serveStatic` for `spaDist` at the SPA root is registered before the
  catch-all; Hono falls through on 404 so React-router paths like
  `/app/projects` still hit the catch-all correctly.
- **In-app logo loads on npm installs.** The header in `Layout.tsx`
  referenced `/static/cerefox_logo.jpg`, which only resolves when the
  repo's `web/static/` directory is reachable. The npm tarball doesn't
  ship `web/static/`, so npm users saw a broken image. Switched the
  reference to `/app/cerefox_icon.png` — the same asset bundled with
  the SPA in v0.7.1 — so it works on both source and installed paths.
- **`cerefox web` logs requests.** The Python web server logged each
  HTTP request via uvicorn; the v0.6 Hono port had no logger
  middleware so the foreground server was silent. Added Hono's
  `logger()` middleware (writes one line per request to stderr,
  matching the uvicorn UX). Skipped under `NODE_ENV=test` so smoke
  tests stay quiet.
- Web UI's `SchemaVersionBanner` now points at `bun scripts/db_deploy.ts`
  instead of the v0.7.0 husk `uv run python scripts/db_deploy.py`. The
  banner only fires on schema mismatch (uncommon), but when it does the
  hint should run.

---

## [v0.7.1] -- 2026-05-28

**v0.7.1 — "Post-release polish".** Cleanup pass after v0.7.0: a real
Postgres DDL probe in `cerefox doctor` (replacing the stale "deferred to
v0.6" placeholder), spinner UX on the long-running diagnostic commands, the
favicon is back in the TS web server, the metadata `Key` field on Document
Edit no longer rejects new strings, and the README catches up to v0.7.0.

### Fixed

- `cerefox doctor` postgres check now runs a real DDL connectivity probe via
  the `postgres` (Porsager) client (the same one `scripts/db_deploy.ts` uses)
  instead of printing the stale "DDL check deferred to v0.6 (use `uv run
  scripts/db_status.py` for now)" message. Reports the live Postgres version
  banner on success and a hint about Session Pooler vs Transaction Pooler on
  failure.
- Document Edit page: the metadata `Key` input no longer rejects values that
  don't match an existing key. Was `<Select>` (which restricts to the data
  set); now `<Autocomplete>` (free typing; existing keys are shown as
  suggestions for consistency, not as a constraint).
- Web favicon (the fox) is back. The Python web server served it via
  `web/static/cerefox_logo.jpg`, which never made it into the
  `@cerefox/memory` npm bundle. v0.7.1 ships the asset as
  `frontend/public/cerefox_icon.png` so it's part of the SPA bundle and
  serves on both source and installed paths.

### Changed

- `cerefox doctor` and `cerefox status` show an `ora`-driven spinner that
  updates per check (`Probing Supabase Data API [6/10]`). Same pattern as
  `scripts/db_status.ts`. Skipped automatically in `--json` mode and when
  stderr isn't a TTY (CI redirects).
- `runAllChecks()` / `runFastChecks()` in `packages/memory/src/cli/util/checks.ts`
  gained an `onProgress` callback option. Existing callers without the option
  still work.

### Docs

- README rewrites: marks v0.7.0 as current; splits the v0.6/v0.7 roadmap row
  into shipped rows with their actual scope; updates the Quickstart to list
  all 5 `configure-agent` writers (Claude Code, Claude Desktop, Cursor, Codex,
  Gemini); replaces `uv run python scripts/db_deploy.py` with
  `bun scripts/db_deploy.ts`; flips the "Local stdio MCP" example from
  `uv --directory /path/to/cerefox run cerefox mcp` to `cerefox mcp` (or
  `npx --package=@cerefox/memory cerefox mcp`); rewrites the "Building from
  source" prerequisites table so Bun is primary and Python is the
  contributor-only path.

---

## [v0.7.0] -- 2026-05-28

**v0.7.0 — "TS Ingestion Pipeline" (last big Python component).** The
chunking + embedding orchestration + version snapshotting move to TS.
Completes the v0.6 TS web by swapping the 3 ingestion endpoints' 503
stubs for in-process pipeline calls. `cerefox ingest` and
`cerefox ingest-dir` no longer round-trip to the Edge Function — they
call the in-process pipeline directly. `cerefox reindex` (a v0.5
deferred stub) now works.

Python parity is enforced at the chunker boundary (12 fixtures,
byte-identical output across Python / TS / EF chunkers), the embedding
boundary (cosine similarity ≥ 1 - 1e-6 against a captured Python
reference), and the `content_hash` algorithm (promoted from v0.6's
inline `normalizeForHash` to `_shared/ingest/pipeline-helpers.ts` so
the v0.6 /edit short-circuit + v0.7 pipeline share one
implementation).

PDF/DOCX support dropped. Python web prints a deprecation banner at
startup. **Python MCP server stays fully functional** per the
"Python minimization, not removal" policy — repo-clone users keep
`uv run cerefox mcp`.

### Added

- **TS chunker at `_shared/ingest/chunker.ts`** — byte-identical to
  Python's `chunking/markdown.py` for all 12 captured fixtures.
  Code-point-based length matching Python's `len()`.
- **96-chunk batching in `_shared/embeddings/embedBatch`** — matches
  Python's `CloudEmbedder.BATCH_SIZE`.
- **TS ingestion pipeline at `packages/memory/src/ingestion/
  pipeline.ts`** — 3 public methods (`ingestText`, `updateDocument`,
  `ingestFile`) mirroring Python's pipeline. Project-ID resolution
  follows issue #38 precedence. Review-status auto-transition (agent
  → pending_review). Title-boosted embeddings.
- **`_shared/ingest/pipeline-helpers.ts`** — `normalizeForHash`,
  `contentHash`, `deriveSourcePath`, `resolveProjectIds`.
- **`packages/memory/src/ingestion/client-bridge.ts`** — TS analog
  of the 14 `CerefoxClient` methods the pipeline uses.
- **`cerefox reindex` CLI** — replaces the v0.5 deferred stub.
- **`packages/memory/test/web-integration/ingest.test.ts`** — 5 HTTP-
  boundary tests for the 3 unblocked endpoints.

### Changed

- **3 web `/api/v1/ingest*` endpoints** swap from v0.6's 503 stubs to
  real handlers. Frontend's `V07IngestionDeferredError` toast detector
  stays as dead code.
- **`/edit` content-change branch** swaps from 503 to in-process
  `pipeline.updateDocument`.
- **`cerefox ingest` + `cerefox ingest-dir`** switch from EF-route to
  in-process pipeline. Output strings preserved.

### Removed

- **PDF / DOCX support** — `chunking/converters.py` (357 lines) +
  `tests/chunking/test_converters.py` (24 tests) deleted. CLI's
  `.pdf` / `.docx` branches now print a clear "dropped in v0.7.0"
  error pointing at pandoc / docling.

### Deprecated

- **Python FastAPI web** (`src/cerefox/api/app.py`) prints a yellow
  ⚠ deprecation banner at startup. Stays through v0.7.x / v0.8 as a
  husk; possible deletion in v0.9 per iter-26.

### Known limitations (deferred to v0.7.1 / v0.8)

- `scripts/db_deploy.py`, `db_migrate.py`, `backup_create.py`,
  `backup_restore.py`, `reindex_all.py` still Python. Port deferred
  to a v0.7.1 patch.
- `tests/chunking/test_markdown.py`, `tests/embeddings/`,
  `tests/ingestion/`, `tests/retrieval/`, `tests/db/test_versioning.py`,
  `tests/db/test_audit_and_governance.py` still in pytest. Port to
  TS deferred to v0.7.1 / v0.8.
- 2 state-dependent flakes in `write-commands.test.ts` carry over
  from iter-25G. The TS pipeline's content-hash collision check is
  stricter than the legacy EF route (correct per Python parity);
  test harness needs cleanup in a follow-up.

---

## [v0.6.0] -- 2026-05-28

**v0.6.0 — "TS Web Server" (FastAPI → Hono).** The local web server, the
last big runtime component still on Python after v0.5, moves to
TypeScript on Bun. `cerefox web` boots an in-process Hono server instead
of shelling out to a Python FastAPI process; the React SPA is now
bundled into `@cerefox/memory` so the web UI installs alongside the
CLI in a single npm package.

32 of 35 `/api/v1/*` endpoints port with response-shape parity. The
remaining 3 — `/ingest`, `/ingest/file`, `/documents/{id}/upload` —
return **503 with a friendly "Ingestion lands in v0.7" body**: the web
UI surfaces a Mantine toast pointing users at the working CLI fallback
(`cerefox ingest <file>`, which hits the Edge Function and works
fully), and `uv run cerefox web` keeps the Python web available for
the few days between v0.6 and v0.7. v0.7 swaps the stubs for in-process
pipeline calls; no frontend changes will be needed (the toast just
stops firing).

**No Python web deprecation banner yet.** Deferred to v0.7's Part 25L
when the TS web becomes a complete replacement (after the in-process
ingestion swap). The v0.5.0 generic Python CLI deprecation banner is
unchanged — `uv run cerefox web` users see the same one-line ⚠ banner
they did before.

### Added

- **TS web server in `@cerefox/memory`**: Hono on Bun, lives at
  `packages/memory/src/web/`. `cerefox web --host --port --watch`
  boots in-process. Works in source mode (`bun packages/memory/src/
  bin/cerefox.ts web` from a checkout), built mode (`node dist/bin/
  cerefox.js web`), and mixed (server from source + frontend from
  built dist).
- **React SPA bundled into the npm package**: `prepublishOnly` now
  runs `bundle-docs → build-frontend → bundle-frontend → build`,
  placing `frontend/dist/` at `<pkg>/dist/frontend/`. Tarball gains
  `dist/frontend/index.html` + Vite assets + source map.
  `npm pack --dry-run` lists everything.
- **`_shared/schemas/` zod source-of-truth**: every `/api/v1/*`
  response shape is a zod schema, consumed by both the server (for
  contract-checking) and the React frontend (typed responses) via the
  Vite alias `@cerefox/schemas` → `../_shared/schemas/`.
- **Configure-agent Phase 2**: `cerefox configure-agent` now writes
  configs for `cursor`, `codex` (TOML — `~/.codex/config.toml` via
  smol-toml), and `gemini` (`~/.gemini/settings.json`). The existing
  `claude-code` + `claude-desktop` writers are unchanged.
- **Parity snapshot tests** (`packages/memory/test/parity.test.ts`):
  the 5 captured Python response fixtures from the pre-iter step
  (`packages/memory/test/fixtures/python-parity/`) zod-parse cleanly
  against the matching schemas in `_shared/schemas/`. Runs in CI
  without Supabase.
- **HTTP-boundary test suite** at
  `packages/memory/test/web-integration/`: end-to-end coverage for
  the 5 destructive endpoints (DELETE / restore / purge /
  review-status / version-archive) plus meta endpoints (/version,
  /docs, /docs/{path}, /schema-version). Spawns the bin on a random
  port; probe-and-skip when Supabase is unreachable; self-cleans via
  `[E2E web-...]` title prefix and a final purge. Migrates
  `tests/api/test_docs_endpoints.py` to TS per the new test migration
  policy.
- **Unit tests for `web/docs.ts`** at
  `packages/memory/test/web-docs.test.ts`: listBundledDocs + readDoc
  resolver + path-traversal coverage.
- **Test migration policy** in
  `docs/specs/polish-and-distribution-design.md` §19. Codifies "tests
  follow code"; HTTP-boundary tests are TS-only from v0.6 onward;
  v0.7 ports the chunking/embedding/ingestion/retrieval test suites
  with their code; v0.8 batches the EF/MCP/UI test port to TS; v0.9
  ports the remaining tests for surviving Python code (MCP server,
  CLI husks) via the subprocess pattern. **Python minimization, not
  removal** — the Python MCP server stays functional for repo-clone
  users; the Python CLI becomes husks pointing at the TS CLI;
  `pyproject.toml` stays.

### Changed

- **`_shared/config/paths.ts` level-3 dev-mode `.env` fallback**
  now requires at least one `CEREFOX_*` key in the CWD `.env` before
  honouring it. Protects users running `cerefox` from an unrelated
  Node project (whose own `.env` would otherwise silently bleed in).

### Removed

- `migration-v0.4.md` is no longer copied into the npm bundle by
  `scripts/bundle_package_docs.ts`. The historical guide stays in
  git; anyone reading docs in `@cerefox/memory` at this point is
  way past v0.4.
- `tests/api/test_docs_endpoints.py` removed — its HTTP-boundary
  coverage migrated to TS at
  `packages/memory/test/web-integration/meta.test.ts` per the new
  test migration policy.

### Deferred to v0.7

- **In-process ingestion pipeline** (chunker + embedder + version
  snapshot). Replaces the 3 web-UI 503 stubs and unblocks the Python
  web deprecation banner.
- **`db_deploy.py` port to TS** (eliminates the residual Python step
  in `cerefox init`).

---

## [v0.5.4] -- 2026-05-27

**v0.5.4 fixes `cerefox configure-agent --tool claude-code`** — the writer in
v0.5.0–v0.5.3 wrote to `~/.claude/mcp.json`, a path Claude Code never reads.
The bug shipped silently to npm because doctor scanned the same wrong path.
Anyone who ran `configure-agent --tool claude-code` on a v0.5.x release prior
to v0.5.4 needs to upgrade and re-run. See `docs/guides/migration-v0.5.md` §
"v0.5.4 fixed cerefox configure-agent --tool claude-code" for the exact
remediation.

### Fixed

- **`configure-agent --tool claude-code`** now shells out to
  `claude mcp add --scope user --` to register the server with Claude Code.
  Claude Code's user-scope MCP servers live in `~/.claude.json` (a dot-file
  in `$HOME`) under `.mcpServers`, not in `~/.claude/mcp.json`. Delegating to
  Claude Code's own CLI is future-proof (the target client knows its own
  schema) and avoids any risk of corrupting the user's 48 KB config file.
  Requires `claude` on PATH; errors gracefully with an install pointer if
  not. Defensive backup of `~/.claude.json` to `~/.claude.json.pre-cerefox.bak`
  is taken before invoking the delegated CLI.

- **`cerefox doctor` "mcp clients" check** now scans `~/.claude.json`'s
  `.mcpServers.cerefox` key (the right place) instead of `~/.claude/mcp.json`
  (the wrong place). Also tightens the success criteria to "a cerefox entry
  is registered" rather than "any file exists at the path", so doctor no
  longer reports green for an unrelated MCP config that happens to be on disk.

- **Quickstart `docs/guides/quickstart.md`** now opens with a "Two install
  paths" split (Path A — npm install for end users; Path B — source checkout
  for contributors). Previously the quickstart only documented the source
  checkout path despite v0.4's npm release.

- **`install.sh`** end-of-install message rephrased: lists both
  `configure-agent --tool claude-code` and `--tool claude-desktop`, drops the
  "Migration from v0.4" wording in favor of the more general "Upgrading from
  an earlier version?" pointer.

### Architecture

- **`ConfigWriter` interface** gains a `kind: "direct-write" | "delegated"`
  field. Direct-write writers (Claude Desktop) manage a JSON file themselves;
  delegated writers (Claude Code) shell out to the target client's CLI.
  Adding a future client (Cursor, Codex, Gemini) means picking the
  appropriate kind. The `--config-path FILE` override always forces direct-
  write — preserves the v0.5.0–v0.5.3 test surface and gives power users an
  escape hatch.

### Tests

- New tests in `packages/memory/test/lifecycle-commands.test.ts`: assert
  that `configure-agent --tool claude-code` (with no `--config-path`) is
  `action: "delegated"` and the planned command line is
  `claude mcp add cerefox --scope user -- npx ...`. Separate assertion that
  `--tool claude-desktop` stays `action: "created"` with no delegation.

---

## [v0.5.3] -- 2026-05-27

**v0.5.3 brings forward the v1.0 `.env` precedence flip for the TS CLI.**

### Changed

- **`_shared/config/paths.ts` precedence inverted**: when `~/.cerefox/.env`
  exists, it now wins over the repo-local `<cwd>/.env` (the v0.5.2
  precedence was the opposite). Existing users see **zero behavior change**
  until they run `cerefox init` and create the home file — the legacy
  dev-mode fallback (level 3 in the new ordering) catches that case
  unchanged. After `init`, the TS CLI reads from `~/.cerefox/.env` and the
  repo file becomes a Python-only fallback. Tests updated in
  `_shared/__tests__/paths.test.ts`. New helper `hasLegacyCwdEnv()` powers
  the doctor shadow-detection below. **Python `src/cerefox/paths.py` is
  deliberately unchanged** (CWD still wins there) so existing
  `uv run cerefox …` workflows keep reading the repo `.env` through the
  v0.5–v0.7 migration window.

- **`cerefox init` is migration-aware.** When the home file doesn't exist
  but `<cwd>/.env` does, init now offers a three-choice prompt instead of
  a binary overwrite:

  | Choice | What happens | Best for |
  |---|---|---|
  | `[c]` Copy to `~/.cerefox/.env` *(default)* | Copies the repo file, chmods 0600, validates against Supabase + OpenAI. Repo file untouched. | Typical Python → TS upgrade. TS uses the new home; Python keeps the repo file. |
  | `[u]` Use repo `.env` as-is | Validates the existing file. No copy, no write. | "I just want to verify the install works against my current config." |
  | `[f]` Fresh start | Ignores the existing file, prompts interactively, writes a brand-new `~/.cerefox/.env`. | Stale or wrong existing config. |

  Fresh installs (no `.env` anywhere) are unchanged — standard 5-step
  interactive flow writes `~/.cerefox/.env`. Reconfigure (home file
  already exists) is unchanged — standard overwrite confirmation.
  `CEREFOX_CONFIG_DIR` overrides still win and skip the migration prompt.

- **`cerefox doctor` reports shadowed legacy `.env`.** When both
  `~/.cerefox/.env` and `<cwd>/.env` exist (and they're not the same file
  via symlink), doctor adds an informational line:

  ```
  ℹ legacy env   /path/to/cerefox/.env (shadowed by ~/.cerefox/.env)
      → Python `uv run cerefox …` still reads this during the v0.5–v0.7
        migration window. Safe to delete in v0.9+.
  ```

  Doesn't fail doctor; just surfaces what's there.

### Docs

- `docs/guides/migration-v0.5.md` — new section "v0.5.3 migrated `.env`
  from `<repo>/.env` to `~/.cerefox/.env`" with the three-choice menu
  and the Python coexistence model.
- `packages/memory/README.md` — "Upgrading from the Python `cerefox` CLI?"
  callout pointing at the `[c]` copy flow.
- `README.md` (root) — `configure-agent --tool claude-desktop` line added
  alongside `--tool claude-code` (already shipped in v0.5.2; consolidated
  framing here).
- `src/cerefox/paths.py` docstring updated to cross-reference the v0.5.3
  TS change.

---

## [v0.5.2] -- 2026-05-27

**Hotfix.** Strips the `cerefox mcp` (Python CLI) soft wrapper. Reported
in the field: Claude Desktop fails to attach to the MCP server after
restart when the config uses `uv run --directory /path/to/cerefox cerefox mcp`
— "Could not attach to MCP server cerefox."

### Fixed

- **`cerefox mcp` (Python) no longer probes / execvp's via npx.** The
  v0.4–v0.5.1 soft wrapper tried to delegate to the npm package's TS
  MCP server when `@cerefox/memory` was installed, falling back to the
  in-tree Python server otherwise. The probe — `npx --no-install
  --package=@cerefox/memory cerefox --version` — was fundamentally
  unreliable under `uv run`-launched contexts. `uv run` prepends
  `.venv/bin/` to PATH; npx's PATH-fallback finds the venv's Python
  `cerefox` console_script when the cached @cerefox/memory version
  doesn't ship a `cerefox` bin (true for v0.4.x — only `cerefox-mcp`
  existed there). Probe reports success; execvp PATH-falls-back to
  the same Python `cerefox`; `_run_mcp()` recurses until the MCP
  client times out. Fix: strip the wrapper. `cerefox mcp` (Python)
  now directly starts the Python MCP server, period.

- **Two paths to the MCP server, both explicit:**

  | Path | Config form |
  |---|---|
  | Python in-tree MCP server | `"command": "/path/to/uv", "args": ["--directory", "/path/to/cerefox", "run", "cerefox", "mcp"]` |
  | TS MCP server (npm-installed globally) | `"command": "cerefox", "args": ["mcp"]` |
  | TS MCP server (npx ad-hoc) | `"command": "npx", "args": ["-y", "--package=@cerefox/memory", "cerefox", "mcp"]` |

  All three are functionally equivalent (same 10 tools, same wire
  shapes). Pick whichever fits your environment.

### Changed

- **`tests/test_mcp_soft_wrapper.py`** rewritten — old tests asserted
  on probe args / execvp args / fallback stderr messages; new tests
  guard against re-introducing the bug class by asserting `_run_mcp()`
  doesn't call `subprocess.run` or `os.execvp` or `shutil.which`.

- **`docs/guides/migration-v0.5.md`** gains a "v0.5.2 fixed the soft
  wrapper" section explaining the recursion bug + the explicit config
  forms.

- **`docs/guides/migration-v0.4.md`** updated to drop the "auto-delegation"
  wording. Existing v0.4 configs still work — they just start the
  Python server (which they always actually did when the probe
  succeeded under uv-launched contexts, via the PATH-fallback path
  through `.venv/bin/cerefox`, accidentally).

### Migration

No user-visible config change required. Anyone whose Claude Desktop
was broken by this on v0.5.1 needs to pull the latest `main` and
`uv sync` (or wait for v0.5.2 to land on PyPI — there is no PyPI
publish for the Python CLI yet; it's installed from the repo today,
so a `git pull && uv sync` is the upgrade path).

The npm package `@cerefox/memory@0.5.1` is unaffected — the bug was
entirely in the Python wrapper.

---

## [v0.5.1] -- 2026-05-27

**Patch release** that drops the standalone `cerefox-mcp` bin from
`@cerefox/memory`. The bin was a v0.4 design choice that became
redundant when v0.5 added `cerefox mcp` as a subcommand of the main
CLI. Same `buildServer()` factory under the hood; one bin, one entry
point, easier to reason about.

### Removed (breaking change for v0.4 → v0.5.0 MCP configs)

- **`cerefox-mcp` bin removed from `@cerefox/memory`.** It was a thin
  bin entry that called `buildServer()` directly, duplicating what
  `cerefox mcp` already does. Anyone whose MCP client config invokes
  `npx -y --package=@cerefox/memory cerefox-mcp` will see a "bin not
  found" error on v0.5.1; the one-line fix is to update `args` to
  `["-y", "--package=@cerefox/memory", "cerefox", "mcp"]`. See
  [`docs/guides/migration-v0.5.md`](docs/guides/migration-v0.5.md#upgrading-an-existing-mcp-client-config)
  for the exact diff.

### Changed

- **`cerefox configure-agent` now writes the canonical
  `cerefox mcp` invocation** in the server entry. Rerun on existing
  installs to get the updated config (the writer is non-destructive —
  it backs up to `<file>.pre-cerefox.bak` and merges).
- **Python `cerefox mcp` soft wrapper** probes via
  `npx --package=@cerefox/memory cerefox --version` (canonical form);
  on success it execvp's `npx --package=@cerefox/memory cerefox mcp`.
- **`packages/memory/package.json`**: `bin` block has one entry
  (`cerefox`). The `build:mcp` / `build:cli` partial-build scripts
  collapsed into a single `build`.
- **`stdio-smoke.test.ts`** now spawns `cerefox mcp` instead of the
  removed standalone bin.

### Why this happened so soon after v0.5.0

The standalone `cerefox-mcp` bin was kept in v0.5.0 for backward
compatibility with the v0.4 install base. On maintainer review the
day after v0.5.0 shipped, we concluded the redundancy isn't worth
preserving — npm install base for v0.5.0 was ~zero, and one-bin-with-
subcommands is the long-term vision in the design doc anyway. v0.5.1
ships the cleanup while migration friction is minimal.

### Migration in one line

Old config (v0.4 → v0.5.0):
```json
"args": ["-y", "--package=@cerefox/memory", "cerefox-mcp"]
```
New config (v0.5.1+):
```json
"args": ["-y", "--package=@cerefox/memory", "cerefox", "mcp"]
```

Or just rerun `cerefox configure-agent --tool <claude-code|claude-desktop>`.

---

## [v0.5.0] -- 2026-05-27

**TypeScript CLI release.** The Python `cerefox` CLI is now joined by a
TypeScript `cerefox` bin published inside the same `@cerefox/memory`
npm package as the v0.4 `cerefox-mcp` bin. End users on a fresh machine
can `npm install -g @cerefox/memory` (or use the one-line install
script) and have a working `cerefox` callable from any directory — no
Python install, no clone required.

The Python CLI keeps working (deprecated banner, removal v0.8/v0.9).

Migration guide: [`docs/guides/migration-v0.5.md`](docs/guides/migration-v0.5.md).

### Added

- **`cerefox` bin** in `@cerefox/memory` — 28 subcommands ported from
  the Python CLI plus 6 new lifecycle commands:
  - `cerefox init` — interactive 5-step bootstrap (Supabase URL, key,
    OpenAI key, optional Postgres URL, identity). Validates credentials
    before writing `~/.cerefox/.env` (chmod 0600). Optional `--config
    <file>.json` mode for CI / scripted setup. Calls `sync-self-docs`
    automatically.
  - `cerefox doctor` — 9 diagnostic checks (binary, runtime, version,
    config, supabase, openai, schema, postgres, mcp clients) with
    `--json` output mode.
  - `cerefox status` — fast 3-check subset of doctor (< 500ms).
  - `cerefox configure-agent --tool <claude-code|claude-desktop>` —
    writes the MCP server config for the named client, backing up
    existing config to `<file>.pre-cerefox.bak`. v0.5 Phase 1 supports
    Claude Code + Claude Desktop; Cursor / Codex / Gemini ship later.
  - `cerefox self-update` (+ first-class `cerefox upgrade` alias) —
    detects the installer (bun / npm / yarn / pnpm) and wraps the
    corresponding global-install command. Refreshes the bundled-docs
    ingest after a successful update.
  - `cerefox sync-self-docs` — Layer 2 of MCP discoverability per
    design doc §10d. Ingests bundled `AGENT_GUIDE.md`,
    `AGENT_QUICK_REFERENCE.md`, and curated `docs/guides/*.md` under
    a dedicated `_cerefox-self-docs` project so any agent connected
    via MCP can `cerefox_search "writing linkable content"`.
- **Tab completion** for bash, zsh, fish via
  `cerefox completion <shell>`. Generates a per-shell script that
  completes subcommand names + long-form flags.
- **Help-text command groups** in `cerefox --help`: READS / WRITES /
  SERVERS / LIFECYCLE / OPS. Also documents the exit-code table
  (0 ok / 1 user error / 2 system error / 3 not found) inline.
- **Bare `cerefox`** (no args) shows a state-aware welcome banner:
  detects whether config exists and suggests `cerefox init` (if not)
  or `cerefox doctor` (if so).
- **`install.sh`** — one-line install: `curl … | sh`. Bun-first with
  npm fallback. Attached to every GitHub Release as a stable asset
  (`releases/latest/download/install.sh`).
- **`packages/memory/README.md`** — npm landing card with two-bin
  overview, install paths, first-run flow, common commands.

### Changed

- **`@cerefox/memory`'s bin block now lists two bins**: `cerefox-mcp`
  (from v0.4) and `cerefox` (new in v0.5). Same package, growing
  surface — no rename, no separate publish.
- **Python `cerefox` CLI prints a one-line deprecation banner**
  pointing at the npm install path. Suppressed for `--version` /
  `--help` / `--json` / the `mcp` subcommand / when
  `CEREFOX_NO_DEPRECATION_BANNER=1` is set. The Python CLI remains
  fully functional through v0.7; removal lands in v0.8 / v0.9.
- **Web UI** (`frontend/src/hooks/useProjects.ts`) now filters
  `_`-prefixed system projects (`_cerefox-self-docs`, `_e2e-*`, …)
  from default listings via a new `isSystemProject(name)` predicate.
  Pass `includeSystem: true` to opt in.
- **`cut_release.ts`**: now tracks one `VERSION_LITERAL_FILE`
  (`packages/memory/src/meta.ts`) instead of the two from v0.4.3 —
  both bins read from the shared `PKG_VERSION` constant.
- **`prepublishOnly`** runs `scripts/bundle_package_docs.ts` to
  copy 14 curated docs/guides + the two agent docs into the
  package tree before `npm pack`. Bundled copies are gitignored.

### Deferred to v0.6 / v0.7

- **`cerefox web`** — TS web server ships in v0.6. The npm-installed
  bin prints a "use `uv run cerefox web` for now" message + exit 0.
- **`cerefox reindex`** — depends on the v0.7 TS ingestion pipeline.
  Same "use uv" message + exit 0.
- **Schema deploy in `cerefox init`** — needs Postgres direct
  connection. v0.5 prints `uv run python scripts/db_deploy.py` at
  the right moment; v0.6 ports the deploy step.
- **`configure-agent` Phase 2** — Cursor / Codex / Gemini land in
  v0.5.x or v0.6.

### Testing

105 TypeScript tests:
- 66 in `_shared/__tests__/` (cli-core, mcp-tools, db-status,
  paths, sync_docs).
- 39 in `packages/memory/test/` (stdio smoke, CLI smoke,
  read-commands live, write-commands live, lifecycle live).
- Plus the new `tests/test_python_cli_deprecation_banner.py` (9
  Python tests for the banner-suppression cases).

Manual test plan tracked at
[`docs/research/v0.7-manual-test-plan.md`](docs/research/v0.7-manual-test-plan.md).

---

## [v0.4.3] -- 2026-05-27

**Patch release.** Keeps the npm package's reported version in lockstep
with the published artifact, and tightens `cut_release.ts` so that
particular drift can't recur. Also documents an `npx`-inside-a-monorepo
quirk that surfaced during v0.4.2 verification.

### Fixed

- **`cerefox-mcp --version` now reports the actual published version.**
  v0.4.2's bin printed `0.4.0` because two version-string literals were
  hardcoded in TypeScript source —
  `packages/memory/src/server.ts` (`PKG_VERSION`) and
  `src/bin/cerefox-mcp.ts` (`VERSION`) — and only the npm package.json
  reflected the bump. `cut_release.ts` now rewrites both literals in
  lockstep with VERSION + package.json via a new
  `VERSION_LITERAL_FILES` list (prefix/suffix marker pattern, same shape
  as `NPM_PACKAGE_FILES`). Adding a new TS file with a version literal
  in the future is one append to that list.

### Note

- **`npx` from inside an npm workspace can misbehave.** Running
  `npx -y --package=@cerefox/memory cerefox-mcp` from the root of a
  surrounding npm workspace monorepo may surface `command not found`
  because npx confuses itself with the workspace's bin resolution
  context. Workarounds: run from outside any monorepo (e.g. `/tmp`),
  use `bunx` (works inside workspaces), or
  `npm install -g @cerefox/memory` + invoke `cerefox-mcp` from PATH.
  Captured in `docs/guides/migration-v0.4.md` under "Known gotchas".

---

## [v0.4.2] -- 2026-05-27

**First working npm release.** v0.4.0 published the package and
established the OIDC trusted-publisher binding on npmjs.com but shipped
without a usable `bin` field (npm ≥ 11.5 silently strips bin paths with
a `./` prefix as "invalid script name"). v0.4.2 fixes the package
manifest, the documented invocation, the publish workflow, and the
release-cutting script — all of which had to be right at once for an
end-to-end `npx … cerefox-mcp` to succeed.

> v0.4.1 was cut on the same day but never produced an npm artifact: the
> release-cutting script forgot to bump `packages/memory/package.json`'s
> own `version` field, so the publish job tried to push `0.4.0` over
> the existing release and was correctly rejected. The v0.4.1 git tag
> + GitHub Release have since been deleted; the npm version line goes
> directly from `0.4.0` (bootstrap; deprecated) to `0.4.2` (working).

### Fixed

- **`@cerefox/memory`'s `bin` entry is now actually published.** The
  v0.4.0 `package.json` declared
  `"bin": { "cerefox-mcp": "./dist/bin/cerefox-mcp.js" }` (leading
  `./`). npm ≥ 11.5 silently strips bin entries with a leading `./` as
  "invalid script name" — the warning is non-fatal so v0.4.0 published
  successfully, but the shipped tarball had NO executable bins, so
  `npx … cerefox-mcp` always failed with "command not found"
  regardless of how the invocation was framed. Fix: drop the leading
  `./` in the bin path. v0.4.2's shipped tarball includes the
  `cerefox-mcp` bin properly (verified via
  `tar -xzOf cerefox-memory-0.4.2.tgz package/package.json`).
- **`npx` invocation gains `--package=@cerefox/memory`.** Even with
  the bin restored, the docs and the Python soft-wrapper in
  `src/cerefox/cli.py` previously used the bare form
  `npx -y @cerefox/memory cerefox-mcp`. The `--package=` form is the
  explicit, unambiguous spelling required when the package name
  (`@cerefox/memory`) differs from the bin name (`cerefox-mcp`) — it
  works on every npx version and doesn't rely on the heuristic that
  interprets the second positional arg as a bin name. Two unit tests
  in `tests/test_mcp_soft_wrapper.py` pin the new probe + execvp
  argument lists.
- **`cut_release.ts` now bumps every npm package's `package.json`
  version in lockstep with `VERSION`.** New `NPM_PACKAGE_FILES`
  constant lists the published package manifests
  (`packages/memory/package.json` today; more as v0.5+ adds bins);
  each one is rewritten and `git add`-ed alongside `VERSION` and
  `CHANGELOG.md`. Tested via `--dry-run`: shows the planned bump per
  package and the corresponding `git add` line. Adding a new
  published package in the future is one append to
  `NPM_PACKAGE_FILES`.

### Changed

- **`release.yml` is OIDC-only.** With the v0.4.0 bootstrap publish
  complete and the package's Trusted Publisher entry registered on
  npmjs.com, the `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` fallback
  is removed. Every publish from v0.4.2 onward is signed by a
  short-lived OIDC token bound to this repo + workflow file, with
  sigstore provenance attached. The `NPM_TOKEN` secret can (and
  should) be removed from the repo's Actions secrets.

---

## [v0.4.0] -- 2026-05-27

**First TypeScript MCP server release.** The local MCP server is now an npm
package — [`@cerefox/memory`](https://www.npmjs.com/package/@cerefox/memory) —
built with the official `@modelcontextprotocol/sdk`. The Python `cerefox mcp`
command becomes a soft wrapper that delegates to the npm bin when available
and falls back to the legacy Python MCP server otherwise. Existing setups
keep working; new setups should use `npx -y --package=@cerefox/memory cerefox-mcp`.

Migration guide: [`docs/guides/migration-v0.4.md`](docs/guides/migration-v0.4.md).

### Added

- **`@cerefox/memory` npm package.** Local stdio MCP server published to npm.
  Single artifact (`packages/memory/`) that will grow in future iterations to
  host the TS CLI (v0.5) and web/API server (v0.6) as well; for v0.4 it
  ships the MCP server bin only. Built with Bun (`bun run build` produces a
  single ESM bundle in `dist/bin/cerefox-mcp.js`). Node ≥20 / Bun ≥1.0 at
  runtime.
- **Tenth MCP tool — `cerefox_get_help`.** Returns the contents of
  `AGENT_QUICK_REFERENCE.md` as MCP-native text, with optional case-insensitive
  H2 substring matching via the `topic` parameter. Lets agents bootstrap their
  own conventions without filesystem access. Available on both the remote
  `cerefox-mcp` Edge Function and the local `@cerefox/memory` server.
- **Shared MCP tool handlers in [`_shared/mcp-tools/`](_shared/mcp-tools/).**
  The 10 tool handlers are now a single source of truth: both the remote
  Edge Function and the local TS server import the same modules. Edge
  Function shrinks from 9 per-tool TypeScript files to a thin transport
  shim around `ALL_TOOLS`. Structural typing (`MCPSupabaseClient` interface)
  avoids Deno-vs-Node import-map gymnastics.
- **Shared embeddings helper in
  [`_shared/embeddings/`](_shared/embeddings/).** Extracted from the
  Edge Functions so the local server reuses the exact same OpenAI /
  Fireworks query-embedding path.
- **`scripts/bundle_help.ts`, `scripts/check_help_bundle.ts`,
  `scripts/check_ef_parity.ts`.** Bundle `AGENT_QUICK_REFERENCE.md` into
  `_shared/mcp-tools/get-help-content.ts` (so the npm package needs no
  filesystem access at runtime), and CI-verify both the help-bundle and the
  EF↔local tool-list parity stay in sync.
- **`packages/memory/test/stdio-smoke.test.ts`.** Spawns the built bin,
  performs a full `initialize → notifications/initialized → tools/list`
  handshake, and asserts the server reports 10 tools by name. Catches
  bundling regressions on every PR.
- **`tests/test_mcp_soft_wrapper.py`** (9 unit tests). Covers the npx-detect
  + fallback paths in `_run_mcp()` and verifies `_handle_get_help()` returns
  identical output to the TS handler (same input/output contract — only the
  transport differs).
- **`.github/workflows/release.yml`.** Manual-dispatch publish workflow that
  builds + tests the built bin, then optionally publishes to npm via OIDC
  trusted publishing (no long-lived NPM_TOKEN after the v0.4.0 bootstrap).
- **`scripts/cut_release.ts --npm-publish` flag.** Triggers the release
  workflow with `publish_to_npm=true` after pushing the tag. Default is
  off — npm publishes are explicit, never automatic.

### Changed

- **`cerefox mcp` is now a soft wrapper.** Tries `npx --no-install
  @cerefox/memory cerefox-mcp` first; falls back to the legacy Python MCP
  server with a stderr nudge if npx is missing or the package isn't
  installed. No breaking change — existing client configs keep working —
  but the recommended new-setup config switches to `npx -y @cerefox/memory
  cerefox-mcp` (see migration guide).
- **`supabase/functions/cerefox-mcp/` refactored.** Deleted nine per-tool
  TS files (one per MCP tool) plus `embeddings.ts`; the function now
  imports `ALL_TOOLS` from `_shared/mcp-tools/` and serves them through a
  thin Streamable HTTP shim. The MCP server version string is bumped to
  `0.4.0`. Identity-enforcement wrapper preserved. **Operationally
  invisible** — same 10 tools, same RPCs, same URL.
- **Repo-root `package.json` upgraded to an npm workspace declaration**
  covering `_shared/`, `packages/memory/`, and `frontend/`. Bun honours the
  same workspaces.
- **MCP JSON-RPC error code tightening.** Tools that reject missing/invalid
  parameters now return `-32602` (Invalid params) instead of `-32603`
  (Internal error). `-32602` is the JSON-RPC-spec-correct code for input
  validation failures; pre-v0.4 conflated it with handler crashes. Clients
  pattern-matching specifically on `-32603` for argument validation need to
  switch to `-32602`. Two e2e tests (`test_missing_required_param_returns_error`,
  `test_ingest_missing_content_returns_error`) updated accordingly.
- **`AGENT_QUICK_REFERENCE.md` / `AGENT_GUIDE.md`** updated to advertise
  10 tools and the new `cerefox_get_help` self-help hatch.
- **`docs/guides/connect-agents.md`** Path A-Local section restructured
  around the recommended `npx --package=@cerefox/memory cerefox-mcp` config, with the
  legacy `uv run cerefox mcp` invocation preserved as the alternative.

### Migration notes

- Existing `uv run cerefox mcp` setups: nothing to do. The same command
  now soft-wraps the npm bin when available — same behaviour, slightly
  better cold-start.
- Want the new path? Replace your client's `command`/`args` with
  `npx -y --package=@cerefox/memory cerefox-mcp`. Make sure your `.env` is in the
  CWD the client launches the server from (or pass credentials inline via
  the config's `env` block).
- See [`docs/guides/migration-v0.4.md`](docs/guides/migration-v0.4.md) for
  per-client (Claude Code, Cursor, Claude Desktop, Codex CLI) before/after
  snippets.

---

## [v0.3.1] -- 2026-05-26

**Bug-fix release.** Closes a v0.3.0 data-corruption regression introduced
by `bun scripts/db_status.ts`'s introspection probe. Defense in depth at
both the client and the RPC layer. **Requires `uv run python scripts/db_deploy.py`
once after upgrading** to pick up the new RPC guard and the bumped schema
version marker.

### Fixed

- **`bun scripts/db_status.ts` no longer creates an orphan "Untitled"
  document on first run against a database that hasn't been redeployed
  with v0.3.0 RPCs.** Root cause: the `functionExists()` check in
  `_shared/db-client/` had a "legacy fallback" path that probed each
  expected RPC by calling it with `{}` and treating non-42883 responses
  as proof of existence. PostgreSQL's `cerefox_ingest_document` accepted
  the empty-args call thanks to its all-defaults signature and inserted
  a row with title="Untitled", source="agent", 0 chunks, 0 chars before
  the probe returned. Fixed in two places:
  1. **Client-side** (`_shared/db-client/index.ts`): `functionExists` now
     returns `boolean | null`. Null means "the introspection helper RPC
     (`cerefox_pg_function_exists`) isn't deployed". The dangerous
     empty-call fallback is removed entirely. The db-status report
     surfaces "unknown" rows with a clear "run `db_deploy.py`" nudge.
  2. **Server-side** (`src/cerefox/db/rpcs.sql`):
     `cerefox_ingest_document` now refuses (`RAISE EXCEPTION` with
     SQLSTATE `22023`) any call that supplies zero chunks. Defense in
     depth — no future code path can recreate the orphan, intentionally
     or otherwise. This also closes the latent
     `list_documents`-vs-`cerefox_get_document` asymmetry that surfaced
     during the orphan investigation: if 0-chunk rows can't be created,
     the dashboard-shows-but-detail-404s state can't happen.
- **Orphan row in the maintainer's instance** (`id=459c954a-…`) was
  manually soft-deleted and purged during the investigation (no change
  in v0.3.1 itself; documented here for the timeline record).

### Added

- **`db_status.ts` shows progress while it runs.** New `ora` spinner
  with per-phase labels (`Checking tables [N/M]  cerefox_chunks` etc.)
  so the 4-5 second wait against Supabase Cloud has user-visible
  feedback. Suppressed in `--json` mode and when stdout isn't a TTY
  (cron / CI), so machine consumers stay clean. Implemented as an
  optional `onProgress` callback on `runDbStatusChecks` —
  `_shared/db-status/` stays decoupled from the spinner library.
- **Repo-root `package.json`** for script-level TS deps (separate from
  `_shared/package.json`, which owns shared-module deps). At v0.4.0
  these consolidate into a proper npm workspace.
- **`CheckStatus` extended with `"unknown"`** in `_shared/db-status/`,
  rendered with a `?` marker and a per-row "introspection helper not
  deployed" detail.

### Changed

- **Schema version**: `@version: 0.3.0` → `@version: 0.3.1` in
  `schema.sql`; the `cerefox_schema_version()` RPC returns `'0.3.1'`.
  Schema-version-mismatch banner in the web UI fires until you run
  `db_deploy.py`.
- **Deprecation-shim policy walk-back** (folded in from the
  pre-v0.3.1 [Unreleased] section): the v0.3.0 release notes announced
  hard-removal of the `sync_docs.py` / `db_status.py` shims in v0.4.0.
  That schedule is dropped. The shims stay indefinitely as migration
  aids — they continue to print the ⚠ pointer and exit with code 2,
  but no scheduled removal date exists.

### Tests

- 1 new Bun test covering the `functionExists → null → "unknown"` path
  in `db-status` (`_shared/__tests__/db_status.test.ts`).
- 3 new Python e2e tests for the zero-chunk RPC guard
  (`tests/e2e/test_api_e2e.py::TestZeroChunkGuard`). Gated behind
  `pytest -m e2e`; require live Supabase with v0.3.1 RPCs deployed.

### Upgrade notes

```bash
# Redeploy SQL to pick up the new zero-chunk guard + bumped schema version.
uv run python scripts/db_deploy.py
```

End-user impact: zero behavior change for legitimate ingests (the chunker
already produces ≥ 1 chunk for any real content). Empty-content ingests —
which previously created orphan rows — now raise a clear `22023` error
from the RPC.

### Decision Log

- **2026-05-26 — v0.3.1: never probe write-side RPCs for introspection;
  refuse zero-chunk creates at the source.** Captures the root cause
  (RPCs with all-defaults can be triggered by `{}` probes), the
  two-layer fix rationale (client stops probing; RPC refuses regardless),
  the alternative considered (whitelist read-only RPCs to probe), and
  the general lesson: don't probe by side-effect; ask the database
  directly via a typed introspection RPC. Stored in *Cerefox Decision
  Log — 2026 Q2 (Part 2)*.

---

## [v0.3.0] -- 2026-05-26

**"Install Anywhere"** — second iteration of the Polish & Distribution arc
([design](docs/specs/polish-and-distribution-design.md)). Config-state refactor,
bundled docs, first Python → TypeScript script ports, and the schema-version-
mismatch banner that closes the v0.1.19 redeploy footgun.

**Backward-compatible at every user-facing surface.** Existing
`cd /path/to/cerefox && uv run cerefox …` workflows keep working unchanged
(dev mode wins). End-user install path is otherwise the same as v0.2.0.

### Added

- **`_resolve_config_dir()` precedence and `~/.cerefox/` user-state root.** New
  `src/cerefox/paths.py` module is the single source of truth for "where does
  Cerefox look for `.env`?" Precedence (highest wins):
  1. `CEREFOX_CONFIG_DIR` environment variable (explicit override; supports `~`).
  2. Repo-local `.env` in the current working directory (dev mode).
  3. `~/.cerefox/.env` (user-state root, the new default for installed setups).
  Subdirectory layout under `~/.cerefox/`: `backups/`, `logs/`, `cache/`, `docs/`.
  `Settings.backup_dir` now defaults to `<config_dir>/backups` via a
  `default_factory` callable — dev mode preserves the pre-v0.3.0 `./backups`
  default; user-state installs route to `~/.cerefox/backups`. Explicit
  `CEREFOX_BACKUP_DIR` env var always wins.
- **`importlib.resources` for SQL files.** `scripts/db_deploy.py` and
  `scripts/db_migrate.py` now load `schema.sql`, `rpcs.sql`, and the
  `migrations/*.sql` files through `importlib.resources.files("cerefox.db")`.
  Works from any directory and from both editable installs and installed wheels.
  New empty `src/cerefox/db/migrations/__init__.py` makes the migrations
  directory an importable package.
- **Wheel-bundled assets.** New `[tool.hatch.build.targets.wheel.force-include]`
  block bundles:
  - `frontend/dist/` → `cerefox/_frontend_dist/` (the SPA assets — picked up
    by `cerefox.api.app._resolve_spa_dist()` with a repo-local fallback for
    dev mode).
  - `docs/guides/`, `AGENT_GUIDE.md`, `AGENT_QUICK_REFERENCE.md`, `README.md`
    → `cerefox/_docs/` (consumed by the bundled-docs surface below).
  - `VERSION` → `cerefox/_VERSION` (already shipped in v0.2.0).
- **Bundled documentation surface** (three entry points sharing one helper
  module, `src/cerefox/docs_resources.py`):
  - **`cerefox docs [TOPIC]` CLI command.** No arg → indexed list of bundled
    docs grouped by category. With arg → fuzzy-match by title/basename/path
    and open in the OS browser via `webbrowser.open(file://…)`. `--print`
    dumps the markdown to stdout instead.
  - **`GET /api/v1/docs`** — JSON index of bundled docs (`path`, `title`,
    `category`).
  - **`GET /api/v1/docs/{path:path}`** — raw markdown content with
    path-traversal guard (`..` segments and absolute paths return 404).
  - **`/app/help` web UI page** (React + Mantine) with category-grouped
    sidebar (Project overview / Agent integration / Guides) and a Markdown
    viewer for the selected doc. URL-driven via `/app/help/<encoded-path>`.
    New "Help" link in the web UI top nav.
  - Contributor-only docs (`CLAUDE.md`, `docs/research/*`, `docs/specs/*`,
    `docs/plan.md`, `docs/TODO.md`) are deliberately excluded from the
    bundled surface.
- **Schema-version-mismatch banner** (closes the v0.1.19 "forgot to redeploy
  RPCs" footgun):
  - `schema.sql` gains a `@version: <X.Y.Z>` marker in its header.
  - `rpcs.sql` gains `cerefox_schema_version()` returning the deployed value.
  - `GET /api/v1/schema-version` returns `{bundled, deployed, mismatch}`.
    Gracefully handles legacy deployments missing the RPC
    (`deployed=null`, `mismatch=false`, no banner).
  - New `<SchemaVersionBanner>` React component renders a yellow alert at
    the top of every web UI page when `mismatch=true`, with a prompt to run
    `uv run python scripts/db_deploy.py`. Polls every 60s so a successful
    redeploy clears the banner without a reload.
- **`_shared/` cross-context TypeScript modules** (new directory at the repo
  root, internal-only `@cerefox/_shared` workspace):
  - `_shared/config/` — TS port of `src/cerefox/paths.py` + a tiny dotenv
    loader. Mirrors the Python resolver 1:1 so `bun scripts/<name>.ts`
    finds the same `.env` the Python CLI does.
  - `_shared/db-client/` — `@supabase/supabase-js` wrapper with zod-typed
    responses. Surface includes `listProjects`, `rpc`, `tableExists`,
    `functionExists`, `rowCount`.
  - `_shared/db-status/` — pure schema-introspection module
    (`runDbStatusChecks`, `formatReport`). Imported by `scripts/db_status.ts`
    in this release and by the upcoming `cerefox doctor` command in v0.5.0.
  - 14 Bun tests under `_shared/__tests__/` cover the resolver and the
    sync_docs file-discovery snapshot.
- **First Python → TypeScript script ports**, per the §12f script-language
  policy (both scripts were extended in this iteration, so they port now):
  - **`scripts/db_status.ts`** replaces `scripts/db_status.py`. Routes through
    `_shared/db-status/`; adds `--json` for structured output; adds
    schema-version-mismatch detection.
  - **`scripts/sync_docs.ts`** replaces `scripts/sync_docs.py`. Delegates to
    the `cerefox-ingest` Edge Function (server-side embedding — no local
    OpenAI key needed for the TS script).
  - The legacy `.py` versions are now **deprecation shims** that print a
    pointer to the TS replacement and exit with code 2. Explicit failure
    forces tooling, cron, and docs to migrate rather than silently
    forwarding. The shims are kept indefinitely as a migration aid — there
    is no scheduled removal date, but the exit code stays non-zero so any
    un-migrated invocation keeps failing visibly. (The v0.3.0 PR initially
    announced a v0.4.0 hard-removal; that's been walked back to "indefinite"
    based on maintainer feedback after the release shipped.)
- **`cerefox_pg_function_exists(name TEXT) RETURNS BOOLEAN`** — new
  introspection RPC. PostgREST's 42883 error doesn't distinguish "function
  doesn't exist" from "function exists with required args"; this helper
  queries `pg_proc` directly so `db_status.ts`'s `functionExists()` check is
  reliable. Legacy deployments missing this RPC fall back to the naive
  empty-call probe.

### Changed

- **`pyproject.toml`** gains the wheel-bundling block described above and a
  new `[tool.hatch.version]` regex pattern on the VERSION file.
- **`Settings`** now reads `.env` from the resolved config dir (via
  `cerefox.paths.resolve_env_file()`) instead of a hardcoded `.env`.
  `Settings.backup_dir` is now a `default_factory`-computed value.
- **`cerefox.api.app`** picks the SPA dist via `_resolve_spa_dist()` — the
  wheel-bundled `cerefox/_frontend_dist/` wins, with `frontend/dist/` as a
  dev-mode fallback. Same pattern for `web/static/`. FastAPI's `version=`
  now reads from `cerefox.__version__` instead of a hardcoded string.
- **`scripts/cut_release.ts`** UX polish: when `current == new` (the v0.2.0
  pre-bumped case), prints a clarifying note explaining the normal workflow
  rather than the confusing `0.X.Y → 0.X.Y` arrow.
- **`docs/guides/ops-scripts.md`** reorganized: new "Two languages, one
  directory" preamble lists which scripts are TS vs Python and what runs
  each; `db_status` and `sync_docs` sections rewritten for the TS form and
  note the .py form is a deprecation shim.
- **`.env.example`** header documents the three-tier `.env` resolution and
  links to the design doc §7.
- **`CONTRIBUTING.md`** gains two new subsections: "`_shared/` —
  cross-context TypeScript modules" documenting the new directory layout,
  and "Release workflow" documenting the normal `VERSION` flow and calling
  out v0.2.0 as the one-off where VERSION was pre-bumped.

### Decision Log

- **2026-05-26 — v0.3.0: config-state refactor + first Python → TS script
  ports.** Captures: the dev-mode-wins precedence as a defensive v0.x
  choice with a planned v1.0 revisit; the choice of deprecation shims
  over hard-delete for the Python scripts (forces visible migration
  without silent forwarding); the deliberate `_shared/` scope (config,
  db-client, db-status — explicitly *not* ingest, which lands in v0.7);
  why the introspection RPC was needed for reliable function-existence
  detection. Stored in *Cerefox Decision Log — 2026 Q2 (Part 2)*.

### Upgrade notes

For end users: **run `uv run python scripts/db_deploy.py` once** after
upgrading. v0.3.0 ships two new RPCs (`cerefox_schema_version` and
`cerefox_pg_function_exists`); without the redeploy, the web UI's
schema-version banner will show "deployed: (not reported)" — the banner
correctly hides itself rather than alarming (legacy-RPC-absent path), but
`db_status.ts` will report mismatches.

For contributors:

```bash
# If you don't already have Bun (added v0.2.0):
curl -fsSL https://bun.sh/install | bash

# Install the new _shared/ TS dependencies:
cd _shared && bun install && cd ..

# Run the new TS scripts:
bun scripts/db_status.ts
bun scripts/sync_docs.ts --dry-run

# Old Python scripts now print a deprecation pointer:
uv run python scripts/db_status.py   # exits 2 with migration notice
uv run python scripts/sync_docs.py   # exits 2 with migration notice
```

---

## [v0.2.0] -- 2026-05-26

**"Real Release"** — the first iteration of the Polish & Distribution arc
([design](docs/specs/polish-and-distribution-design.md)). Foundations and the
project's first TypeScript artifact outside Edge Functions and the frontend.
**The first-ever GitHub Release for Cerefox** — `gh release list` was empty
until this tag despite 24+ prior tags being pushed.

End users are unaffected by this release. **Bun is now a contributor
prerequisite**; see [CONTRIBUTING.md](CONTRIBUTING.md).

### Added

- **`VERSION` file at repo root** — plain-text single source of truth. Read by
  `pyproject.toml` via hatchling dynamic version (`[tool.hatch.version]` with a
  regex pattern on the file); read at runtime by `src/cerefox/__init__.py`
  with a three-tier fallback (`cerefox/_VERSION` bundled in the wheel via
  `force-include` → `<repo>/VERSION` in dev mode → `importlib.metadata`). The
  result: `cerefox --version` reports the real installed version — it had been
  stuck on `0.1.0` since the v0.1.0 tag, eight tags behind reality.
- **Web UI version footer.** Small text at the bottom of every page, links to
  the matching GitHub Release. New `<VersionFooter>` component
  (`frontend/src/components/VersionFooter.tsx`) consumes a new
  `GET /api/v1/version` endpoint that returns `{version, git_commit_short,
  build_date}`. `git_commit_short` is resolved via `git rev-parse` in dev mode
  or the `CEREFOX_GIT_COMMIT` env var in CI; `build_date` is read from
  `CEREFOX_BUILD_DATE`. TanStack Query with `staleTime: Infinity` — fetched
  once per session.
- **`scripts/cut_release.ts`** — the project's first TypeScript artifact outside
  Edge Functions and the frontend, and the trigger for the new Bun contributor
  prerequisite. Bun-runnable. Implements the full 11-step release ritual from
  [design doc §12b](docs/specs/polish-and-distribution-design.md):
  preflight (clean working tree, on `main`, in sync with origin, target tag
  doesn't exist) → CHANGELOG promote `[Unreleased]` to `[vX.Y.Z] -- <today>`
  with a fresh empty `[Unreleased]` heading → commit `chore: cut vX.Y.Z` →
  annotated tag with the CHANGELOG section as the tag message → push commit
  and tag → `gh release create` with the CHANGELOG section as the notes file.
  Modes: `--check` (report current + suggested next bump), `--dry-run`
  (everything except file writes), `--yes` (skip the final push confirmation).
  Refuses to overwrite an existing tag — enforces the "force-move tags only
  on objective failure" rule from the 2026-05-25 Decision Log entry.
- **`.github/ISSUE_TEMPLATE/`** — four YAML-form templates: `bug.yml`,
  `feature.yml`, `install-problem.yml`, `question.yml`. Required fields,
  dropdowns for access-path / surface, and pre-filled labels.
- **`.github/pull_request_template.md`** with sections for Summary,
  Architecture / SemVer, Test plan, Docs, and Related. Mirrors current commit
  message conventions.
- **`CODE_OF_CONDUCT.md`** — adopts Contributor Covenant 2.1 **by reference**
  (link-out to the canonical URL at `contributor-covenant.org`) rather than
  inlining the boilerplate. This is the form used by Kubernetes, Rust,
  Microsoft VS Code, and many other large OSS projects; recognized by GitHub's
  community-standards check. Reporting contact: `fotis@innovedi.com`.
- **`.github/FUNDING.yml`** placeholder — all GitHub-supported sponsor keys
  commented out; ready to be uncommented if sponsorship is enabled later.
- **`CONTRIBUTING.md`** — three new sections:
  - *Development Setup*: now lists Python+uv, Node 20+, and **Bun 1.x** with
    their one-liner installs. Bun is needed for `scripts/*.ts`, starting with
    `cut_release.ts` in this release.
  - *SemVer & Deprecation Policy*: enumerates which surfaces are under
    contract (CLI flags, env vars, MCP tool signatures, Postgres RPC
    signatures, Edge Function HTTP shapes, `/api/v1/*` paths, DB schema) vs
    free-to-change. Aspirational pre-v1.0, binding from v1.0.0. Codifies the
    "force-move tags only on objective failure" rule from the 2026-05-25
    Decision Log entry.
  - *Script-Language Policy*: TypeScript becomes the preferred language for
    all new scripts, CLI tooling, and installer pieces from v0.2.0. Existing
    Python scripts migrate when they're extended. End users unaffected until
    v0.4.0.

### Changed

- **`SECURITY.md`** rewritten and expanded — supported-versions matrix, scope
  of in-scope vs out-of-scope security findings, threat model summary,
  response expectations. Still uses GitHub's private vulnerability reporting
  as the canonical channel.
- **`README.md`** gains a "Project status" section between Features and
  Getting Started. Roadmap table covers v0.2.0 → v1.0.0 (release themes and
  what each ships). Sets reader expectations on maturity and direction.
- **Design doc promoted from research to design-of-record**:
  `docs/research/polish-and-distribution-design.md` →
  `docs/specs/polish-and-distribution-design.md`. All references in
  `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, and `docs/plan.md` updated
  to the new path.
- **`pyproject.toml`**: `[project] version = "0.1.0"` → `dynamic = ["version"]`;
  new `[tool.hatch.version]` block reads the VERSION file; new
  `[tool.hatch.build.targets.wheel]` `force-include` bundles VERSION as
  `cerefox/_VERSION` inside the wheel so the runtime fallback works for
  installed packages.

### Decision Log

- **2026-05-25 — v0.2.0 cut: foundations + first TS artifact, policy goes
  from aspirational to enforced.** Captures the rationale for the v0.2.0
  scope, the dogfood test (the cut-release script cuts its own release), the
  consistency between the new tooling and the existing force-move-tags rule,
  and what was deliberately deferred (Python script migration → v0.3.0; npm
  publish → v0.4.0 / v0.5.0; `~/.cerefox/` user-state root → v0.3.0;
  `cerefox doctor` → v0.5.0; release CI/CD → v0.5.0+). Stored in
  *Cerefox Decision Log — 2026 Q2 (Part 2)*.

### Upgrade notes

For end users: nothing to do. The published install path is unchanged.

For contributors:

```bash
# One-line Bun install (if you don't already have it)
curl -fsSL https://bun.sh/install | bash

# Verify
bun --version
```

`uv sync` continues to work as before. `cerefox --version` will now report the
real version after `uv sync` picks up the dynamic-version change.

---

## [v0.1.21] -- 2026-05-25

Three small web-UI quality-of-life fixes from real usage feedback.
Backend code change only — no Edge Function redeploy, no RPC redeploy,
no schema migration. Frontend `dist/` needs a rebuild on deploy:

```bash
cd frontend && npm install && npm run build && cd ..
```

Shipped via [PR #41](https://github.com/fstamatelopoulos/cerefox/pull/41).

### Fixed

- **Dashboard project doc count includes soft-deleted documents.** The
  Projects table on the dashboard showed the *junction-row count*, which
  preserves rows across soft-delete. So a project with 5 active + 1
  trashed document showed "6". Now shows the active count, with an
  optional "(N in trash)" annotation next to the count when any
  documents are in the trash. Backend: `get_project_doc_counts` joins
  with `cerefox_documents` via PostgREST resource embedding to read
  each linked document's `deleted_at` in one round-trip. Returns a
  tuple of `(active_counts, deleted_counts)` instead of a single map.
  Dashboard API response gains `project_deleted_doc_counts: dict[str,int]`
  alongside the existing `project_doc_counts`.

### Changed

- **Project documents page (`/projects/{id}/documents`) is now paginated.**
  Previously capped silently at 50 documents per project; larger projects
  surfaced only the first 50 with no indication. Backend endpoint now
  accepts `limit` (default 50, max 200) and `offset` query params and
  returns a `{documents, total, limit, offset}` envelope. Frontend renders
  Mantine `<Pagination>` with edge buttons; header now shows
  "N documents — showing X–Y" so the slice is unambiguous. Uses
  `keepPreviousData` from TanStack Query so page-link clicks don't
  full-page-loader-flicker. Added `count_documents_for_project` on
  the DB client (PostgREST `count="exact"` head-only request, fast).
  - **Minor breaking API shape**: `GET /projects/{id}/documents`
    response went from a bare list to `{documents, total, limit, offset}`.
    Only the in-repo frontend consumed this endpoint; updated in the
    same PR. Pre-v1.0 web API per `docs/solution-design.md` so this
    is not a SemVer event.

### Added

- **Trash page shows project memberships per document.** Junction rows
  are preserved across soft-delete, so the trash UI now renders a blue
  badge for each project the deleted document belonged to. Helps you
  decide whether to restore (still relevant to project X) or purge.
  Backend `/documents/trash` endpoint enriches the response with
  `project_ids` per row using the same `get_projects_for_documents`
  helper used by the dashboard and project-doc list. Orphan IDs
  (projects deleted after the doc went to trash) are silently filtered
  out client-side.

---

## [v0.1.20] -- 2026-05-25

### Fixed

- **[cerefox#38](https://github.com/fstamatelopoulos/cerefox/issues/38) —
  `cerefox_ingest` no longer strips multi-project memberships on content
  update.** Previously, a content update through the local Python MCP
  with `update_if_exists: true` (or via the document_id update path) and a
  single `project_name` destructively replaced the document's project
  associations with just that one project — silently wiping any extra
  memberships an operator added via the web UI. The two TS paths (remote
  MCP and `cerefox-ingest` Edge Function) had a related but different bug:
  they silently *ignored* `project_name` on update, so agents could neither
  destroy memberships nor add them.

  **The fix is a coordinated set of four pieces** (the full
  proposal from the issue):
  - **Part 1**: non-destructive add semantics for singular `project_name`
    on update across all three paths (local Python MCP, remote MCP,
    Edge Function).
  - **Part 2**: parity across the three paths — same contract everywhere.
  - **Part 3**: new `project_names: string[]` parameter on `cerefox_ingest`
    for **explicit full-set semantics from the MCP layer**.
  - **Part 4**: new MCP tool `cerefox_set_document_projects` for
    **metadata-only project-membership writes** (no content update needed).

  **Final contract on update (all three paths)**:

  | Caller form on update | Behavior |
  |---|---|
  | `project_name: "X"` (singular) | **Non-destructive add.** Ensures membership X exists; other memberships untouched. |
  | `project_names: ["X","Y","Z"]` (list) | **Destructive replace.** Sets the doc's project set to exactly `{X,Y,Z}`. |
  | `project_ids: ["uuid-a","uuid-b"]` (Python API only) | Same destructive-replace semantics; used by web UI's edit form. |
  | None of the above | No change to memberships. |

  The destructive `project_ids` form (Python API only) is the web UI's
  explicit edit contract — preserved. The new `project_names` form
  gives agents the same full-set semantics by name. Singular
  `project_name` is the safe-by-default agent path.

  **New MCP tool surface**: `cerefox_set_document_projects(document_id,
  project_names: string[])` — sets the doc's project membership to
  exactly the given list, no content write. Empty list clears all
  memberships. Logged as `update-metadata` in the audit log. Tool count
  goes from 8 to 9.

  **Implementation**:
  - New `CerefoxClient.add_document_to_projects(doc_id, [pid…])` — the
    non-destructive primitive (Part 1). Idempotent.
  - New `CerefoxClient.set_document_projects(doc_id, project_names,
    author=..., author_type=...)` — destructive replace by name with
    audit (Part 4). Case-insensitive dedup; creates missing projects.
  - `IngestionPipeline.ingest_text` now accepts `project_names: list[str]`
    (Part 3). Precedence on the resolved set: `project_ids` (Python API
    list) > `project_names` (name list) > `project_id` (singular) >
    `project_name` (singular).
  - Both Edge Functions (`cerefox-ingest/index.ts` and
    `cerefox-mcp/tools/ingest.ts`) gain two helpers:
    `ensureDocumentInProject` (non-destructive, Part 1) and
    `setDocumentProjectsByName` (destructive, Part 3). Both wired into
    every code path (create + both update branches).
  - New TS handler `cerefox-mcp/tools/set-document-projects.ts` exposes
    Part 4 over remote MCP. Registered in `cerefox-mcp/index.ts`.
  - **Local MCP gap closed**: `cerefox_ingest` on the local Python MCP
    now also exposes `document_id` (previously local-MCP-only schema gap
    relative to remote MCP).

  **Tests**: 25 new unit tests across two new classes — 12 from the
  original fix (`TestMultiProjectPreservationOnUpdate` +
  `TestAddDocumentToProjects`) and 13 added for Parts 3+4
  (`TestProjectNamesListParameter` + `TestSetDocumentProjects`). All
  508 unit + 80 e2e tests pass against the newly deployed Edge
  Functions. Live verification on the maintainer's Cerefox instance
  confirmed all four scenarios end-to-end (destructive replace via
  list, non-destructive add via singular, set-projects via dedicated
  tool, clear-all via empty list).

  **Documentation**: `AGENT_GUIDE.md` gained a "Project membership
  semantics" section under `cerefox_ingest` and a full section for
  `cerefox_set_document_projects`. `AGENT_QUICK_REFERENCE.md` rule #9
  codifies the non-destructive default. The CLI mapping notes
  `cerefox_set_document_projects` is MCP-only in v0.1.20 (CLI command
  in a future release).

  **⚠️ Edge Function redeploy required to pick up the TS fixes** (the
  Python-side fix takes effect on `git pull` + restarting the local MCP
  server):

  ```bash
  npx supabase functions deploy cerefox-ingest
  npx supabase functions deploy cerefox-mcp
  ```

  See [`docs/guides/upgrading.md` → Upgrading to v0.1.20](docs/guides/upgrading.md#upgrading-to-v0120-from-v0119----multi-project-preservation-fix)
  for the full upgrade note.

### Filed (carried forward, no new code)

- [cerefox#26](https://github.com/fstamatelopoulos/cerefox/issues/26) —
  Supabase Data API role-grants change. Time-bound to the 2026-10-30
  rollout for existing projects.
- [cerefox#36](https://github.com/fstamatelopoulos/cerefox/issues/36) —
  Cerefox installer + interactive bootstrap (cfcf-style UX). Design at
  [`docs/specs/polish-and-distribution-design.md`](docs/specs/polish-and-distribution-design.md)
  (originally drafted on branch `research/installer-design`, promoted from
  `docs/research/` to `docs/specs/` in v0.2.0).
- Iteration 18 — document relations & lifecycle metadata. Design at
  `docs/research/iteration-18-design.md` on branch `feat/document-relations`.

---

## [v0.1.19] -- 2026-05-18

Clickable markdown links in the web UI. Documents you ingested from a git
repo (with relative `[link](path.md)` references), pasted as agent-created
markdown, or wrote with explicit `[Text](doc-uuid)` cross-references now
navigate cleanly when clicked in the Cerefox web UI — without any change
to stored content or any new schema. Pure render-time resolution.

Shipped via [PR #37](https://github.com/fstamatelopoulos/cerefox/pull/37).

> **⚠️ Upgrading? RPC redeploy is REQUIRED.** The FTS-parser fix below
> (`websearch_to_tsquery` → `plainto_tsquery`) lives in
> `src/cerefox/db/rpcs.sql`. **The new code does nothing on its own** —
> the updated function definitions must be pushed to your Supabase
> instance before the fix takes effect. Run:
>
> ```bash
> uv run python scripts/db_deploy.py
> ```
>
> `db_deploy.py` is idempotent (`CREATE OR REPLACE FUNCTION`); safe to
> re-run. No schema migration, no Edge Function redeploy, no reindex
> needed. **Skipping this step is the single most common upgrade
> mistake for v0.1.19** — searches for any dashed title will continue to
> return zero results until the RPCs are redeployed. See
> [`docs/guides/upgrading.md` → Upgrading to v0.1.19](docs/guides/upgrading.md#upgrading-to-v0119-from-v0118--fts-query-parser).

### Added

- **Web UI: clickable repo links in markdown content.** The document detail
  page's markdown renderer now intercepts relative-path links (e.g.
  `[Quickstart](docs/guides/quickstart.md)` inside README.md) and resolves
  them to Cerefox documents at click time via a new
  `GET /api/v1/resolve-link` endpoint. Single match → navigate. Multiple
  candidates → popover chooser. No match → popover with "Search instead?"
  Pure render-time behaviour: stored content is unchanged. External links,
  `#anchor`-only links, and absolute SPA paths pass through untouched.
  - **Resolver strategy** (most → least specific), first tier that hits wins:
    0. **`document_id` match** — if the link target is a literal UUID,
       look up directly. Most stable form (survives title changes, never
       ambiguous). If the UUID doesn't resolve, returns "couldn't
       resolve" rather than falling through to fuzzy tiers — explicit
       UUID encodes explicit intent.
    1. **`source_path` suffix match** — full path as authored.
    2. **basename suffix match** — final path component only.
    3. **title substring match** — case-insensitive ILIKE on title for
       paste-ingested docs without `source_path`.
  - Soft-deleted documents excluded; `from_doc_id` query param suppresses
    self-links.
  - **URL-decode fix**: the frontend `decodeURIComponent`s the href before
    calling the resolver. Closes a bug where `<Title With Spaces>`-form
    links round-tripped through `URLSearchParams` and arrived at the
    server with literal `%20` strings, causing title matches to fail.
  - **Tier-3 mangled-spaces fix**: the title-substring tier previously
    converted *all* dashes to spaces unconditionally — meant to turn the
    slug `setup-supabase` into the needle `setup supabase`, but it also
    turned the human title `Job Hunting - Opportunity Index` into
    `Job Hunting   Opportunity Index` (three spaces where ` - ` was),
    which never substring-matched any real title. Fixed with a heuristic:
    if the stem already contains whitespace it's treated as a human title
    and used literally; otherwise it's treated as a slug and gets the
    dash→space conversion. Both shapes now work; regression tests
    `test_tier3_slug_input_converts_dashes_to_spaces` and
    `test_tier3_human_title_input_used_literally` lock the behaviour.
  - New `CerefoxClient.resolve_link()` method.
  - New `MarkdownLink` React component, used as the `a` override on
    `react-markdown` in `MarkdownViewer`.
  - 15 new unit tests under `tests/test_db_client.py::TestResolveLink`
    cover input normalisation, all tier short-circuit and fallthrough
    paths, UUID tier (case-insensitive, soft-delete filter, self-link
    via UUID, no-fallthrough on miss), self-link exclusion in fuzzy
    tiers, tier-DB error tolerance.
  - Scope is intentionally Need 1 only from the implied-links discussion
    (clickable repo links in web UI). Auto-populating the relation graph
    from markdown links is **not** done — that's Iteration 18's job and
    a separate decision.
  - Agent docs updated: new "Writing linkable content" section in
    `AGENT_GUIDE.md` (four supported link forms, the spaces-break-markdown
    gotcha, why explicit link text matters), one-liner rule #8 in
    `AGENT_QUICK_REFERENCE.md`, brief mention in `connect-agents.md` Path C.
  - **2026-05-24 agent-guidance refinement**: AGENT_GUIDE.md "Writing
    linkable content" rewritten to make `[Text](document-uuid)` **the only
    recommended pattern for agent-authored cross-references**. Title-based
    linking (`[Text](<Title With Spaces>)`) is now documented as fragile
    (silently navigates to wrong page when the title contains colons,
    parentheses, ampersands, or other punctuation that react-markdown's
    URL sanitizer treats as suspicious schemes — e.g. a title of "Published
    Article: CrewAI" has the `:` interpreted as a scheme separator;
    sanitizer strips the URL; click goes to current page). The resolver
    code is unchanged — tier 3 (title substring) still works for plain
    titles, but the agent guidance no longer advertises it. Failed-link
    popover gains a teaching message: *"For reliable cross-references,
    link by ID: `[Text](document-uuid)`. Search results show the UUID
    after each title."* AGENT_QUICK_REFERENCE.md rule #8 tightened to match.

### Changed

- **FTS query parser: `websearch_to_tsquery` → `plainto_tsquery`.** Both
  `cerefox_hybrid_search` and `cerefox_fts_search` now parse the user's
  query with `plainto_tsquery('english', …)`, which treats every token as
  a literal word and ANDs them together. Operator interpretation (phrase
  quotes, `OR`, `-` negation) is no longer applied. The trigger was the
  v0.1.19 link-resolver "Search instead" fallback returning zero results
  for any dashed title (e.g. "Job Hunting - Opportunity Index"):
  `websearch_to_tsquery` was parsing the dash as negation. The tradeoff
  is small — agent queries are natural-language phrases that don't use
  Google-style operators, and the semantic-similarity half of hybrid
  search already provides "broadly related" matching. If operator support
  is ever needed, it should be an opt-in flag, not the default.
  - **⚠️ Requires RPC redeploy.** This change lives in `rpcs.sql` —
    pulling the new code does **not** apply it. After `git pull`, run
    `uv run python scripts/db_deploy.py` to push the updated function
    definitions to your Supabase instance. Without this step the bug
    persists. See the upgrade callout at the top of this release entry.
  - No schema migration, no Edge Function redeploy, no chunk reindex
    needed — the corpus side (`to_tsvector` in chunk `fts` column) is
    unchanged; only the query parser changed.
  - Verified end-to-end against live Supabase (all 80 e2e tests pass
    after redeploy). Brief architectural note added to
    [`docs/solution-design.md` §5.2](docs/solution-design.md#52-title-boosting-search-quality).

### Filed (carried forward)

- [cerefox#26](https://github.com/fstamatelopoulos/cerefox/issues/26) —
  Supabase Data API role-grants change. Time-bound to the 2026-10-30
  rollout for existing projects; will be picked up before then.
- [cerefox#36](https://github.com/fstamatelopoulos/cerefox/issues/36) —
  Cerefox installer + interactive bootstrap (cfcf-style UX). Design at
  [`docs/research/installer-design.md`](docs/research/installer-design.md)
  on branch `research/installer-design`.

---

## [v0.1.18] -- 2026-05-18

CLI parity work — making the local CLI a complete alternative to the MCP and Edge
Function paths. Implements
[cerefox#28](https://github.com/fstamatelopoulos/cerefox/issues/28),
[#29](https://github.com/fstamatelopoulos/cerefox/issues/29),
[#30](https://github.com/fstamatelopoulos/cerefox/issues/30), and
[#31](https://github.com/fstamatelopoulos/cerefox/issues/31). Shipped via
[PR #35](https://github.com/fstamatelopoulos/cerefox/pull/35).

### Added

**Caller-identity flags (#28)** — bring CLI in line with MCP / Edge Function paths
for audit-log and usage-log attribution:

- **Writes** (`ingest`, `ingest-dir`): new `--author <name>` (default
  `CEREFOX_AUTHOR_NAME` env var, falling back to `"unknown"`) and
  `--author-type [user|agent]` (default `CEREFOX_AUTHOR_TYPE`, falling back to
  `"user"`). The Choice validation rejects anything other than `user`/`agent`.
  `--author=""` is rejected with a clear error.
- **Reads** (`search`, `get-doc`, `list-versions`, `list-projects`,
  `metadata-search`): new `--requestor <name>` (default `CEREFOX_REQUESTOR_NAME`,
  falling back to `"user"`). `--requestor=""` rejected.
- **New env vars**: `CEREFOX_AUTHOR_NAME`, `CEREFOX_AUTHOR_TYPE`,
  `CEREFOX_REQUESTOR_NAME`. Useful for agent harnesses that want to set identity
  once instead of on every invocation. Precedence: CLI flag > env var > default.
- **Usage logging added** to `list-projects` and `metadata-search` (previously had
  none — added so the new `--requestor` flag has somewhere to land).

**ingest parity flags (#29)** — close the remaining MCP-tool ↔ CLI gap for writes:

- `cerefox ingest --document-id <uuid>` — deterministic ID-based update (the
  *preferred* pattern per `AGENT_GUIDE.md`). Errors cleanly if the document
  doesn't exist. **Mutually exclusive with `--update`** (the title/source-path
  fallback) — passing both fails with a clear error.
- `cerefox ingest --source <label>` — override the default source label
  (`"paste"` / `"file"`). Agents can set this to `"agent"` or any custom value.
- `cerefox ingest-dir --metadata <json>` — JSON metadata applied to every file
  in a bulk-ingest run. Common case: bulk-importing related notes with a shared
  tag (e.g. `'{"type":"research"}'`).
- `IngestionPipeline.ingest_file` gains matching `document_id` and `source`
  parameters; forwards them to `ingest_text`.

**`cerefox get-audit-log` command (#30)** — the last MCP-tool ↔ CLI parity gap:

- Filters: `--document-id`, `--author`, `--operation`, `--since`, `--until`,
  `--limit`, `--requestor`.
- `--operation` validated against the `cerefox_audit_log` CHECK-constraint
  values (`create`, `update-content`, `update-metadata`, `delete`,
  `status-change`, `archive`, `unarchive`, `restore`).
- `--json` flag emits one JSON object per line, ideal for piping to `jq` /
  scripts (e.g. `cerefox get-audit-log --json | jq 'select(.author_type=="agent")'`).
- Default human-readable table shows timestamp, operation, `author
  (author_type)`, size-change, and description.
- Reuses `CerefoxClient.list_audit_entries` and the existing
  `cerefox_list_audit_entries` RPC — no schema changes.

**[`docs/guides/cli.md`](docs/guides/cli.md) — comprehensive CLI reference (#31)** —
written against the post-#28/#29/#30 surface so it documents the final shape:

- Per-command section for every `cerefox` subcommand (ingest, ingest-dir,
  search, get-doc, list-docs, list-versions, list-projects,
  list-metadata-keys, metadata-search, get-audit-log, delete-doc, reindex,
  config-get/set, web, mcp).
- Synopsis, full options table, examples, output format, exit codes, and
  MCP-tool equivalent for each.
- Common-recipes section: bulk import with shared metadata, ID-based update
  workflow, unattended sync job, agent Bash-tool usage.
- Full MCP tool ↔ CLI command mapping table.
- Cross-linked from `README.md`, `AGENT_GUIDE.md`, `AGENT_QUICK_REFERENCE.md`,
  `connect-agents.md` (Path C), `ops-scripts.md`, `quickstart.md`.

**MCP-parity flag long forms** — every CLI flag now matches its MCP parameter name
exactly (kebab-cased). Short forms preserved as aliases so existing scripts keep
working; the long form is the canonical name shown in `--help`.

| Canonical (matches MCP) | Aliases | Used by |
|---|---|---|
| `--project-name` | `--project`, `-p` | `ingest`, `ingest-dir`, `search`, `list-docs`, `metadata-search` |
| `--metadata-filter` | `--filter`, `-f` | `search`, `metadata-search` |
| `--match-count` | `--count`, `-n` | `search` |
| `--update-if-exists` | `--update` | `ingest`, `ingest-dir` |
| `--version-id` | `--version` | `get-doc` |

Existing flags that already matched the MCP name (`--document-id`, `--author`,
`--author-type`, `--requestor`, `--source`, `--metadata`) are unchanged. 14 new
tests under `TestMcpParityFlagAliases` verify both the long forms and the short
aliases work.

**Safety gaps closed on `cerefox delete-doc`** (surfaced during smoke-testing
the parity work):

- **`--author` / `--author-type` plumbed through** so agent soft-deletes are
  correctly attributed in `cerefox_audit_log` (was: every CLI delete logged as
  `author="unknown"`, `author_type="user"` — the same gap #28 closed for ingest).
- **Docstring rewritten** to be unambiguous about what the command does and does
  not do. "Delete a document" → "Soft-delete a document — moves it to trash.
  Recoverable." Help text spells out the recovery path (web-UI-only) and tells
  agents to pass `--yes --author <name> --author-type agent`.
- **Success message clarified**: "✓ Deleted document …" → "✓ Soft-deleted
  document … (author=…, type=…). Use the web UI to restore or purge."
- **Confirmation prompt language** says the document goes to "trash" and is
  "recoverable", so the human's mental model is right before they answer y/n.
- 7 tests under `TestDeleteDoc` cover: default attribution, flag plumb-through,
  env-var defaults, invalid `--author-type` rejection, empty-string rejection,
  confirmation-prompt wording.

**Destructive operations trust model documented** as an explicit architectural
property (not an oversight). New canonical section in
[`docs/guides/access-paths.md` → "Destructive operations and the trust model"](docs/guides/access-paths.md)
covering the three operation tiers (reads / soft-mutations / hard-destructive),
why purge and restore are web-UI-only by design, what to tell agent contributors
who reach for "parity completion" on these operations, and the recommended
recovery flow. Cross-linked from `AGENT_GUIDE.md` Governance section,
`AGENT_QUICK_REFERENCE.md` rule #7, `connect-agents.md` Path C caveats, and
`cli.md` `delete-doc` section.

### Changed
- `AGENT_GUIDE.md` — "Using Cerefox via the CLI" section updated: mapping table
  now includes all new flags; removes the "lossy attribution" caveat (resolved);
  removes the "no CLI equivalent for audit-log" note; removes the "ID-based
  update is not yet exposed" callout. New "Caller-identity flags" subsection
  explicitly tells agents to set `--author`/`--author-type`/`--requestor` on
  every call.
- `AGENT_QUICK_REFERENCE.md` — CLI fallback table updated to include all new
  flags; rule #3 ("Set `author`/`requestor`") spelled out for both MCP and CLI.
- `docs/guides/connect-agents.md` — Path C section: mapping table updated; the
  "audit-log CLI gap" callout removed; "Audit attribution" caveat rewritten to
  describe the new flags as the way to set proper attribution; example system
  prompt updated to include the identity-flag instruction.
- `docs/guides/configuration.md` — three new env-var rows (already shipped in
  v0.1.17 as part of the docs sweep).
- `docs/guides/ops-scripts.md` — header note clarifying that it covers
  `scripts/`, not the `cerefox` CLI; link to `cli.md` for the latter.
- `.env.example` — new commented-out section for the three caller-identity
  env vars with brief explanation.
- `README.md` — Documentation table gains a row for `docs/guides/cli.md`.
- **Reggaeguitar-style hardening applied to CLI**: all `client.log_usage(...)`
  calls in the CLI now wrapped in `try / except`, with a stderr warning on
  failure. Prevents future regressions where a NameError or similar at the
  call site crashes the command after rendering results (the failure mode
  that produced cerefox#27).

### Decision Log

- The 2026-05-18 "CLI gains caller-set author / author_type / requestor"
  decision (Q2 2026 Decision Log) is now implemented end-to-end. After this
  PR ships, append an outcome note to that entry confirming the rollout.

### Filed (pending implementation)

Open tickets carried forward — not in this release.

- [cerefox#26](https://github.com/fstamatelopoulos/cerefox/issues/26) — Add explicit
  `GRANT` block to `schema.sql` for the Supabase Data API role-grants change rolling
  out on 2026-05-30 (new projects) and 2026-10-30 (existing projects). Also tightens
  `cerefox_audit_log` and `cerefox_document_versions` to `INSERT, SELECT` only at the
  privilege level, enforcing the existing "append-only" comment as a real
  immutability boundary.

---

## [v0.1.17] -- 2026-05-18

Documentation and process work to support the Supabase 2026 API key migration, the new
"Path C" CLI-for-local-agents access pattern, and a set of follow-up tickets that will
land code changes in subsequent releases.

### Added
- **Path C — Shell CLI for local coding agents** as a documented access path. Local
  coding agents (Claude Code, OpenAI Codex CLI, opencode, OpenClaw, Hermes, etc.) can
  read and write Cerefox by invoking `uv run cerefox …` via their Bash tool, instead of
  configuring an MCP server. New top-level section in [`docs/guides/connect-agents.md`](docs/guides/connect-agents.md)
  covering setup, system-prompt template, MCP-tool ↔ CLI-command mapping, verification
  prompts, caveats (privilege level, audit attribution gap pending #28), and a per-agent
  footprint table.
- **AGENT_GUIDE.md** now opens with a "Two ways to interact with Cerefox" section
  (MCP vs CLI) and ends with a "Using Cerefox via the CLI" section: full MCP-tool ↔
  CLI-command mapping, behavioural differences (lossy attribution pending #28,
  human-formatted output, exit-code quirks with #27), and quick-pattern recipes.
- **AGENT_QUICK_REFERENCE.md** gains a "CLI fallback" section pointing at the new
  mapping when MCP is not available.
- **README.md** gains "Option 4 — Shell CLI for local coding agents" in the
  "Connecting AI agents" section.
- **[`docs/guides/setup-supabase.md`](docs/guides/setup-supabase.md)** gains two new canonical reference sections:
  - "Supabase API keys (2026)" — explains the asymmetric Supabase key migration: the
    new `sb_secret_…` key works for the Data API (`CEREFOX_SUPABASE_KEY`), but the
    Edge Function gateway still requires the **legacy anon JWT** for Bearer auth
    (`CEREFOX_SUPABASE_ANON_KEY`). The new `sb_publishable_…` key cannot replace
    the legacy anon JWT today. Sources linked.
  - "Connection pooling (2026)" — full reference for finding the Session Pooler URI
    in the redesigned Supabase dashboard, the port-change shortcut from Transaction
    Pooler to Session Pooler, username/sslmode requirements, and a common-errors
    table.
  All other Supabase-related docs (README, quickstart, configuration, access-paths,
  connect-agents, e2e-use-cases, response-limits, upgrading, mcp-configs example,
  CLAUDE.md, solution-design, research notes) link back to these two anchors instead
  of repeating the explanation.

### Changed
- **All Supabase setup docs** updated for the 2026 key migration:
  - `CEREFOX_SUPABASE_KEY` examples now use the new secret key (`sb_secret_…`);
    legacy `service_role` JWT documented as still working.
  - `CEREFOX_SUPABASE_ANON_KEY` instructions explicitly call for the **legacy anon
    JWT** (`eyJ…`); explain that `sb_publishable_…` is rejected by the Edge Function
    gateway with `UNAUTHORIZED_INVALID_JWT_FORMAT`.
  - Files touched: [`.env.example`](.env.example), [`README.md`](README.md), [`CLAUDE.md`](CLAUDE.md), [`docs/guides/quickstart.md`](docs/guides/quickstart.md),
    [`docs/guides/setup-supabase.md`](docs/guides/setup-supabase.md), [`docs/guides/configuration.md`](docs/guides/configuration.md),
    [`docs/guides/access-paths.md`](docs/guides/access-paths.md), [`docs/guides/connect-agents.md`](docs/guides/connect-agents.md),
    [`docs/guides/response-limits.md`](docs/guides/response-limits.md), [`docs/guides/upgrading.md`](docs/guides/upgrading.md),
    [`docs/e2e-use-cases.md`](docs/e2e-use-cases.md), [`docs/examples/mcp-configs/README.md`](docs/examples/mcp-configs/README.md),
    [`docs/solution-design.md`](docs/solution-design.md), `docs/research/gemini-integration.md`,
    `docs/research/oauth-mcp-auth.md`.
- **Connection pooling guidance** rewritten across all setup docs to reflect the
  redesigned Supabase Connect dashboard: explicitly mandate the **Session Pooler**
  (port `5432`), warn against the Transaction Pooler (`6543`, breaks DDL), document
  the port-change shortcut from the Transaction Pooler URI, require the
  `postgres.<project-ref>` username suffix, and recommend appending `?sslmode=require`.

### Fixed
- **Fresh-deploy bug: `rpcs.sql` function ordering.** `cerefox_context_expand` is now
  defined before `cerefox_search_docs`. `cerefox_search_docs` is `LANGUAGE sql` and
  validates references at creation time, so any fresh `db_deploy.py` run was failing
  with `function cerefox_context_expand does not exist`. Pure reordering — function
  bodies are byte-identical, existing deploys are unaffected, only fresh installs
  were broken. Contributed by [@reggaeguitar](https://github.com/reggaeguitar) —
  see [PR #34](https://github.com/fstamatelopoulos/cerefox/pull/34) (originally
  submitted as [PR #25](https://github.com/fstamatelopoulos/cerefox/pull/25)).
- **`cerefox search` CLI raised `NameError` after rendering results.** The
  `log_usage` call at [`src/cerefox/cli.py:400`](src/cerefox/cli.py#L400) referenced
  an undefined `project_id`; the click parameter is named `project`. Search results
  were printed correctly but the command exited non-zero with a traceback,
  polluting terminals and breaking scripts that piped its output. Resolves
  [cerefox#27](https://github.com/fstamatelopoulos/cerefox/issues/27). Contributed
  by [@reggaeguitar](https://github.com/reggaeguitar) in the same PR above.

### Filed (pending implementation)
The following tickets capture work that did **not** ship in this docs-only PR — they
will be picked up one by one in subsequent releases. Each ticket includes a
"Documentation to update when this ships" section so doc drift is prevented as the
work lands.

- [cerefox#26](https://github.com/fstamatelopoulos/cerefox/issues/26) — Add explicit
  `GRANT` block to `schema.sql` for the Supabase Data API role-grants change rolling
  out on 2026-05-30 (new projects) and 2026-10-30 (existing projects). Also tightens
  `cerefox_audit_log` and `cerefox_document_versions` to `INSERT, SELECT` only at the
  privilege level, enforcing the existing "append-only" comment as a real
  immutability boundary.
- [cerefox#28](https://github.com/fstamatelopoulos/cerefox/issues/28) — Add
  `--author`, `--author-type`, and `--requestor` flags to the CLI for caller-identity
  parity with the MCP and Edge Function paths. Amends the 2026-03-23
  access-path-as-trust-signal decision for ambiguous channels (CLI, Edge Functions).
- [cerefox#29](https://github.com/fstamatelopoulos/cerefox/issues/29) — CLI parity
  with MCP for `ingest`: add `--document-id` (enables the *preferred* ID-based update
  workflow), `--source`, and `--metadata` on `ingest-dir`.
- [cerefox#30](https://github.com/fstamatelopoulos/cerefox/issues/30) — Add
  `cerefox get-audit-log` CLI command. Last remaining MCP-tool ↔ CLI-command
  parity gap.
- [cerefox#31](https://github.com/fstamatelopoulos/cerefox/issues/31) — Add
  [`docs/guides/cli.md`](docs/guides/cli.md) — comprehensive CLI reference. Scheduled
  intentionally **after** #28/#29/#30 so it documents the final CLI surface.

### Decision-log entries (in Cerefox knowledge base, not the repo)
- 2026-05-18 — "CLI gains caller-set author / author_type / requestor; amend the
  2026-03-23 access-path principle for ambiguous channels". Captures the rationale
  for #28.
- 2026-05-18 — "Supabase API key migration is asymmetric: Data API yes, Edge
  Functions no". Captures the empirical findings behind the Supabase API key docs
  updates, the deprecation timeline (none announced), the future plan for replacing
  the legacy anon JWT (`verify_jwt = false` + in-function validation), and the
  trigger conditions for that future work.
- 2026-05-18 — "Supabase removing implicit role grants on public-schema tables".
  Captures the rationale for #26.
- Plus lessons-learned entries: install `uv` outside any venv; "Legacy" dashboard
  label is misleading; Session Pooler vs Transaction Pooler; OpenAI keys per
  machine.

### Contributors
- **[@reggaeguitar](https://github.com/reggaeguitar)** — fresh-deploy bug fixes
  (`rpcs.sql` function ordering and `cerefox search` CLI `NameError`), see
  [PR #34](https://github.com/fstamatelopoulos/cerefox/pull/34) (originally
  submitted as [PR #25](https://github.com/fstamatelopoulos/cerefox/pull/25)).
  Note: the commit author email (`jbrady@grandtimber.com`) is not yet linked to
  the contributor's GitHub account, so the GitHub Contributors graph does not
  currently surface them; once the email is verified at
  https://github.com/settings/emails the graph picks up past commits
  retroactively. Until then, this changelog entry and the linked PR are the
  durable record of the contribution.

---

## [v0.1.16] -- 2026-05-03

Documentation fixes and security fix for metadata search.

### Fixed
- **`cerefox_metadata_search` exposes soft-deleted documents**: the RPC was missing `AND d.deleted_at IS NULL` in its WHERE clause, causing deleted documents to appear in metadata search results. All other search paths (`cerefox_hybrid_search`, `cerefox_search_docs`) already filtered soft-deleted documents correctly. Fixed in `src/cerefox/db/rpcs.sql`.
- **Incorrect clone URL in README and setup-local guide**: replaced placeholder `yourname/cerefox` with the correct `fstamatelopoulos/cerefox` repository URL. Fixes #24.
- **MCP session schema caching**: documented in `docs/guides/upgrading.md` that MCP tool schemas are cached for the lifetime of a session. Agents in open sessions will not see updated tool signatures after a redeploy -- only sessions started after the deploy pick up changes. Restarting the AI client within the same session does not help; a completely new session is required.

---

## [v0.1.15] -- 2026-04-03

ID-based document updates in `cerefox_ingest` (Iteration 17B).

### Added
- **`document_id` parameter on `cerefox_ingest`**: pass the UUID of an existing document to update it deterministically, bypassing title-matching. Available across all access layers: MCP tools (`cerefox-mcp`), primitive Edge Function (`cerefox-ingest`), Python pipeline, and REST API (`POST /api/v1/ingest`).
- **`note` field in ingest responses**: when `document_id` is provided but `update_if_exists` is `false` (the default), the update proceeds and the response includes a `note` warning that the flag was overridden. Available in MCP text responses, Edge Function JSON responses, and `IngestResult.note`.
- 6 new unit tests (`TestIdBasedIngest`) and 10 new e2e tests covering the ID-based path across pipeline, MCP, and Edge Function layers.
- `AGENT_GUIDE.md` and `AGENT_QUICK_REFERENCE.md` updated with ID-based update workflow as the preferred pattern.

### Changed
- `AGENT_GUIDE.md`: update workflow section now shows ID-based (preferred) and title-based (fallback) patterns separately.
- `docs/solution-design.md` section 6.4 documents both update modes with decision tables.
- `docs/requirements-and-specs.md`: FR-11.11 and FR-11.12 added.

---

## [v0.1.14] -- 2026-04-03

Title boosting for FTS and semantic search (Iteration 17A).

### Added
- **Title boosting (FTS)**: document title now included in `cerefox_chunks.fts` at weight A (highest), chunk heading at weight A, body content at weight B. Title matches rank ~10x higher than body-only matches. Implemented via `cerefox_ingest_document` RPC computing the tsvector inline using `p_title`.
- **Title boosting (semantic)**: embedding input prepended with `# {doc_title}\n` for every chunk across Python pipeline, `cerefox-ingest` Edge Function, and `cerefox-mcp`. Stored content is unchanged.
- **Title-change auto-reindex**: when a document title changes without a content change, the pipeline re-embeds all current chunks with the new title prefix and updates FTS vectors via new `cerefox_update_chunk_fts` RPC. No version snapshot -- content is identical.
- **`cerefox_update_chunk_fts(p_document_id, p_new_title)` RPC**: updates FTS vectors for all current chunks of a document with a new title.
- **`cerefox reindex --all` improvements**: now embeds with title prefix and calls `update_chunk_fts` per document. Existing documents without title boosting can be upgraded.
- **`scripts/reindex_all.py`**: convenience wrapper for `cerefox reindex --all` with `--dry-run` and `--batch` options.
- Migration `0011_title_boosting.sql`: drops GENERATED expression on `fts` column, adds `cerefox_update_chunk_fts` RPC.

### Fixed
- **`GET /api/v1/documents/{id}` no longer returns 500** on transient network errors fetching supplementary data (versions, project IDs). Returns the document with empty lists instead.

### Changed
- `cerefox_chunks.fts` changed from `GENERATED ALWAYS AS` to a regular `TSVECTOR` column. PostgreSQL GENERATED columns cannot cross-reference other tables; the RPC now computes it inline.

---

## [v0.1.13] -- 2026-03-30

Configurable requestor identity enforcement. Contributed by @tdebasis (PR #20, issue #18).

### Added
- **Requestor identity enforcement**: opt-in via `require_requestor_identity` config (default false). When enabled, all MCP tool calls and Edge Function calls must include a `requestor` (reads) or `author` (writes) identity. Returns -32602 (MCP) or 400 (HTTP) with helpful error message when missing.
- **Identity format validation**: `requestor_identity_format` config (default `^[a-zA-Z0-9_:.\- ]+$`). Validates identity against a regex pattern. Applied to both `requestor` and `author`. Users can customize (e.g., `^[a-z]+:[a-z]+$` for conclave:agent format).
- **Enforcement across all access paths**: cerefox-mcp (MCP), all 8 primitive Edge Functions (GPT Actions), and local MCP server (stdio).
- Migration `0010_requestor_enforcement_config.sql` seeds config defaults.
- Documentation in `docs/guides/configuration.md`.

### Fixed
- **E2e test reliability**: `retry_until()` helper replaces fixed `sleep(1)` for embedding propagation, eliminating intermittent timing failures.
- **E2e test cleanup**: soft-delete then purge for permanent test data removal.
- **Health check test**: updated for 405 GET response (MCP spec compliance from v0.1.12).

---

## [v0.1.12] -- 2026-03-30

Fix excessive Edge Function invocations from MCP SSE polling.

### Fixed
- **`cerefox-mcp` GET endpoint returns 405** instead of 200. Per MCP spec (2025-03-26), servers that don't support SSE notifications MUST return 405 Method Not Allowed for GET requests. Our server was returning 200, which MCP clients interpreted as "SSE supported" and maintained persistent polling at ~1 GET/sec (~86K invocations/day per client). The 405 response tells clients this server is POST-only, eliminating all idle polling.

### Added
- **MCP config templates** in `docs/examples/mcp-configs/`: copy-pasteable `.mcp.json` files for Claude Code (`mcp-remote`), Claude Desktop (`supergateway`), Cursor (native HTTP), and local stdio. Contributed by @tdebasis (PR #19, resolves #17).
- **`mcp-remote` recommended** for Claude Code remote MCP: `mcp-remote --header` works with Supabase Edge Functions, bypassing the GoTrue OAuth discovery conflict. Updated in `docs/guides/connect-agents.md` with SSE polling warning.

---

## [v0.1.11.1] -- 2026-03-29

Soft delete with trash bin, restore, and purge.

### Added
- **Soft delete**: "Delete" now sets `deleted_at` instead of CASCADE DELETE. Documents remain in the database (with all chunks and versions) but are excluded from search.
- **Trash page** (`/app/trash`): lists soft-deleted documents with Restore and Purge buttons. Purge has two-step confirmation.
- **Restore**: `cerefox_restore_document` RPC clears `deleted_at`. Document returns to search and dashboard immediately.
- **Purge**: `cerefox_purge_document` RPC does permanent CASCADE DELETE. Only works on already soft-deleted docs.
- **Document detail banner**: red "Deleted" indicator with Restore and Permanently Delete buttons when viewing a soft-deleted document.
- **`'restore'` audit operation**: new operation type in the audit log CHECK constraint. Existing entries that incorrectly used `'unarchive'` for restore are auto-corrected by migration 0009.
- Database migrations `0008_soft_delete.sql` and `0009_audit_log_restore_operation.sql`.

### Changed
- `cerefox_delete_document` RPC now soft-deletes (was CASCADE DELETE).
- All search RPCs (hybrid, fts, semantic) filter `d.deleted_at IS NULL`.
- `list_documents()` in Python client excludes soft-deleted docs.
- REST API: new endpoints `POST /documents/{id}/restore`, `DELETE /documents/{id}/purge`, `GET /documents/trash`.

---

## [v0.1.11] -- 2026-03-29

Usage tracking, analytics dashboard, requestor attribution, and UX refinements (16C/16D).

### Added
- **Usage tracking**: opt-in logging of all operations (reads and writes) across all access paths. `cerefox_usage_log` table with `requestor`, `access_path`, `operation`, `query_text`, and `result_count`. Controlled via `cerefox_config` table -- no redeploy needed to toggle.
- **Analytics dashboard** at `/app/analytics`: 8 interactive visualizations (Nivo bar/pie charts, D3.js HEB charts, CSS word cloud). On-demand analysis with date range, project, and access path filters. Usage tracking toggle. CSV export.
- **Requestor attribution**: optional `requestor` parameter on all MCP read tools and all primitive Edge Functions. MCP writes use the existing `author` parameter. Multi-agent analytics now show which agent accessed which documents through which operations.
- **`cerefox-list-projects` Edge Function**: new primitive EF for GPT Actions and direct HTTP callers.
- **CLI**: `cerefox config-get` and `cerefox config-set` commands for runtime config management.
- **REST API**: 5 new endpoints (`/usage-log`, `/usage-log/export.csv`, `/usage-log/summary`, `/config/{key}` GET/PUT).
- **Metadata Search UX**: expand/collapse result cards with full metadata, content viewer (Raw/Rendered toggle), and "View Document Details" link (new tab).
- Database migrations `0006_usage_log.sql` and `0007_usage_log_requestor.sql`.
- 2 new Playwright UI tests (analytics page).
- GPT Actions OpenAPI schema v1.7.0 (9 endpoints, requestor param).

### Changed
- **Charting library**: replaced `@mantine/charts` (Recharts wrapper) with Nivo (`@nivo/bar`, `@nivo/pie`). Better dark mode, tooltips, and React 19 support.
- **Word cloud**: replaced `react-d3-cloud` with CSS flex-wrap implementation (React 19 peer dep conflict).
- **`reader` renamed to `requestor`** throughout: DB column, RPCs, Python client, TypeScript, frontend. Migration 0007 handles the column rename non-destructively.
- **Usage log tracks writes**: ingest operations now logged alongside reads.
- **Local MCP server**: no longer labelled "legacy fallback" -- described as local alternative with zero Edge Function usage.
- Edge Functions: 8 -> 9 (added `cerefox-list-projects`).

---

## [v0.1.10] -- 2026-03-28

MCP consolidation (16A), metadata search, project name standardisation, and project discovery (16B). Resolves [#9](https://github.com/fstamatelopoulos/cerefox/issues/9). Inspired by [#10](https://github.com/fstamatelopoulos/cerefox/pull/10) (h/t @tdebasis).

### Added
- **`cerefox_metadata_search` RPC and MCP tool**: query documents by metadata key-value criteria without a text search term. JSONB containment filter with AND semantics, project/date filters, optional content inclusion with byte budget.
- **`cerefox_list_projects` RPC and MCP tool**: agents can discover available projects by name before filtering in other tools.
- **`cerefox-metadata-search` Edge Function**: new primitive Edge Function for GPT Actions and direct HTTP callers.
- **`project_names TEXT[]`** added to all search/retrieve RPCs: all document results now include human-readable project names alongside UUIDs.
- **Metadata Search web UI page** (`/app/metadata-search`): filter builder with key suggestions, project dropdown, date filters, include-content toggle, result cards with metadata and project name badges.
- **Project name badges** on search result cards in the existing Search page.
- **`cerefox metadata-search` CLI command** with `--filter`, `--project`, `--updated-since`, `--created-since`, `--limit`, `--include-content` options.
- **`POST /api/v1/documents/metadata-search`** REST API endpoint for the web UI.
- Database migration `0005_metadata_search.sql`.
- 10 new MCP e2e tests, 4 new Edge Function e2e tests, 6 new API e2e tests, 4 new unit tests, 2 new Playwright UI tests.

### Changed
- **`cerefox-mcp` refactored to call RPCs directly** (16A): each tool handler calls Postgres RPCs via the service-role key instead of delegating to primitive Edge Functions via `fetch()`. Halves billable Supabase Edge Function invocations per MCP tool call. Multi-file structure: `shared.ts`, `embeddings.ts`, `tools/*.ts`.
- **MCP tools: 6 -> 8** (added `cerefox_list_projects` and `cerefox_metadata_search`).
- **Edge Functions: 7 -> 8** (added `cerefox-metadata-search`).
- **Local MCP server reframed**: no longer labelled "legacy fallback". It is a local alternative with zero Edge Function usage (relevant for Supabase free-tier limits), lower latency, and offline support.
- `connect-agents.md` updated with all 8 tools, corrected architecture description, Edge Function usage comparison.
- `upgrading.md` updated with v0.1.10 breaking change notice.

### Breaking (MCP remote path only)
- **`project_id` removed from MCP tool inputs**: `cerefox_search`, `cerefox_ingest`, and `cerefox_metadata_search` now accept `project_name` (human-readable string) instead of `project_id` (UUID). Name-to-UUID resolution happens inside the tool handler. Agents passing `project_id` in MCP calls must switch to `project_name`. **Primitive Edge Functions are unchanged** -- they continue to accept `project_id UUID` for GPT Actions and direct HTTP callers.

---

## [v0.1.9.1] -- 2026-03-23

Bug fixes reported by user testing MCP integration with Claude Code.

### Fixed
- **document_id missing from MCP search results** -- `cerefox-mcp` was dropping `document_id` when formatting search results as text, making `cerefox_get_document` and `cerefox_list_versions` unreachable through MCP since agents never received the UUID
- **Intermittent embedding API failures** -- added retry with exponential backoff (3 attempts, 500ms/1s/2s) to all three embedding paths: Python `CloudEmbedder`, `cerefox-search` Edge Function, and `cerefox-ingest` Edge Function. Only transient errors (5xx, timeouts) are retried; client errors (4xx) fail immediately

---

## [v0.1.9] -- 2026-03-23

Single implementation principle consolidation, audit trail completion, and UI refinements.

### Added
- **`cerefox_ingest_document` RPC**: single atomic transaction for all ingestion writes (insert/update document, insert chunks, snapshot version, set review_status, create audit entry). Both Python pipeline and Edge Function now call this RPC instead of doing direct table inserts.
- **`cerefox_delete_document` RPC**: creates audit entry (preserving document title and size) before cascade-deleting the document.
- **`cerefox_get_audit_log` tool** on the local Python MCP server (was missing; already existed on remote Edge Function MCP).
- **Audit Trail section** on Document Detail page: lazy-loaded accordion showing all audit entries for the document with color-coded operation badges, author attribution, and size deltas.
- **`author` parameter** on `cerefox_ingest` MCP tool: agents can identify themselves (e.g., "Claude Code", "Cursor") instead of the default "mcp-agent".
- **Review status filter** on Search page (docs mode): filter by All / Approved / Pending Review.
- **Upgrading guide** (`docs/guides/upgrading.md`): idempotent migration checklist for users upgrading from any previous version.
- `CONTRIBUTING.md` moved to repo root (GitHub community standards compliance).
- `SECURITY.md` for private vulnerability reporting.
- GPT Actions OpenAPI spec bumped to v1.5.0 (new audit log endpoint, author parameter on ingest).

### Changed
- **Single implementation principle enforced**: ingestion write path consolidated into `cerefox_ingest_document` RPC. CLAUDE.md updated with clear guidance that all new write logic goes in RPCs, not callers.
- **Review status** correctly set on new agent-created documents (`pending_review`) -- was defaulting to `approved` due to missing logic in the create path.
- Dashboard "Updated" column shows date and time (was date only).
- Quickstart guide updated for React SPA (Node.js prerequisite, frontend build step, correct URLs).

### Fixed
- **Double JSON encoding** in `ingest_document_rpc` parameters causing "cannot get array length of a scalar" error on local MCP path.
- **Stale project badges** showing raw UUIDs after project deletion -- dashboard cache now invalidated on project delete and document edit; unknown project IDs filtered from badge display.
- **Dark mode inline code** contrast -- `light-dark()` CSS function for code/pre/th backgrounds.

---

## [v0.1.8] -- 2026-03-23

Trust and governance layer: audit log, review status, version archival, and version diff viewer.

### Added
- **Immutable audit log** (`cerefox_audit_log` table) recording all write operations with author attribution (`author_type`: user or agent), size delta, description, and version references
- **`cerefox_create_audit_entry`** and **`cerefox_list_audit_entries`** RPCs (single implementation principle)
- **`cerefox-get-audit-log`** Edge Function + **`cerefox_get_audit_log`** MCP tool (7 Edge Functions, 7 MCP tools total)
- **Review status** (`approved` / `pending_review`) on documents with auto-transition: agent writes set `pending_review`, human writes set `approved`
- **Review status filter** on search page (docs mode: All / Approved / Pending Review)
- **Review status indicators** (green/yellow badges) on dashboard, search results, project documents, and document detail
- **Version archival**: `archived` flag protects individual versions from retention cleanup. Clickable toggle in version history with tooltips and unarchive confirmation
- **Version diff viewer** (unified mode) comparing any archived version against current content
- **`CEREFOX_VERSION_CLEANUP_ENABLED`** config setting (default: true). Set to false for immutable version retention
- **Author pass-through** on MCP ingest: agents can set their name via optional `author` parameter
- **Audit log browser page** (`/app/audit-log`) with operation and author filters, document titles (SQL join), color-coded badges
- `docs/guides/upgrading.md` -- idempotent migration checklist for upgrading between versions
- Database migration `0004_add_audit_log_review_status_archived.sql`

### Changed
- `cerefox_snapshot_version` RPC respects `archived` flag (skips archived versions) and `p_cleanup_enabled` parameter
- `cerefox_list_document_versions` RPC returns `archived` boolean
- `cerefox-ingest` Edge Function accepts `author` and `author_type`, creates audit entries via RPC
- `cerefox-mcp` Edge Function passes author (agent-provided or default "mcp-agent") and `author_type="agent"`
- `list_documents()` query updated to include `review_status`
- Diff viewer simplified to unified mode only (side-by-side removed due to alignment issues)

### Fixed
- Dashboard showing all documents as "Pending" when `review_status` was missing from SELECT column list

---

## [v0.1.7] -- 2026-03-22

Major web application refactor: Jinja2 + HTMX server-rendered frontend replaced with a React + TypeScript single-page application.

### Added
- **React + TypeScript SPA** at `/app/` — Mantine UI, TanStack Query, React Router, Vite build pipeline
- **18 JSON API endpoints** under `/api/v1/` — dashboard, search, documents CRUD, ingest (paste + file), projects CRUD, metadata keys, filename check
- **Markdown viewer** with Rendered/Raw toggle on document detail, edit preview, and ingest preview
- **Dark mode** — follows OS preference with manual toggle in header
- **Toast notifications** for save, delete, and project CRUD operations
- **Dedicated project documents page** (`/app/projects/:id/documents`) — clean table listing
- **Quick search** from dashboard — input field navigates to Search with query pre-filled
- **Root redirect page** at `/` for users with old bookmarks — auto-redirects to `/app/`
- `docs/specs/ui-redesign-spa-python-api.md` — detailed design document for the migration
- `docs/guides/agent-coordination.md` — multi-agent coordination patterns via Cerefox
- `docs/research/vision.md` — comprehensive vision document for Cerefox

### Changed
- **Web UI architecture**: server-rendered Jinja2 + HTMX replaced with client-side React SPA
- **Search page** renamed from "Knowledge Browser" to "Search Knowledge Base"; requires a query (project-only browse moved to dedicated page)
- **Version history** now a collapsible table with date+time and explicit download buttons (was clickable badge row)
- **Document detail** shows Created/Updated with time, not just date
- **Dashboard** stat cards use compact horizontal layout; projects shown as table with doc counts and "List" button

### Fixed
- **Broken documents from failed embedding** — ingestion now checks actual chunk count in DB, not stored field on document record; re-embeds if chunks are missing
- **Download filename** for paste-ingested docs and Unicode titles (em dash, accents)

### Removed
- Jinja2 server-side rendering routes (`routes.py`, 850 lines)
- 83 unit tests for removed Jinja2 routes (`test_routes.py`)
- `jinja2` Python dependency
- All 15 Jinja2 template files (`web/templates/`)

---

## [v0.1.6] — 2026-03-21

Metadata-filtered search, response size redesign, UI improvements, and tooling.

### Added
- **Metadata-filtered search** across all access paths — CLI, web UI, MCP, Edge Functions, GPT Actions (Iteration 13A)
- **Collapsible document results** in web UI — `<details>`/`<summary>` panels with Full/Excerpt badges replace inline truncated content
- **"Documents (full)" is now the default** search mode in the web UI
- `scripts/sync_docs.py` — batch-upload `README.md` + all `docs/**/*.md` into a Cerefox project with `--dry-run` and `--project` flags
- `docs/guides/response-limits.md` — new guide explaining the response size model
- `docs/guides/access-paths.md` — documents all three auth/access layers

### Changed
- **Response size limits redesigned** to opt-in per call (Iteration 13C): `max_bytes=None` means no truncation (web UI, CLI); MCP/Edge Function paths enforce a server ceiling (200 KB default)
- Small-to-big retrieval threshold lowered from 40,000 → 20,000 chars
- `CEREFOX_MAX_RESPONSE_BYTES` now only applies to MCP and Edge Function paths; web UI and CLI are unlimited

### Fixed
- **Download 500 error** — `UnicodeEncodeError` when document titles contain em dashes or other non-ASCII characters; titles are now sanitized to ASCII-safe filenames
- Paste-ingested documents now use their title (not generic "document") as download filename
- Versioned downloads include `v<N> - <date>` suffix in the filename
- E2e test suite aligned with documented use cases (`e2e-use-cases.md` rewritten)

---

## [v0.1.5] — 2026-03-20

Small-to-big retrieval and access-paths documentation.

### Added
- **Small-to-big retrieval** (Iteration 12A) — Postgres RPC assembles neighbouring chunks for large documents; `is_partial` flag on results indicates whether full content or excerpts were returned
- E2e tests for small-to-big retrieval
- `docs/guides/access-paths.md` — comprehensive guide to all credential layers and integration paths

### Changed
- Response size limit raised from 65 KB to 200 KB
- Small-to-big params removed from Python config; configured exclusively via `rpcs.sql` SQL defaults
- `is_partial` documented in OpenAPI schema, Edge Function reference, and MCP tool description

---

## [v0.1.4] — 2026-03-19

Document versioning, two new Edge Functions, and GPT Actions schema update.

### Added
- **Implicit document versioning** — updating a document archives previous chunks with a `version_id`; partial indexes exclude archived chunks from search automatically (Iteration 12)
- `cerefox-get-document` Edge Function — retrieve full document content, with support for archived versions
- `cerefox-list-versions` Edge Function — list version history for a document
- `cerefox_get_document` and `cerefox_list_versions` MCP tools
- GPT Actions OpenAPI schema updated to v1.3.0 with versioning endpoints

### Changed
- Old migrations folded into `schema.sql` for cleaner fresh deployments

### Fixed
- Backup directory default path
- Test isolation issues

---

## [v0.1.3] — 2026-03-15

Metadata overhaul, e2e testing, and operational improvements.

### Added
- **Data-driven metadata discovery** — replaced static key registry with `cerefox_list_metadata_keys` RPC that introspects actual JSONB metadata across all documents
- `cerefox-metadata` Edge Function for metadata key listing
- **E2e test suite** — API tests against live Supabase + Playwright UI tests against local web app
- Inline two-step confirmation on destructive UI actions (replaces `window.confirm`)
- `cerefox-mcp` Edge Function — Streamable HTTP MCP adapter; promoted as recommended remote access path
- Local-time date display in dashboard and document detail views
- Cerefox Decision Log convention added to `CLAUDE.md`

### Changed
- License changed from MIT to Apache 2.0
- Adopted lightweight GitHub Flow (branch model documented in `CLAUDE.md`)
- Greedy section accumulation for chunking — sections accumulate until adding the next would exceed `max_chunk_chars`

### Fixed
- `cerefox-mcp` returning empty content for search results
- Supergateway auth flag in Claude Desktop config example
- Stale embedder default and removed unused `OVERLAP_CHARS` config
- H1 hard-boundary removed; cross-path content hash inconsistency resolved
- CRLF hash mismatch between Edge Function and Python chunking paths
- ChatGPT Desktop removed from local MCP path (not supported)

---

## [v0.1.2] — 2026-03-11

Ingestion improvements and test coverage.

### Added
- **Filename-based document update** — `update_existing` flag on ingestion matches by `source_path` (file-ingested) or title (paste-ingested) and updates in-place
- Consistent response size budget across MCP and Edge Function paths
- Skip heading-based chunking for documents that fit in a single chunk
- Test coverage for `update_existing`, `check-filename`, and `update-content` flows

### Fixed
- Chunking overlap issues
- Documentation alignment

---

## [v0.1.1] — 2026-03-11

Post-launch polish.

### Added
- "Last updated" date displayed in dashboard and search/browse results
- `docs/guides/operational-cost.md` — embedding and hosting cost estimates

### Removed
- Local embedder references (mpnet, Ollama) — cloud-only going forward (OpenAI, Fireworks AI)

### Fixed
- Stale mpnet/cost references in source file comments

---

## [v0.1.0] — 2026-03-11

First complete release. All core features working end-to-end.

### Added
- **Two-table schema** — `cerefox_documents` + `cerefox_chunks` with pgvector (768-dim)
- **Hybrid search** — FTS + semantic (cosine similarity), combined via RRF in Postgres RPC
- **Heading-aware markdown chunking** — H1 → H2 → H3 → paragraph fallback
- **Cloud embeddings** — OpenAI `text-embedding-3-small` (default) and Fireworks AI
- **Ingestion pipeline** — markdown documents chunked, embedded, and stored
- **CLI** (`cerefox` command) — `ingest`, `search`, `reindex`, `backup`, `restore`
- **Web UI** — FastAPI + Jinja2 + HTMX; dashboard, search, browse, document detail, ingest
- **Built-in MCP server** (`cerefox mcp`) — stdio transport for local AI agent integration
- **Edge Functions** — `cerefox-search`, `cerefox-ingest` deployed to Supabase
- **Backup/restore** — file-system backup with optional git integration
- `docs/` — requirements, solution design, implementation plan, configuration guide, quickstart, setup guides
- `scripts/db_deploy.py` and `scripts/db_migrate.py` for schema deployment

---

## Pre-release — 2026-03-07 to 2026-03-10

Initial project scaffolding, documentation structure, and phased implementation of core modules (database client, chunking, embeddings, ingestion, retrieval, CLI, web UI, backup). Not tagged.

[v0.1.9.1]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.9...v0.1.9.1
[v0.1.9]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.8...v0.1.9
[v0.1.8]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.7...v0.1.8
[v0.1.7]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.6...v0.1.7
[v0.1.6]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.5...v0.1.6
[v0.1.5]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.4...v0.1.5
[v0.1.4]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.3...v0.1.4
[v0.1.3]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.2...v0.1.3
[v0.1.2]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.1...v0.1.2
[v0.1.1]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.0...v0.1.1
[v0.1.0]: https://github.com/fstamatelopoulos/cerefox/releases/tag/v0.1.0
