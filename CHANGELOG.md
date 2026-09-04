# Changelog

All notable changes to Cerefox are documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — all `v0.x` releases may include breaking changes.

---

## [Unreleased]

### Added

- **The review workflow is now optional (#241).** A new store-level flag,
  `review_workflow_enabled`, governs whether agent-authored writes are queued
  as `pending_review` for a person to approve. It is **off on a fresh
  install** — most single-operator stores never review anything, and a queue
  that is never drained is worse than no queue — and **on for every upgraded
  store**, seeded by migration 0031, so upgrading changes nothing until you
  flip it (`cerefox config set review_workflow_enabled true|false`, or
  Settings → Governance, which asks for confirmation first). `cerefox doctor`
  always prints a `review workflow` line saying which state the store is in.

  With the workflow **off the feature is absent, not dimmed**: every write
  lands `approved` whoever wrote it, and no surface shows a `review_status` —
  the web pill, badges and search chip do not render; `document list` and
  `metadata search` drop their `status` column (and the `review_status` key
  from `--json`); API, MCP and `cerefox-metadata-search` Edge Function rows
  carry no `review_status` key; `GET /api/v1/search?review_status=…` is a
  `400`; `POST /api/v1/documents/{id}/review-status` is a `404`. Stored rows
  are never touched by a toggle in either direction — turning it back on
  shows exactly what was there. Attribution and the audit log are unaffected
  in both states; review status has never gated retrieval and still does not.

  Under the hood the decision moved to where it belonged: `cerefox_ingest_document`
  now reads the flag itself, and the six client-side copies of the
  "agent → pending" rule (local MCP, remote MCP, CLI pipeline, Edge Function,
  partial edits, client bridge) are gone. Every access path — including
  clients that predate this release — obeys the one store setting. The RPC's
  `p_review_status` parameter is still accepted, now ignored, and deprecated.
  Spec: `docs/specs/review-workflow-toggle.md`. Schema 0.15.0 → **0.16.0**,
  migration 0031; GPT Actions OpenAPI block 3.3.0 → 3.4.0.

  **Redeploy required**: `minSchema` is raised to **0.16.0**. This client no
  longer decides the review status itself, so against an older server every
  agent write would silently land `approved` — a behaviour change, not a
  missing feature — and the new search-filter overloads would fail outright.
  After `self-update`, run `cerefox server deploy`; until then `cerefox web`
  refuses to start and `doctor` says exactly why.

### Fixed

- **A review-status-filtered search under-returned (#240).** The filter ran in
  TypeScript *after* the RPC had already applied `count`, so asking for ten
  approved documents could return three while more existed. The filter is now
  a parameter of `cerefox_hybrid_search` / `cerefox_search_docs` and is
  applied before the limit. Invalid values are a `400` instead of being
  silently ignored.
- **`cerefox config list` hid three working keys (#239).** The CLI kept a
  hand-written copy of the server's allow-list and had drifted:
  `version_retention_hours`, `version_cleanup_enabled` and
  `document_size_warning_chars` were settable but unlisted. The list is now
  derived from the shared `CONFIG_CATALOG` (the same source the Settings page
  renders), grouped, with each key's kind and default, and a unit test pins
  the catalog to the RPC's allow-list so a third copy cannot drift again.
  `--json` gains a `catalog` array; `keys` keeps its shape.
- **Live tests no longer fail on bun's 5 s default timeout (#235).** Every
  live test is declared through a `liveTest` helper carrying a 60 s budget —
  `bunfig.toml`'s `[test] timeout` is not honoured by the pinned bun — and a
  guard test fails the suite if a live file declares a bare `test(`. The
  destructive web suite also gained the production-write guard the other
  write suites already had; it had been missing it, masked only by the
  server refusing to start against an out-of-date schema.

### Added (tests)

- `web-integration/review-workflow.test.ts` flips the flag itself through the
  config API and asserts both contracts live on every run, then restores the
  value it found. The attribution, destructive, pipeline and Edge Function
  suites branch on the store's current setting.

---

## [v1.12.2] -- 2026-09-03

### Fixed

- **Cerefox Local no longer warns, on every boot, that it is dangerously
  configured when it is not (#237).** The "Binding 0.0.0.0 with NO API key
  configured" warning was written for `cerefox web` on a host, where that is
  genuinely an open API on the network. A container **must** bind `0.0.0.0`
  internally — its own loopback is not the host's, so a narrower bind would
  make the published port unreachable — and the boundary that matters is the
  *publish* address, which the process inside cannot see. So it fired on every
  normal boot, described a correct setup in alarming terms, and recommended a
  command that does not apply there. Suppressed inside containers, for the same
  reason the loopback exemption is: in there, the server is not in a position
  to judge. A false alarm on every boot trains people to ignore real ones.
  `containerGateWarning()` still covers the container configuration that IS
  broken.
- **`cerefox-local api-key` says what is actually protecting the port.** The
  previous wording ("The gate is OFF — … the bind is the boundary") was read by
  a maintainer as "we still block non-local callers, just without requiring a
  key", which is the opposite of the truth: with the gate off Cerefox checks
  nothing, and the protection is that Docker publishes the port on `127.0.0.1`
  only, so a remote caller cannot open a connection at all. Now spelled out
  rather than compressed, in both the command and
  `docs/guides/securing-local-access.md`.

---

## [v1.12.1] -- 2026-09-03

### Fixed

- **Cerefox Local was completely inaccessible on v1.12.0 — every request
  returned `401`, including the web UI.** v1.12.0 injected an API key into the
  container unconditionally, and **Docker's port publishing rewrites the source
  address**: a request from the host to `127.0.0.1:<port>` reaches the server
  inside the container appearing to come from the bridge gateway, never from
  `127.0.0.1`. The loopback exemption could therefore never match. **Upgrade
  to v1.12.1 if you run Cerefox Local.**

  The fix is not only wiring. Inside a bridge-networked container the server
  **cannot** distinguish a host-loopback caller from one that crossed the
  network, because Docker NATs both to the same address — so the loopback-exempt
  middle ground is not implementable there, and v1.12.0 was pretending
  otherwise. In a container the gate is now all-or-nothing, and which one is
  decided on the **host**, where the publish address is actually known:
  published on `127.0.0.1` (the default) → gate off, the bind is the boundary,
  exactly as pre-1.12.0; published wider → gate on for every caller.
  `cerefox-local` derives this from `CEREFOX_LOCAL_BIND`; an explicit
  `CEREFOX_API_REQUIRE_KEY=1` still forces it on.

  Two guards so this cannot recur: `cerefox web` now **warns at boot** when a
  key is configured inside a container without require-mode (the exact broken
  configuration), and `docker/local/smoke-auth.sh` builds the real image,
  publishes a real port and makes real requests from the host — verified to
  fail on the v1.12.0 behaviour and pass on the fix. The original bug was
  invisible to every unit test and to a native `cerefox web` run, because the
  mechanism was right and only the packaging was wrong.

- **`cerefox-local api-key` says whether the key is actually enforced.**
  Printing a key while implying it gates something, when it does not, is worse
  than printing nothing.
- **Two more live tests given realistic time budgets** (`pipeline-update`,
  `doctor --json`). They make several real Supabase/OpenAI round trips while
  inheriting bun's 5-second default, so they failed on a slow API day. The
  systematic version — ~130 live tests across 16 files with almost no explicit
  budgets — is tracked as
  [#235](https://github.com/fstamatelopoulos/cerefox/issues/235); note there
  that `bunfig.toml`'s `[test] timeout` is **not** honored by bun 1.3.13, which
  was verified rather than assumed.

---

## [v1.12.0] -- 2026-09-03

### Added

- **`/api/v1` and `/rest/v1` are authenticated for non-local callers (#229).**
  The rule is short: **a request arriving on the loopback interface is allowed
  without a credential; a request arriving on any other interface must present
  the server's API key** as `Authorization: Bearer <key>`.

  This matches the threat actually worth defending against — something that can
  reach the port but cannot read your filesystem (a machine on the LAN after a
  widened bind, a container on a Docker network, a malicious page in your
  browser). Anyone who *can* read your filesystem already has the key, the
  `.env` and the database credentials, so demanding a key from them achieves
  nothing.

  **Nothing local needs configuring.** The web UI, agents on the same machine
  and localhost scripts keep working with no key and no prompt. The browser
  never holds a credential, deliberately: the SPA is a static file, so a key
  embedded in it could be read by anything that can load the page.

  **Existing installs are unaffected on upgrade.** With no key configured the
  gate is off and the server behaves exactly as before, so nothing breaks;
  `cerefox web` warns at boot if it binds a non-loopback host with no key.
  Cerefox Local mints one automatically at first boot and persists it on the
  data volume, so it survives `cerefox-local upgrade`.

  The PostgREST passthrough at `/rest/v1/*` is gated too. It is a second
  surface on the same port, live on Cerefox Local, and covering only `/api/v1`
  would have moved the hole rather than closed it.

  `X-Forwarded-For` is **never** consulted to determine where a request came
  from: it is set by the caller, so honouring it would let anyone claim to be
  local — strictly worse than no gate at all. A same-host reverse proxy makes
  every request look local, so that topology sets `CEREFOX_API_REQUIRE_KEY=1`,
  which demands the key from every caller including loopback.

- **New guide: [`docs/guides/securing-local-access.md`](docs/guides/securing-local-access.md)** —
  whether you need a key at all (a table of concrete situations, including the
  two Docker networking cases that differ), why the boundary is drawn at the
  network rather than at every request, recipes for a harness in its own
  container and for a same-host reverse proxy, rotation without downtime, and
  an explicit list of what this does **not** protect.
- **`cerefox api-key generate|show|rotate`** and **`cerefox-local api-key
  [--rotate]`** to mint, read and replace that key. `generate` refuses to
  overwrite an existing key: silently replacing one would give every already
  configured client a 401 with no indication why.

### Changed

- **The three `/api/v1` ingest routes answer with real HTTP status codes
  (#232).** `POST /ingest`, `POST /ingest/file` and
  `POST /documents/{id}/upload` used to catch every pipeline failure and return
  `200` with `success: false`, including a *refused* write. A client checking
  `resp.ok` — what `raise_for_status()`, `curl -f` and every retry wrapper do
  by default — read a refusal as a success, and a concurrency refusal is the
  worst case to miss. They now return `400` for a missing concurrency token,
  `409` for a stale one (carrying `current_hash`), and `500` otherwise, which
  is the mapping the edit route has used since v0.11.0. Response bodies keep
  `success: false` and `error`, and gain `detail` so the message survives to
  the UI. Invisible while the API was the web app's private backend; it matters
  now that other clients are invited onto it.

### Security

- **Four high and three moderate advisories cleared** by pinning three
  transitive dependencies to their patched versions via root `overrides`:
  `fast-uri` (host confusion and SSRF, four advisories, reached through
  `@modelcontextprotocol/sdk` and `eslint`), `qs` (array-limit bypass and DoS,
  through `@modelcontextprotocol/sdk`), and `@xmldom/xmldom` (XML fragment
  injection, through `mammoth`). All were published upstream after v1.11.0 was
  cut and none is reachable from a direct dependency; `bun update` could not
  resolve past them because the intermediate packages' ranges pin them.

### Fixed

- **Live test suites skipped in a full `bun test` run (#230).** `loadEnv()`
  cached "already loaded" as a boolean, so the second call was a no-op forever
  — including after `CEREFOX_CONFIG_DIR` changed. One test sets that variable
  to a non-existent directory on purpose (proving the production-write guard
  refuses an unlabelled target), which poisoned the cache for the rest of the
  run: every live suite loaded afterwards saw no credentials and skipped. The
  cache is now keyed on the resolved path. **The full package suite went from
  215 passing with 12 skipped to 262 passing with 2 skipped** — 47 tests that
  had been reporting success while running nothing. Same shape as the
  renamed-probe bug fixed in v1.11.0.
- **`cerefox server deploy` explains an upstream package-registry failure
  instead of dumping a raw 400.** When Supabase publishes a new
  `supabase-js` to JSR before its npm dependency lands, every Edge Function
  fails to bundle for the length of that window; the bundler's reply is a 400
  with a JSR stack trace, repeated once per function, which reads exactly like
  a broken release. The deploy now recognises that signature and says what it
  is: upstream, your deployed functions are unchanged and still serving, retry
  in a few minutes. (Observed 2026-09-02 on a production deploy that landed in
  a 108-second gap between the two registries.)

---

## [v1.11.0] -- 2026-09-02

### Added

- **`/api/v1` accepts an optional caller identity (#226).** `author`,
  `requestor` and `author_type`, as `X-Cerefox-Author` /
  `X-Cerefox-Requestor` / `X-Cerefox-Author-Type` headers on any method, or as
  fields in the JSON body / multipart form where a route has one (a header
  wins). The API hardcoded `author: "web-ui"` at 17 call sites, so any client
  but the bundled web app was unattributable — which pushed agent harnesses
  onto MCP purely to obtain an identity. **Omitted, nothing changes**: the
  stored audit and usage rows are byte-identical to before, so the bundled web
  app and every existing client are unaffected. `author` and `requestor` stand
  in for each other, and `author_type: "agent"` queues an ingest for review
  exactly as it does over MCP — that equivalence is the point. The identity is
  **declared, not verified**: it is a label for attribution and record-keeping
  (the audit trail, usage analytics, the review queue), not a credential and
  not a security measure. Nothing checks it, exactly as nothing checks `author`
  over MCP.
- **`DELETE /api/v1/documents/{id}` requires the content hash from an
  identified caller**, as `X-Cerefox-Expected-Content-Hash` or an
  `expected_content_hash` query parameter — the same "a delete must follow a
  read" rule `cerefox_delete_document` enforces over MCP. The route previously
  passed no CAS token at all, which was defensible while its only caller was
  the web UI, where a human sees the document and confirms in a dialog.
  Identified callers have no such dialog. An anonymous caller is the bundled
  UI and is unaffected.
- **A new `api` access path**, derived rather than accepted: name yourself and
  the operation logs as `api`, otherwise `webapp`. There is deliberately no way
  to request a particular access path, because it is the one field in the usage
  log the server still sets itself. The Dashboard counts `api` toward agent
  operations and the Analytics filter offers it.
- **`docs/guides/api.md`**, the first reference for the HTTP API: the
  caller-attribution contract, the concurrency rules, and the full endpoint
  list — opening with an unmissable statement that the surface has **no
  authentication of any kind** and is **for local access only**. Not to be
  exposed to a LAN, a tunnel, or a TLS-only reverse proxy: encryption is not
  authorization. Adding a locally generated key is tracked as #229.

### Fixed

- **`POST /api/v1/documents/{id}/upload` has failed on every call since
  v0.11.0 (#228).** It passed neither `expected_content_hash` nor
  `last_write_wins`, so the concurrency contract introduced in v0.11.0 rejected
  it every time. It now takes the same contract as every other content update:
  send the hash you read, or say `last_write_wins=true` explicitly. There is no
  implicit default — the endpoint has been a hard error for eleven releases, so
  there is no working caller to stay compatible with and the strict semantics
  cost nothing. The bundled web app never calls this endpoint; API clients got
  a hard stop.
- **`cerefox doctor` named the wrong config file (#225).** The `legacy env`
  check hardcoded `~/.cerefox/.env` instead of asking the resolver, so under
  `CEREFOX_CONFIG_DIR` it contradicted the `config` line four rows above it.
  It also fired on any `<cwd>/.env` whatsoever, without the `CEREFOX_*`-key
  test the resolver has used since iter-24 — so running `cerefox` inside an
  unrelated project named that project's config file and called it "Safe to
  delete."
- **The web-integration test suite had been skipping since v0.9.0.** Its
  Supabase probe shelled out to `cerefox list-projects`, renamed to
  `project list` in v0.9.0; the renamed-verb husk exits non-zero by design and
  the probe read that as "backend unreachable". Eleven releases of a green
  suite running nothing, and the reason #228 went unnoticed. The probe is now
  one shared implementation that throws when the CLI rejects the probe command,
  because "the backend is down" and "that command no longer exists" are
  different answers and only the first justifies a skip.
- **The destructive web tests no longer spend Edge Function quota.** They built
  their fixture through the deployed `cerefox-ingest` function, a workaround
  from v0.6 when `/api/v1/ingest` was a 503 stub. They now ingest over HTTP
  like every other test in that directory.
- **Two tests failed under the documented staging invocation**
  (`CEREFOX_CONFIG_DIR=… bun test`), both environment-sensitivity in the tests
  rather than product bugs. A red test under the command the guides give
  teaches people that red is normal.
- **Audit authorship is consistent across the web routes.** Review-status
  changes and version archives recorded `author: "user"` while every other web
  write recorded `"web-ui"`, so an `author='web-ui'` filter silently missed
  both. Existing rows are unchanged.

### Changed

- **The repo-root `docker-compose.yml` publishes to `127.0.0.1` (#227).** Its
  short `"8000:8000"` / `"5432:5432"` form binds the host's `0.0.0.0`, so it
  exposed an unauthenticated write API and a database with in-file credentials
  to the local network. Both shipped local paths (`docker/local/`) already bind
  loopback deliberately; this file contradicted them. `--host 0.0.0.0` in the
  `Dockerfile` CMD is correct and stays: the container's loopback is not the
  host's, so the bind must be broad and the publish narrow.
- **`require_requestor_identity` documents what it actually covers.** It is
  enforced by the Edge Functions only, including remote MCP — **not** by the
  local stdio MCP server, `/api/v1`, or the CLI. No behaviour change; the
  setting's name promised more than it delivered and an operator enabling it
  deserves to know where the gaps are.
- **The root `typecheck` script now includes the frontend.** `tsc --noEmit` in
  `frontend/` checks nothing (its `tsconfig.json` is `files: []` plus project
  references), so a local typecheck silently skipped the whole SPA. CI built it
  and was unaffected.

---

## [v1.10.1] -- 2026-08-22

### Added

- **Write-time escaped-content warning (#222).** When ingested or edited
  content carries the over-escaping signature — literal `\n` / `\"` sequences
  at 25%+ of the real newline count (at least 3) — the MCP write response and
  the CLI ingest summary append a non-blocking note naming the counts and the
  fix. Calibrated on real incident data: legitimate documents that *discuss*
  escaping sit far below 1% and stay quiet. A signal in the write's response,
  never a refusal, and deliberately never a normalization (auto-converting
  would corrupt legitimate content and mask the emitting client's bug).
- **Agent guides document the escape-drift failure mode** (from live agent
  feedback, the #222 companion): long multi-line content authored inline in a
  tool call can arrive with a stretch JSON-escaped one level too many —
  literal `\n` and `\"` mixed into the stored text. Cerefox stores exactly
  the bytes it receives (byte-level verified), so `AGENT_GUIDE.md`, the quick
  reference, and the bundled `cerefox_get_help` content now teach the
  authoring-side practice: ingest long content from a file, build big
  documents incrementally with `cerefox_insert`/`cerefox_edit`, and read back
  multi-line writes. The server-side write-time warning is tracked as #222.

### Fixed

- **The gated live suites no longer strand fixtures.** Their audited cleanup
  (soft-delete + purge per document) exceeded the test runner's default
  5-second hook budget and died partway, leaving fixtures in the trash where
  the suites' fixed per-test content then collided across runs via
  content-hash dedup. Hooks got a realistic budget and every repeated content
  is now run-unique; both suites recorded their first fully green runs
  (26/26, 19/19).

---

## [v1.10.0] -- 2026-08-19

### Changed

- **Title renames are atomic** — new `cerefox_rename_document` RPC commits
  the row update, the chunk-FTS refresh (title boosting), and the audit
  entry in one transaction, replacing client-side sequencing that could
  commit the rename and then fail the refresh with no retry path. Schema
  0.14.1 → **0.15.0**, migration 0030. (`minSchema` stays 0.14.0: against a
  0.14.x server, title edits fail loudly with redeploy guidance while
  everything else works.)
- **An unchanged project-membership set is now a complete no-op on every
  interface** — previously `cerefox_set_document_projects` (MCP/CLI) wrote
  an audit entry even when the set did not change; the trail never records
  non-events now.

### Fixed

- **Web document-save moved onto the shared cores** (it was the last
  multi-facet write path with its own implementation), fixing three things at
  once: title renames from the web UI now refresh chunk FTS (title boosting
  had been silently skipped there since the web editor shipped — renamed
  documents ranked as if they still had the old title); metadata saves go
  through `cerefox_set_document_metadata` (replace mode), inheriting the
  malformed-metadata guards and the per-key audit report; and the audit
  entry `Updated via web UI (title=…, metadata=…, projects=…)` — which
  recorded what the request carried, not what changed — is gone. Every facet
  now diffs against the stored value first (an unchanged facet writes no
  entry) and records the same factual description as the CLI/MCP for the
  same change (`Title changed: 'a' → 'b'`, `Set document projects to […]`,
  `Metadata replaced/merged …`). The CLI's bare "Edited title" entry is
  upgraded to the factual diff too. Also from the review of this change:
  clearing the last metadata key in the web editor was a silent no-op that
  toasted success (now `{}` genuinely clears); a save that partially applies
  reports exactly which facets committed; typed errors map to 404/400
  instead of prose-matching; and the web editor's error toasts now show the
  server's actual message.

---

## [v1.9.2] -- 2026-08-18

### Changed

- **`cerefox self-update` no longer runs the bundled-guides sync
  automatically** — it prints the next steps instead (`server deploy`, then
  `guides ingest`). The upgrade ordering is necessarily client-first, so the
  automatic sync fired at the exact moment the new client faced the old
  server; a release that requires its own schema (like v1.9.x) failed the
  sync mid-upgrade, observed live. `cerefox server deploy` now points at
  `cerefox guides ingest` on success — the moment both sides are current.

---

## [v1.9.1] -- 2026-08-17

### Fixed

- **Project description edits no longer fail (v1.9.0 regression, caught in
  the staging dress rehearsal before any production deployment).**
  `cerefox_update_project` appended its audit-diff fragment with
  `v_changes || 'description changed'`; Postgres resolves the untyped
  literal via the array||array overload and raises `malformed array
  literal`, rolling back every project edit that changed a description
  (rename-only edits worked). Both branches now use `array_append`;
  migration 0029 re-ships the corrected function. Schema 0.14.0 → 0.14.1.
- **The gated live remote-MCP suite matches the current server contract**:
  the 15-tool core surface (its list was stale at 10 from before v1.3–v1.7)
  and in-band MCP tool errors (`isError`) for validation failures instead of
  JSON-RPC protocol codes. The release-acceptance project case now covers a
  description-only edit — the exact branch the regression lived in.

---

## [v1.9.0] -- 2026-08-17

### Added

- **Store-level writes join the audit trail (#147, first half; #219).**
  Config changes are recorded by `cerefox_set_config` itself — one
  `config-change` entry per write, in the same transaction, with the author
  and the old → new value — so "who turned retention off, and when?" is
  finally answerable from the trail. Project create/edit/delete go through
  three new RPCs (`cerefox_create_project` / `cerefox_update_project` /
  `cerefox_delete_project`) that write AND audit **in one transaction**, per
  the single-implementation principle — every interface (CLI, web, MCP
  document assignment, the ingestion pipeline, the ingest Edge Function) is
  a thin caller, so no future write path can forget the trail. Implicit
  creation during document assignment is attributed to the write that caused
  it; a delete that matched nothing audits nothing. These entries carry no
  `document_id`, the same shape as purge-orphaned rows, so existing audit
  readers need no changes. `cerefox config set` and the three
  `cerefox project` commands accept `--author` (falling back to
  `CEREFOX_AUTHOR_NAME`, then `unknown` with a warning). Schema
  0.13.0 → 0.14.0, migration 0028.

  **Redeploy required**: `minSchema` is raised to **0.14.0** — the first
  raise since the compatibility policy was written. This client resolves and
  creates projects through the new RPCs on its core write path (ingesting
  with a project name), so against an older server routine work degrades to
  errors. After `self-update`, run `cerefox server deploy`; until then
  `cerefox web` refuses to start and `doctor` says exactly why.

### Changed

- **Settings page speaks the CLI's vocabulary.** Boolean settings display
  `true` / `false` (matching `cerefox config set`), the fallback caption now
  reads `default if unset: …` — it states what applies when the setting is
  *not* set, which next to an explicitly-set opposite value used to read as a
  contradiction — and the badge on unset settings says `using default`.

### Removed

- **Dead V1 RPC `cerefox_save_note`.** A Python-era leftover with zero
  callers since the TypeScript rewrite; no CLI command, MCP tool, Edge
  Function, web route, or SQL function ever reached it. Dropped by
  migration 0028; `db-status` no longer expects it. (Its sibling
  `cerefox_context_expand` looked equally dead from the TypeScript side but
  is called by `cerefox_search_docs` inside SQL — it stays, and the sandbox
  validation is what caught the difference.)

### Fixed

- **Deploys nudge PostgREST's schema cache.** `server deploy` and the
  migration path now send `NOTIFY pgrst, 'reload schema'` after DDL, closing
  the window where a just-changed RPC returns "Could not find the function"
  through the Data API (hosted Supabase auto-reloads within moments; a plain
  PostgREST — Cerefox Local — did not). Error messages for that window now
  say "retry in a few seconds" instead of misdiagnosing an undeployed server.
- **Documentation caught up with v1.4.0 → v1.8.0** (22 findings): the
  solution design now reflects chunks-anchored versioning with artifact-free
  archived chunks and the current documents DDL; requirements gained FR
  numbers for everything shipped since v1.3; agent guides state the correct
  tool surface (15 core + 4 dormant relation tools); READMEs stop citing
  env vars retired in v1.1.0; the e2e catalog lists the 12-case release
  acceptance harness and its coverage; the ops-scripts inventory matches the
  current schema — and `db-status` itself now verifies the post-v1.0 tables
  and RPCs it had silently stopped covering (`cerefox_usage_log`,
  `cerefox_config`, `cerefox_document_relations`, and seven newer RPCs).

---

## [v1.8.0] -- 2026-08-15

### Changed

- **Archived chunks no longer carry search artifacts (#216, reported by
  @tdebasis).** Search is current-chunks-only by design (every search index
  is partial on `version_id IS NULL`), version reconstruction and diffs read
  `content`, and restoring an old version is deliberately manual re-ingest —
  so embeddings and FTS vectors on archived chunks were never readable by
  anything: pure storage cost, measured at 30–45% of the chunk relation on
  long-lived stores, and stale for the current embedder after any reindex
  besides. `cerefox_snapshot_version` now nulls `embedding_primary`,
  `embedding_upgrade`, and `fts` in the same UPDATE that archives the rows;
  migration 0027 back-fills the invariant onto existing archived chunks and
  reports what it freed. The archived *content* — the actual safety copy —
  is untouched, and there is deliberately no config and no maintenance
  command: nothing can read the artifacts, so this is an invariant, not a
  policy. Space note: Postgres frees the bytes for reuse via autovacuum;
  growth stops even if reported database size does not drop immediately.
  Schema 0.12.2 → 0.13.0.

### Fixed

- **`cerefox doctor` remediation commands are environment-aware.** In a
  parallel-environment setup (`CEREFOX_CONFIG_DIR`, see `staging-env.md`),
  doctor's copy-pasteable remediation printed a bare `cerefox …`, which acts
  on the DEFAULT environment — not the one just diagnosed. When a config dir
  is set, the remediation now says to prefix the command the same way (or
  use the environment alias). Observed live: a staging doctor's suggestion
  ran against production.

---

## [v1.7.1] -- 2026-08-14

### Added

- **Dead-link sweep — phase 2 of link integrity (#214).**
  `cerefox document dead-links` (backed by the read-only
  `cerefox_find_dead_links` RPC) scans the whole KB for `[Text](uuid)` links
  whose target document no longer exists — the case the write-time guard
  deliberately tolerates on unrelated edits so a purged target cannot make
  its linkers unwritable. Same scanning rules as the guard (code formatting
  escapes; a trashed target still exists and is not dead). On demand, not in
  doctor — it is a full chunk scan.
- **`cerefox doctor` checks metadata well-formedness** (informational):
  documents whose stored metadata is not a JSON object are listed with the
  repair command (`cerefox_metadata_health` RPC). Schema 0.12.1 → 0.12.2,
  migration 0026 — which also reports any such rows at upgrade time.

### Fixed

- **`cerefox document edit` no longer destroys non-object metadata (#212,
  reported by @tdebasis).** `metadata` is jsonb and can legitimately hold a
  non-object value; the command's JS spread *decomposed* those (a stored
  string became one key per character, a number became `{}`) and wrote the
  result back with "✓ Edited" — even on a title-only edit, which never
  mentioned metadata. Fixed at every layer: the ingest RPC rejects
  non-object `p_metadata` (the MCP layer always did; now every write path
  agrees), `cerefox_set_document_metadata` refuses to *merge* onto a
  non-object stored value (Postgres `||` would produce an array; only
  `--replace` repairs, and the error says so) **while the `--replace` repair
  itself now works on corrupt rows** (its change-reporting called
  `jsonb_object_keys` on the scalar and rolled the repair back), the web
  edit route validates metadata at runtime (a cast is compile-time only),
  a table-level `CHECK (jsonb_typeof(metadata) = 'object')` closes every
  current and future direct writer (added `NOT VALID` on existing databases
  so legacy rows survive until repaired), and `document edit` now delegates
  its metadata patch to the guarded, audited `cerefox_set_document_metadata`
  RPC instead of merging client-side — title-only edits do not touch
  metadata at all.
- **The `](uuid)` link scan no longer goes blind after a code fence.**
  Postgres regexes give a whole pattern the greediness of its *first*
  quantifier, so the v1.7.0 fence-stripping regex consumed from the first
  fence to end-of-content — silently skipping validation of every link
  after any code block. The scan now splits on line-anchored fence markers
  (no pairing regex at all) and lives in ONE shared function
  (`cerefox_extract_doc_link_ids`) used by both the write guard and the
  dead-link sweep, so the two can never disagree.
- **`cerefox document dead-links` refuses to report a clean sweep it never
  ran**: against a pre-0.12.2 server it says "run `cerefox server deploy`"
  instead of printing a false all-clear.
- **Orphaned 1-arg overloads of `cerefox_purge_document` / `cerefox_restore_document`
  dropped** (schema 0.12.0 → 0.12.1, migration 0025). `CREATE OR REPLACE`
  never removed the pre-author-era signatures when the functions grew, so
  long-lived databases carried both overloads and a named 1-arg call was
  ambiguous (PostgREST PGRST203) — found by a live acceptance run against a
  long-lived database. Fresh databases were never
  affected. The acceptance harness now passes all three purge args, checks
  the soft-delete's error before purging, and sweeps the audit rows the
  purge cascade orphans (document_id nulled), which the id-based cleanup
  missed.

### Docs

- **New guide: [`docs/guides/linking.md`](docs/guides/linking.md)** — the
  consolidated linking story: link forms, why LLMs corrupt long ids when a
  document carries many (token-by-token regeneration, zero redundancy,
  compounding), the write-time guard, update semantics, escaping, and the
  dead-link sweep.

---

## [v1.7.0] -- 2026-08-14

### Added

- **`cerefox_delete_document` MCP tool — agents can now soft-delete (#208).**
  Closes a parity gap, not a policy: the trust model always sanctioned agent
  soft-delete (audited, recoverable from the web-UI trash), but the tool was
  never built, so agents had no path where the CLI had `document delete`. The
  tool requires `expected_content_hash` — the MCP analogue of the CLI's y/N
  prompt: a delete must follow a read, and a stale hash fails with a conflict
  (re-read, reconsider, retry). An optional `reason` is recorded in the audit
  entry for the human reviewing the trash. Its inverse ships alongside it
  (below); permanent purge remains web-UI-only.
- **`cerefox_restore_document` MCP tool — the delete's audited inverse (#210).**
  By maintainer decision, restore moves out of the human-only tier: every
  restore is audited with author attribution, restoring cannot destroy
  content, and the CLI had `document restore` all along. Restoring a
  non-deleted document is a reported no-op. **Permanent purge remains
  web-UI-only** — the one action that destroys data keeps its
  human-in-the-loop confirmation. Tool surface: 15 core + 4 dormant.
- **`cerefox document delete --reason` / `document restore --reason` are now
  recorded** in the audit-log entry (delete's was previously printed but not
  stored; restore had no reason flag).

- **Referential integrity for UUID document links (#214).** Every write now
  validates `[Text](uuid)` links against the store and rejects the write if
  any target id does not exist, listing the offenders. Agents mangle long
  random ids when regenerating text; this turns a silent dead link into a
  loud, same-turn-fixable error (~1–2ms per write — one regex pass and one
  indexed lookup). Fenced code and inline code spans are not validated —
  code formatting is the markdown-native way to write an example link — and
  `[[wikilinks]]` remain the sanctioned dangling form. On updates only
  newly-introduced links are validated, so a document that already carries
  a dead link (target purged after linking) stays editable and syncable;
  creates validate everything. Fence pairing is line-anchored, so a stray
  backtick run in prose cannot un-escape a real code block. The GPT-Actions
  ingest Edge Function maps the new rejections (422 unresolved links, 409
  deleted document) and the pasted OpenAPI block documents them
  (info.version 3.2.0). Design: `docs/specs/link-integrity-design.md`.
- **Dashboard: the recently-changed tile can be scoped to a project.** A
  selector next to the tile (default "All projects", the previous behavior)
  refetches the top-10 recently changed documents within the chosen project —
  the "what did agents change in X lately" view — via a dedicated light
  endpoint (`/api/v1/dashboard/recent-docs`), so flipping projects moves 10
  rows, not the whole dashboard aggregate. The tile's "View all" link, which
  just opened search and did not do what it promised, is removed.

### Changed

- **`cerefox_ingest` now refuses to rewrite a soft-deleted document.** Before,
  an update by `document_id` on a trashed document silently landed content in
  a document excluded from search — a write into a black hole — and it broke
  restore's contract that what was reviewed in the trash is what comes back.
  The error says to restore first or create a new document. Three companions
  make the whole re-ingest-after-delete story coherent: title/source-path
  resolution **prefers a live match over a trashed twin** (recency alone
  resolved a freshly-trashed doc and made the live one unreachable);
  filesystem-sync flows (`ingest-dir`, `guides ingest`) **skip** trashed
  matches with a note instead of erroring forever — the deletion is
  respected and the sync converges; and an identical-content re-upload says
  the content **is in the trash** instead of "already up-to-date" about a
  document search cannot find. The web edit and review-status routes refuse
  writes to trashed documents with a 409 (metadata-only saves previously
  slipped through).
- **A delete on an already-trashed document validates the read-hash first.**
  "A delete proves a read" now holds for trashed documents too: a stale or
  garbage hash is a conflict, not a reported no-op.
- **`cerefox_delete_document` RPC** (schema 0.11.3 → 0.12.0): optional CAS via
  `p_expected_content_hash` (`CEREFOX_CONFLICT`/PT409 on mismatch, same
  pattern as the ingest CAS), `p_reason` appended to the audit description,
  JSONB return instead of VOID, and idempotent re-delete (original
  `deleted_at` preserved, no duplicate audit entry). Re-run
  `cerefox server deploy` to pick it up; reconnect MCP clients to see the new
  tool.

### Fixed

- **Review-status pills no longer go stale after a toggle.** Flipping
  pending-review → approved on a document invalidated only that document's
  query, so navigating back to the dashboard, search results, or a project
  list showed the old status until a manual refresh. The toggle now
  invalidates the same set of views a delete or restore does; that set gains
  project document lists and the document's own audit-trail card, and the
  Trash page's mutations get the same completion.
- **Web lifecycle routes report client-state races as 404, not 500.** Deleting
  or restoring a document that another tab already purged used to surface the
  raw RPC error as a server error; both routes now return 404 and pass
  through the RPC's `already_deleted` / `restored` honesty signals. A
  malformed `project_id` on `/api/v1/dashboard` is a 400 naming the
  parameter instead of failing the whole dashboard with a 500.
- **CLI delete/restore verify before claiming.** The shared RPC wrapper maps
  "function does not exist" to a null result — indistinguishable from a
  pre-0.12.0 server's void success — so both verbs now confirm the document's
  actual state before printing ✓, and a mid-deploy missing-function error
  gets redeploy guidance that only mentions `--reason` when it was passed
  (detection single-sited in `isMissingFunctionError`, five hand-rolled
  copies before).
- **Whitespace around a concurrency token no longer fakes a conflict.** Both
  the delete CAS and the ingest CAS trimmed the hash for the presence check
  but compared it raw, so a correct hash with a stray trailing newline was
  reported as "changed since it was read" — with two hashes that look
  identical and a re-read that can never fix it. All comparison sites now
  trim: both RPCs, the MCP handlers, and the CLI/web pipeline's advisory
  fast-fail (which otherwise faked the same conflict before the fixed RPC
  was ever reached). Found by review on #208; the ingest side had carried
  the flaw since iter-32.
- **`cerefox document delete` reports what actually happened.** If another
  writer deleted the document while the confirmation prompt sat open, the CLI
  used to claim success (and a recorded reason) for a delete that was a no-op;
  it now reads the RPC's `already_deleted` return and says so.
- **A v1.7.0 client against a pre-0.12.0 server gets actionable guidance**
  ("run `cerefox server deploy`") from both the MCP delete tool and
  `document delete --reason`, instead of a raw schema-cache error.
- **The stdio smoke test derives its expected tool list from the registry**
  instead of a hardcoded 10-name list that had been stale since v1.4.0
  (invisible because the test probe-and-skips without live credentials).
- **The quick-reference CLI mapping table** gained the missing
  `cerefox_insert` / `cerefox_edit` / `cerefox_delete_document` rows and lost
  four relation-tool rows that had been pasted in with the wrong columns; the
  bundled `cerefox_get_help` content is regenerated to match.
- **Stale docs**: the Path A tool table in `connect-agents.md` was missing the
  v1.4.0 partial-edit tools, its "all core tools on Path B" claim predated the
  MCP-only tools (GPT Actions exposes 8 primitive operations), and two
  relation-count arithmetic leftovers said 16 where the total is 18. The
  doc-count guard now also catches "N named tools" phrasing.

---

## [v1.6.1] -- 2026-08-12

### Fixed

- **Dashboard table columns are sized to their content.** `table-layout: fixed`
  went in to stop long agent names widening the panel, but without explicit
  widths the browser shares the space evenly — so Document truncated titles at a
  dozen characters while Chunks held a three-digit number in a column twice as
  wide. Counts, sizes and timestamps now get the width they actually need and
  Document takes the rest, going from roughly 90px to 258px.

- **The project and review-status badges no longer print over the Author
  column.** They had no bound, so a long project name plus "pending review"
  overflowed the document cell. Measured on the rendered page: badges overflowed
  on every visible row before, none after.

---

## [v1.6.0] -- 2026-08-12

Target **v1.6.0** — a minor, because it adds an MCP tool and a CLI command.

> ### Upgrading
>
> **`cerefox server deploy` is required** — schema 0.11.2 → **0.11.3**
> (migration 0023). Then **reconnect your MCP client**: clients fetch the tool
> list once at connect, so the new tool stays invisible until they do.

### Added

- **`cerefox_set_document_metadata` — change a document's tags without
  resending its content** (#204). Until now `cerefox_ingest` was the only write
  path for metadata and it requires title + content, so setting one key meant
  re-sending the whole document, reproducing every untouched character. That is
  the transcription risk the partial-edit tools were built to remove, still
  fully present for metadata. Project membership had a metadata-only writer
  (`cerefox_set_document_projects`) all along; tags never got one.

  **Merges by default**: the keys you pass are set, every other key is left
  alone — so you need not read the document first, and cannot drop a tag another
  agent set. A destructive default was rejected deliberately: several agent
  roles write to the same documents, and silently dropping their keys is the
  same defect class as #183 and #191.

  **A `null` value removes a key**, following RFC 7386 (JSON Merge Patch) —
  unambiguous because Cerefox metadata values are JSON strings by convention.
  `replace: true` sets the metadata to exactly the object given, matching
  `set_document_projects`' destructive contract for callers who mean it.

  The merge happens inside one `UPDATE` against a locked row, so two agents
  setting *different* keys concurrently both succeed; a client-side
  read-modify-write would have let one silently overwrite the other.

  Ships with its CLI counterpart in the same change —
  `cerefox document set-metadata <id> --set key=value` / `--remove key` /
  `--json '{...}'` / `--replace` — because #201 is the standing lesson that a
  tool on one surface is a tool half-shipped.

### Changed

- **The README finally lists partial document edits.** `cerefox_insert` /
  `cerefox_edit`, the section read, and metadata writes — the headline features
  of the last three releases — were absent from the project's front page
  entirely.

- **The dashboard's agent-operations tile no longer overflows its header row**
  (#205). Three access paths in the badge plus two below split the information
  with no visible logic, and the badge outgrew the row the other three tiles
  share. The badge now carries the two MCP transports — the agent paths behind
  the headline count — and everything else sits beneath it, where `edge`
  belongs anyway since it is normally zero unless you run a Custom GPT.

- **The dashboard's lower panels line up with the stat tiles again** (#206).
  `grid-template-columns: 1fr 360px` was the cause: `1fr` is `minmax(auto, 1fr)`
  and its `auto` minimum is *min-content*, so a table wider than its share
  expanded the track and overflowed the page container — which is what happened
  once agent author names grew from `user` to `Claude|Financial-Planner`. Now
  `minmax(0, 1fr)`, with the author column capped and ellipsised (full value in
  the cell's title) and `table-layout: fixed` so one long value can never size
  the table again. Measured on the rendered page: 64px out before, 0px now.

- **`cerefox_get_help()` states the server version on every response**, not only
  under `topic: "server"`. Hiding it behind a topic had a bootstrap problem an
  agent found within hours: the remedy for a stale server required a server new
  enough to contain the remedy. The **absence** of that block is now diagnostic
  too — a server that does not print it predates v1.5.0.

### Fixed

- **`--set key=null` on the CLI is refused rather than guessed.** Over MCP a
  JSON null *removes* a key (RFC 7386), while `--set key=null` stored the
  literal string `"null"` — a silent divergence on the one semantic most likely
  to be misread. On a command line the same text could genuinely mean the word,
  so the command now points at `--remove key` or `--json '{"key":"null"}'`.
  Found reviewing the PR; the parity test that should have caught it was
  asserting that a line of source exists rather than what the command does.

- **The `self-update --check` tests skip when the npm registry is unreachable.**
  They fetch `registry.npmjs.org` directly, so they failed a CI run and a local
  run on the same day for reasons unrelated to any change — and a job that fails
  like that is one people learn to re-run rather than read. A reachable registry
  still asserts the full contract.

- **The UI e2e suite no longer installs dependencies on every run.** Its server
  command called `build-frontend`, which runs `bun install`; a test command
  should not mutate the lockfile or pay an install each time.

- **The UI e2e suite was testing the wrong server** (#155). It defaulted to port
  8000 and derived `reuseExistingServer` from whether a port had been passed, so
  a plain `bun run test:e2e` silently tested a developer's own `cerefox web`
  daemon — a different build against different data. That is why it read as "8
  of 13 tests broken" when the tests were fine: they pass 18/18 against the
  build in the repo. Port and reuse are now separate settings, the default
  starts its own server on 8123, and `CEREFOX_E2E_REUSE=1` opts in to testing
  something already running.

- **The UI e2e suite was also serving a stale SPA.** `cerefox web` serves
  `packages/memory/dist/frontend`, populated by `bundle-frontend` — which only
  ran at publish time, so a plain `bun run build` left the served UI as of
  whenever someone last published. The suite now rebuilds and re-bundles the
  frontend before starting the server, so it tests the code you changed.

- **The UI e2e suite refuses an unlabelled (production) target.** It creates
  real documents and projects, and it was the last live suite without that
  guard — missed because it runs under Playwright rather than `bun test`, so the
  coverage guard that enumerates live-capable suites never saw it.

---

## [v1.5.0] -- 2026-08-12

Iteration 36 — observability, surface parity, test hygiene, and a security fix
that arrived mid-iteration. Target **v1.5.0**.

Versioned as a **minor, not a patch**: it adds CLI flags and a JSON field, and
refuses input that was previously accepted.

> ### Upgrading
>
> **`cerefox server deploy` is required** — schema 0.11.1 → **0.11.2**
> (migration 0022), and the Edge Functions changed too, so deploy both. Do not
> pass `--schema-only`.
>
> **Then reconnect your MCP client.** Clients fetch the tool list once at
> connect and cache it, so a running session will not see the new behaviour
> until it reconnects.

### Security

- **RLS was disabled on `cerefox_document_relations`** — the one table of ten
  that never reached `schema.sql`'s `ENABLE ROW LEVEL SECURITY` block, having
  been added in iteration 29 without it. Cerefox's model is *RLS on with no
  policies*: the service-role key bypasses RLS and everything else is denied by
  having nothing to match. A table outside that block is reachable by any role
  holding a grant on it — and on projects created before Supabase stopped
  granting `anon` blanket privileges on `public`, `anon` holds all four verbs
  there. The anon/publishable key is designed to be public, so that meant world
  read and write on that table. Flagged by Supabase's advisor
  (`rls_disabled_in_public`) on 2026-08-09.

  **No document content was ever exposed.** Documents, chunks, versions, audit
  log, config and projects were correctly protected throughout — an anon read of
  any of them returns an empty set. Relations are opt-in (`relations_enabled`,
  default false), so the affected table is empty on a default install; what was
  open was the ability to *write* to it.

  Migration 0022 enables RLS and revokes the legacy `anon` grants. A guard test
  now compares the tables `schema.sql` creates against the tables it protects —
  the check that was missing for a year, since the schema applied cleanly and
  the two lists were comparable only by eye.

### Added

- **`cerefox document get --section "## Heading"`** (#201), with
  `--section-part own_body|subtree`. The section read shipped in v1.4.0 on the
  MCP path only, so for a release it was unreachable from a terminal. Both
  resolve extent through the same `extractSection` as the MCP tool and the write
  path, so the equivalence #198 rests on holds across surfaces rather than being
  reimplemented per surface.

  Worth knowing for future additions: `document edit-parts` takes an opaque JSON
  operations array, so a new *operation* reaches the CLI for free — which is why
  `rename_section` worked from the terminal the day it landed. `document get`
  takes declared flags, so a new *read mode* does not.

- **`cerefox_get_help(topic: "server")` reports the server's own version and the
  operations it registers.** Three separate reports have claimed a capability
  was missing from one server when both were correct and the *client* held a
  tool list fetched before an upgrade. The standing advice was to check
  `cerefox --version`, which is useless to an agent with no shell — and most
  agents have no shell. The answer is now in-protocol.

### Changed

- **Text that repeats the anchor's own heading is refused.** `replace_section`
  preserves the heading and `insert` places text inside the section, so
  including it produced two of them, silently. One agent hit this twice in a
  session, the second time while repairing the first — the shape that makes a
  silent trap expensive, because the fix looks like more of the same call.
  `before_heading` is deliberately not guarded: text placed before a heading
  becomes a sibling section, and repeating the name there is a reasonable way to
  split one. **This rejects calls that previously succeeded**, which is the main
  reason this release is a minor.

- **The dashboard shows agent access paths separately** (#195). `local-mcp`,
  `remote-mcp` and `edge-function` were collapsed into "N mcp · N edge", which
  hid which transport was in use and made a bare "0 edge" read as broken when it
  means the ChatGPT Actions path was simply unused in the window. CLI operations
  are now shown as their own figure rather than folded into the agent total: the
  usage log records both requestor and access path, but the summary endpoint
  does not cross-tabulate them, so separating an agent's CLI use from a human's
  is not possible at that layer.

- **Timestamps carry their UTC marker** (#199). `audit-log` truncated to 19
  characters and dropped the `Z`; `list_versions` emitted a bare *date*, which
  is indistinguishable from a local one. An agent working a Pacific afternoon
  read `2026-08-11` from version history and dated a day of log entries into the
  future. The instant was always correct; only the label was missing.

  Cerefox deliberately does **not** convert to local time on the API or MCP
  paths — "local" has no server-side meaning (the remote MCP runs where local
  *is* UTC), it would make the same document report different times per
  transport, and naked local times are not comparable between agents. The web UI
  converts because a browser knows the viewer's timezone. The agent guides now
  say so, and add the rule that prevents recurrence: **a date written into
  document *content* comes from your own clock, not from a Cerefox timestamp.**

- **`configure-agent --json` includes `serverName`** (#202). Before #168 the
  name was always `cerefox`; now it varies with `CEREFOX_ENV_LABEL`, which is
  exactly when a machine-readable consumer needs it.

- Agent-facing guidance now states that **content between sections belongs to
  the section above it** — a `---` rule or note sitting just above the next
  heading is part of the section before it, and replacing that section takes it
  too. An agent lost a separator exactly this way. The write was correct by the
  addressing rules; the surprise is that "the end of this section" is further
  down the page than it looks, and the loss warning does not catch it when the
  replacement text is longer than what it replaced.

- Agent-facing guidance gains a **"Mistakes that have actually happened"**
  section, drawn from real sessions: a section-sized edit sent as a full ingest
  (which truncated a 13,000-character index to one word), repairing partial
  edits with more partial edits, and mistaking a stale client for a missing
  server capability.

### Internal

- **A committed release-acceptance harness**, driving both the CLI and the local
  MCP server and comparing them against each other rather than against
  hand-written expectations. Every release so far was validated by a throwaway
  script with no teardown, which is why fixtures kept being left behind. Cleanup
  goes through the safety gate — soft delete, then `cerefox_purge_document`,
  which refuses anything not already soft-deleted — so a mis-scoped id can only
  ever reach the trash.

- **`CEREFOX_VERSION`** is now the release version `_shared/` reports, bumped on
  every cut including pre-releases. `EF_VERSION` bumps unconditionally only at
  stable cuts, so it would have told a beta tester the last stable number.

- **`search-recall` cleans up by created id** rather than by title prefix, which
  deleted whatever matched and would have had two concurrent runs deleting each
  other's fixtures. It now clears the orphaned audit rows too.

- The dashboard's access-path arithmetic is extracted into its own module with
  browser-free tests, since the Playwright suite is 8/13 failing (#155) and the
  computation was the part that was wrong.

## [v1.4.0] -- 2026-08-11

Iteration 35 — the partial-edit feature completing itself under real usage, plus
guard debt. Target **v1.4.0**.

> ### Upgrading
>
> **`cerefox server deploy` is required.** Schema 0.11.0 → 0.11.1 (migration
> 0021), and the Edge Functions changed, so deploy both — do not pass
> `--schema-only`.
>
> **Then reconnect your MCP client.** Clients fetch the tool list once when they
> connect and cache it, so an already-open session will not see `rename_section`
> or the section read until it reconnects. This is not hypothetical: an agent on
> v1.3.0 concluded the remote server was missing a tool and filed it as a
> deployment gap, when the server had been correct all along and the client was
> holding a pre-upgrade tool list. Restart the client, or toggle the connector.

### Added

- **`cerefox_get_document(section: "## Heading")` — read one section** (#198).
  Returns exactly the text a `replace_section` on that anchor would overwrite,
  plus the heading as separate context (the heading is kept by a replace, so it
  is not part of what would be destroyed), the `content_hash` and the size.
  Completes the loop: outline to find the anchor, section read to see what you
  are replacing, edit to replace it.

  v1.3.0 shipped `replace_section` with no way to see what it was about to
  destroy — the outline reports a section's *size*, never its *text* — so the
  only safe preparation was a full read, which is the cost partial edits exist
  to remove. `cerefox_insert` is guarded structurally, since it cannot remove
  anything; the destructive operation was guarded only by
  `expected_content_hash`, which protects against a *concurrent* writer, not
  against a writer who does not know what it is deleting.

  The read resolves extent through the same functions as the write, takes the
  same `section_part`, and refuses on the same ambiguity — asserted as a
  property across every heading of six document shapes. A read that resolved
  extent differently from the write it feeds would be worse than no read at
  all: today a caller knows it is blind, whereas a subtly-wrong read looks like
  knowledge.

- **`rename_section` — change a heading's text without touching its body**
  (#197). A fourth `cerefox_edit` operation: `{op, anchor_heading, new_heading}`.
  Body and position untouched, which is the whole point — `replace_section`
  preserves the heading by design, and delete-plus-reinsert risks the body and
  the position to fix a heading. An agent hit this on a heading whose date had
  gone stale, judged that trade wrong, and left the document stale.

  A level change is refused: `##` → `###` re-parents everything nested under the
  heading, which is a restructure with a different blast radius, and doing it
  silently under the name "rename" is the kind of surprise this contract
  refuses. Renaming changes the anchor, so a later operation in the same call
  must target the new heading.

### Changed

- **Content loss is reported by what was touched, not by what fraction** (#196).
  The shrink warning gated on >25% and so was structurally blind to the case it
  was built for: append a 400-character entry to an 11,000-character document,
  replace the last section, and 4% silently takes the new entry with it. The
  loss that matters is small *precisely because it was recently added*, so the
  more established the document, the quieter the failure. A destructive
  operation on a section that ran to the end of the document now gets the full
  explanation at any size; the ratio only decides loudness.

- **`configure-agent` names the MCP server after `CEREFOX_ENV_LABEL`** (#168).
  A labelled environment registers as `cerefox-<label>` alongside your
  production `cerefox` entry instead of replacing it, so an agent can hold both
  and staging can finally be used to exercise MCP behaviour before release.
  Unset is unchanged — still exactly `cerefox`, because that key is global and
  changing it would orphan every existing install. The command now prints the
  name it used.

- Tool descriptions steer partial edits toward the documents that need them
  most: `cerefox_ingest` states that updating replaces the whole document and
  names the case where the untouched content cannot be verified by reading it —
  IDs, hashes, numeric tables, indexes, registries. Drifting prose is caught on
  review; one wrong character in a UUID is not.

### Internal

- **The live test suites refuse to run against an unlabelled (production)
  target.** `cd packages/memory && bun test` resolves credentials exactly as the
  CLI does, so on a maintainer's machine it wrote real documents to production —
  self-cleaning, but the audit log is append-only. They now gate on
  `CEREFOX_ENV_LABEL`, with `CEREFOX_ALLOW_PROD_WRITE_TESTS=1` as a deliberate
  override, and a coverage test *derives* the set of write-capable suites rather
  than trusting a hand-maintained list — the first attempt at this guard missed
  two suites and still wrote to production.

### Fixed

- **`document ingest` no longer relabels provenance when `--source` is omitted**
  (#193). Commander defaulted it to `"cli"` and the CLI always sent it, so every
  re-ingest silently overwrote the stored origin. #191 fixed the RPC for callers
  that *omit* the parameter — which the CLI never did, so an RPC-level test
  passed the whole time the bug was live. Omitting it now preserves the stored
  value on update and records `cli` on create; passing it explicitly still
  relabels, deliberately.

- **The CLI prints `content_hash` on create** (the CLI half of #189, which fixed
  the MCP path in v1.3.0). A user who created a document had no token for its
  first edit, leaving re-read or last-write-wins.

- **`get_document(outline: true)` no longer implies anchors must be full paths.**
  Its description said the outline's paths "are exactly what cerefox_insert /
  cerefox_edit take as anchor_heading", which read as a required format; an
  agent used full ` > ` paths throughout believing bare headings would not
  resolve. They always have.

- **`typecheck` covers `packages/memory`, and runs in CI** (#171). It was
  `_shared` only and not wired into CI at all, so the CLI, the ingestion
  pipeline and the web server were unchecked — nine errors were sitting there,
  and a missing import had already reached a live run as a `ReferenceError`.
  Every type change in this release's #193 work was surfaced by the new
  coverage; on the old script all six sites were invisible.

- **Contributor scripts cannot re-implement CLI logic** (#194). A static guard
  for the class behind #166, where the backup scripts carried their own capture
  and restore path and drifted for two releases while reporting success.

- **Loss reporting counted UTF-16 units against code points**, so any document
  containing an emoji reported a phantom "removed N characters" on edits that
  removed nothing — including `cerefox_insert`, which is annotated
  `destructiveHint: false` precisely because it cannot lose content, and
  `rename_section`, whose whole purpose is leaving the body alone. Latent since
  v1.3.0, where the >25% gate hid it; the new reporting rule above would have
  surfaced it on every emoji-bearing document.

- **`configure-agent` pins the config directory onto a labelled entry.** Naming
  the entry `cerefox-staging` was only half of #168: MCP clients spawn the
  server with the *client's* environment, and a GUI client launched from the
  dock has none — so `CEREFOX_CONFIG_DIR` was absent at spawn time and an entry
  labelled `staging` quietly served **production**. Labelled entries now carry
  their own `CEREFOX_CONFIG_DIR` and `CEREFOX_ENV_LABEL`; production entries are
  byte-identical to before.

- **`document ingest-dir` no longer relabels provenance either.** The #193 fix
  landed only in `document ingest`, leaving the identical commander default in
  the bulk command — where a single `--update-if-exists` run rewrites the
  `source` of every matched document, the corpus-scale shape #191 reported. The
  create-vs-update decision also moves into the ingestion pipeline, which is the
  only layer that knows which branch ran: `--update-if-exists` against a
  document that does not exist yet is an update *intent* that performs a create,
  and the previous flag-based heuristic labelled that `agent`.

- **Loss reporting no longer goes quiet when a batch renames before deleting.**
  It matched the operation's path against the pre-batch outline, so a
  `rename_section` earlier in the same call left the later op's path unfindable
  — silencing the warning on exactly the batch shape `rename_section` was added
  to enable.

- **A failed section read reports invalid-params, not internal-error.** Anchor
  failures surfaced as JSON-RPC `-32603` while the identical anchor through
  `cerefox_edit` surfaced as `-32602`, so a client keying on the code would
  classify the same caller mistake two ways depending on whether it read or
  wrote.

---

## [v1.3.0] -- 2026-08-10

Consolidated from `1.3.0-beta.1` … `beta.4`; the per-beta sections below remain
as granular history.

> ### Upgrading — read this first
>
> **`cerefox server deploy` is required.** Schema 0.10.5 → 0.11.0 (migrations
> 0019 and 0020), and the Edge Functions changed too, so deploy both — a
> `--schema-only` run leaves remote-MCP agents without the new tools. `minSchema`
> is unchanged, so an un-redeployed server keeps working and simply lacks them;
> a 1.3.0 client against a 0.10.x server was verified working.

### Added
- **Partial document edits — an agent can change part of a document without
  resending it** (#186). The agent sends what changed; the server reconstructs,
  applies, re-chunks, re-embeds and writes. Two MCP tools:
  - **`cerefox_insert`** — add text at `end_of_document`, `end_of_section`,
    `after_heading` or `before_heading`. Purely additive: it cannot remove or
    overwrite anything, so a mistaken call cannot destroy content. Annotated
    **non-destructive**, so a client can grant it without prompting.
  - **`cerefox_edit`** — one to many operations (`insert`, `replace_section`,
    `delete_section`) applied **atomically**. Changes that belong together go in
    one call, so a table row and the total it feeds cannot end up disagreeing.
    Annotated destructive.

  Anchors are an exact heading line or a ` > ` parent path. **Nothing is ever
  guessed**: an absent anchor errors rather than falling back to appending, a
  repeated heading errors with the paths that disambiguate it, and a section with
  child headings errors with both `section_part` options rather than choosing
  where "the end of the section" is. Every write requires `expected_content_hash`
  and there is **no last-write-wins** — on these tools a conflict is information
  you need, not an obstacle.

  Why it matters: re-sending a whole document to change three lines means
  reproducing every untouched character verbatim, and any drift silently rewrites
  content nobody asked to touch. One agent reported doing this repeatedly across
  6,000–13,000 character documents; another destroyed a day's entries by sending
  only a new section to a call whose contract is *replace*. The contract was
  shaped by six real agent sessions before and during the beta, and their usage
  reversed the design three times.

- **`cerefox_get_document` outline mode** (`outline: true`) — heading paths,
  per-section sizes and the `content_hash`, without the body. The paths come back
  in exactly the form `anchor_heading` accepts, so discovery and editing share one
  addressing language. This is what makes editing-without-reading actually viable.

- **CLI**: `cerefox document insert`, `cerefox document edit-parts`,
  `cerefox document get --outline`. Same shared handlers as the MCP tools, so the
  two cannot diverge.

- **Partial edits report what they removed.** The response carries the previous
  size, and a write that removes more than a quarter of a document warns and
  points at `cerefox_list_versions`. A section runs to the next same-or-higher
  heading *or to the end of the document*, so the last section owns anything
  appended after it — correct addressing, but silent until now.

- **`document_size_warning_chars`** (default 0, off) — flags writes that push a
  document past a configured size. Partial edits make writes cheap, so an agent
  that only inserts never assembles the document and never sees it grow.

### Fixed
- **`cerefox_ingest` now returns `content_hash` when it creates a document**
  (#189). It previously returned one only on updates, so the author of a new
  document had two options for its first edit: re-read a document it had just
  written, or pass `last_write_wins`. Agents took the second, bypassing
  concurrency control on the first edit of **every** new document. A document is
  now born holding its own token.

- **A refused edit told the agent nothing.** Tool failures were returned as
  JSON-RPC protocol errors, which at least one major client renders as a generic
  dialog with the body discarded — so every carefully written refusal reached the
  agent unreadable. MCP puts execution failures in the result with
  `isError: true` precisely so the model can act on them; both transports now do
  that. The candidate headings, the two `section_part` options, the conflict's
  current hash and recovery steps now arrive where they are useful.

- **`cerefox backup create` and `bun scripts/backup_create.ts` were two
  implementations, and only one was ever fixed** (#166). The scripts kept their
  own logic and never received the fixes that taught backups to capture project
  memberships (v1.0.7), then relations and `lifecycle_status` (v1.1.0) — so they
  sat on backup format 1. `ops-scripts.md` documents those scripts as the
  *pre-migration safety step*, so the snapshot taken to make a migration
  reversible was the incomplete one. Both now delegate to the CLI;
  `_shared/backup` is deleted.

- **`cerefox server deploy` could not deploy `cerefox-mcp` from the published
  package.** The server-asset bundler copies an allow-list of `_shared` subtrees,
  and the new module was not on it, so eight of nine functions deployed and the
  ninth could not bundle. A test now walks the Edge Function import graph and
  fails if the list is missing anything.

- **The false `reindex` claim from #164 survived in a third file.** The guide a
  user reads *while upgrading to 1.0* still told them to run
  `cerefox server reindex` to convert chunk formats. It cannot — it re-embeds
  chunks in place and never re-chunks — while reporting success either way. Use
  `cerefox server migrate-format`.

### Changed
- **Schema 0.10.5 → 0.11.0**, migrations 0019 and 0020. The audit log records
  `insert` / `replace-section` / `delete-section` distinctly, so the trail
  separates *added to* from *rewrote* from *removed*; a batch writes one entry
  per operation, stamped with `clock_timestamp()` so their order survives.
  `cerefox_ingest_document` gained `p_operations`, and returns `content_hash` and
  `size_warning`.

- **The MCP tool surface is 12 core tools** (from 10). The four document-relation
  tools added in v1.1.0 remain dormant, hidden until
  `cerefox config set relations_enabled true`. Documented counts are now asserted
  against the code, after 8, 10, 12 and 16 were all in circulation at once.

- **CLI partial edits are recorded as user writes, MCP as agent writes.** The
  author type is derived from the access path rather than taken on trust, so an
  agent cannot claim to be a user by passing a string.

## [v1.3.0-beta.4] -- 2026-08-10

### Fixed
- **A refused edit told the agent nothing.** Tool failures were returned as
  JSON-RPC protocol errors (`-32603`). The message survived on the wire, but a
  client may render a protocol error however it likes, and Claude Desktop
  replaces it with a generic "Tool execution failed" dialog and drops the body —
  so every carefully written refusal reached the agent as an unreadable failure.
  The candidate headings for a mistyped anchor, the two `section_part` options,
  the conflict's current hash and recovery steps: none of it arrived, and the
  agent could not self-correct without another round trip.

  MCP reserves protocol errors for protocol-level problems (unknown tool,
  malformed request) and puts execution failures in the result with
  `isError: true`, precisely so the model can read and act on them. Both
  transports now do that. Reported by an agent editing real documents on the
  beta: the refusal logic was already correct — no bad writes, all-or-nothing
  intact — but as they put it, a refusal an agent cannot read is half a refusal.

---

## [v1.3.0-beta.3] -- 2026-08-10

### Fixed
- **`end_of_section` chose silently when a section had child headings.** The
  rule was that a section holding *both* its own body and children is ambiguous,
  so the write refuses and returns both `section_part` options. A section with
  children and *no* body of its own was exempted, on the reasoning that both
  readings coincide there. They do not: `own_body` lands before the first child,
  `subtree` after the last one, and those can be pages apart. An agent editing a
  real document during the beta had an insert land past three sub-sections and
  only found out by re-reading — the cost the feature exists to remove. The
  presence of children now makes a section ambiguous on its own, for every
  operation.

### Added
- **Partial edits report a large shrink.** The response now reads
  `Size: 81 chars (was 136)`, and a write that removes more than a quarter of a
  document adds a warning naming the likely cause and pointing at
  `cerefox_list_versions`. Found while exercising the beta against a real store:
  a section runs to the next heading of the same or higher level **or to the end
  of the document**, so the last section owns anything appended after it — an
  `end_of_document` insert becomes part of that section's body, and a later
  `replace_section` on that heading removes it. That is correct addressing, not
  a defect, but it was invisible: the operation reported success and the
  appended entry was simply gone. The full document is deliberately not returned
  (it would spend the tokens the feature saves), so the size delta is the
  cheapest honest signal. Documented in `AGENT_GUIDE.md` and the quick reference,
  with the mitigation: give append-heavy material its own heading.

---

## [v1.3.0-beta.2] -- 2026-08-10

### Fixed
- **`cerefox server deploy` could not deploy `cerefox-mcp` from the published
  1.3.0-beta.1 package.** `scripts/bundle_server_assets.ts` copies an allow-list
  of `_shared/` subtrees into the npm package, and the new `partial-edits`
  module was not on it — so the package shipped without the file
  `mcp-tools/get-document.ts` imports, and the one Edge Function that pulls it
  in failed to bundle:

  ```
  Module not found "file:///…/source/_shared/partial-edits/index.ts"
  ✗ 1 Edge Function(s) failed: cerefox-mcp
  ```

  Nothing caught it before publish because unit tests, typecheck, the local MCP
  server and the CLI all resolve against the repo, where the file exists; only a
  deploy *from an installed package* sees the gap. A deploy that hits this is
  recoverable rather than destructive — the previously deployed function keeps
  serving, so the other eight functions upgrade and the ninth stays behind.

  The list now includes `partial-edits`, and a new test walks the Edge Function
  import graph and fails if any reachable `_shared/` subtree is missing from it,
  so the next shared module cannot be forgotten the same way.

---

## [v1.3.0-beta.1] -- 2026-08-10

### Added
- **Partial document edits — agents can change part of a document without
  resending it** (#186). Two new MCP tools plus a CLI surface:
  - **`cerefox_insert`** — add text at `end_of_document`, `end_of_section`,
    `after_heading` or `before_heading`. Purely additive: it is structurally
    incapable of removing content, which makes the "I meant to append" mistake
    unable to destroy anything. Annotated **non-destructive**, so a client can
    grant it without prompting.
  - **`cerefox_edit`** — one to many operations (`insert`, `replace_section`,
    `delete_section`) applied **atomically** in a single write. Changes that
    belong together go in one call, so a table row and the total it feeds cannot
    end up disagreeing. Annotated destructive.
  - **`cerefox_get_document` outline mode** (`outline: true`) — heading paths,
    per-section sizes and the `content_hash`, without the body. The paths come
    back in exactly the form `anchor_heading` accepts, so discovery and editing
    share one addressing language.
  - **CLI**: `cerefox document insert`, `cerefox document edit-parts`,
    `cerefox document get --outline`. Same shared handlers as the MCP tools, so
    the two cannot diverge.

  Anchors are an exact heading line or a ` > ` parent path. **Nothing is ever
  guessed**: an absent anchor errors rather than falling back to appending, a
  repeated heading errors with the paths that disambiguate it, and a section
  holding both its own content and sub-sections errors with both `section_part`
  options. Every edit requires `expected_content_hash` and there is **no
  last-write-wins** — on these tools a conflict is information you need, not an
  obstacle to route around.

  The MCP tool surface goes from 10 to 12 core tools. The 4 document-relation
  tools added in v1.1.0 remain dormant, hidden until `cerefox config set
  relations_enabled true`.
  The contract was shaped by four real agent sessions before any code was
  written, and their usage reversed the design twice. Spec:
  [`docs/specs/partial-document-edits-design.md`](docs/specs/partial-document-edits-design.md).

### Fixed
- **`cerefox_ingest` now returns `content_hash` when it creates a document**
  (#189). It previously returned one only on updates, so the author of a new
  document had two options for its first edit: re-read a document it had just
  written and already knew, or pass `last_write_wins`. Agents took the second,
  which bypassed concurrency control on the first edit of **every** new
  document. A document is now born holding its own token.

- **`cerefox backup create` and `bun scripts/backup_create.ts` were two
  implementations, and only one got fixed** (#166). The script pair carried its
  own capture and restore logic, so the fixes that taught backups to record
  project memberships (v1.0.7) and then relations and `lifecycle_status`
  (v1.1.0) never reached them: they stayed on backup format 1, silently. That
  mattered most where the scripts are pointed — `docs/guides/ops-scripts.md`
  documents `bun scripts/backup_create.ts && bun scripts/db_migrate.ts` as the
  pre-migration safety step, so the snapshot taken to make a migration
  reversible was the incomplete one. Both scripts now delegate to the CLI, and
  `_shared/backup` is deleted: one capture path, one restore path, one format.
  Their flags are unchanged.

### Changed
- **Schema 0.10.5 → 0.11.0**, migrations 0019 and 0020. The audit log records
  `insert` / `replace-section` / `delete-section` as distinct operations, so the
  trail separates *added to* from *rewrote* from *removed*; a batch writes one
  entry per operation. Audit entries are stamped with `clock_timestamp()` rather
  than the transaction's `NOW()`, so the order of operations inside one write is
  recoverable. New optional `document_size_warning_chars` config: when set,
  writes report when a document passes that size — a signal, never a refusal,
  because an agent that only ever inserts never assembles the document and so
  never sees it grow. **Requires `cerefox server deploy`**; `minSchema` is
  unchanged, so an un-redeployed server keeps working and simply lacks the new
  tools.

---

## [v1.2.1] -- 2026-08-09

### Fixed
- **A content update without an explicit source silently overwrote the
  document's provenance** (#191). `cerefox_ingest_document`'s UPDATE branch
  assigned `source = p_source` unconditionally while the columns either side of
  it coalesced (`source_path` and, since v0.11.1, `metadata`). With
  `p_source TEXT DEFAULT 'agent'` in the signature, PostgreSQL substituted that
  default on every omitted argument, so any partial update quietly relabelled the
  document. `cerefox server migrate-format` hit this at corpus scale: it
  hardcoded `source: "migrate-format"` for every document it converted, though it
  reads each one first and `cerefox_get_document` returns `doc_source`. One
  reported store had 1,317 documents relabelled in a single run, 201 of which
  carried no `metadata.source_agent` and so had no other provenance field left.
  Nothing surfaced it: the audit entry reads `update-content`, and version rows
  carry their own label rather than the document's prior value.

  `p_source` now defaults to NULL and the update coalesces, matching `metadata`
  exactly; the create path keeps `'agent'` via `COALESCE(p_source, 'agent')`.
  `migrate-format` passes the document's own source and labels the version it
  archives `"migrate-format"`, so a conversion is still identifiable in history
  without rewriting where the document came from. Schema `0.10.5` → `0.10.6`;
  run `cerefox server deploy`. An explicit `p_source` still relabels, so
  deliberate callers are unaffected.

  Reported by @tdebasis.

---

## [v1.2.0] -- 2026-08-08

### Added
- **MCP tools now declare annotations** (spec 2025-03-26): `readOnlyHint`,
  `destructiveHint`, `idempotentHint`, `openWorldHint` and a display title, on
  all 14 tools, over both the local stdio server and the remote Edge Function.
  Declaring nothing was not neutral: the spec defaults are *not read-only,
  possibly destructive*, so clients were told `cerefox_search` was as dangerous
  as a destructive write. The usual response is to blanket-approve the server,
  which drains the meaning from the prompt on the tools that warrant one. Ten
  read-only tools are now marked as such; three are marked destructive:
  `cerefox_set_document_projects`, `cerefox_delete_relation`, and
  `cerefox_ingest` — the last because `project_names` **replaces** project
  memberships, and unlike document content, memberships have no version history.

### Fixed
- **`version_cleanup_enabled = false` was silently ignored, and version history
  was pruned against it** (#183). v1.1.0 moved retention into `cerefox_config`
  and made `cerefox_snapshot_version` default its parameters to NULL so
  `COALESCE(param, config, built-in)` could reach the store's policy — but
  `cerefox_ingest_document`, its only caller, kept the pre-1.1.0 concrete
  defaults (`48` / `TRUE`) and passed them straight down. PostgreSQL substitutes
  a declared default on every omitted argument, so the COALESCE short-circuited
  immediately and the store's setting was never read on the one path that
  writes. `version_retention_hours` was equally inert: the window stayed at 48
  hours whatever you configured. Both parameters now default to NULL; an
  explicit value still overrides for a single call.

  This also defeated migration 0016's fail-safe, which seeds
  `version_cleanup_enabled = false` on existing stores during the 1.1.0 upgrade
  precisely so that history could not be discarded — and it makes the v1.1.0
  note "Nothing is deleted" untrue.

  **`cerefox server deploy` is required and now enforced.** The defect is
  entirely in `rpcs.sql`, so upgrading the client alone leaves it live and
  nothing in the client can compensate. The minimum supported schema therefore
  moves to **0.10.5**: until you redeploy, `cerefox web` refuses to start and
  `doctor` errors (the CLI and MCP servers keep working). That minimum was
  already set at 0.10.3 to guarantee a configured retention policy is honoured —
  this is the version where that guarantee actually holds. Cerefox Local ships
  the schema in the image; `cerefox-local upgrade` is enough.

  Pruning is lazy — it runs for a document only when *that* document is next
  written — so versions outside the window survive until their document is
  edited. If you were relying on `cleanup_enabled = false`, versions still
  present are still present; redeploy before your next edit.

---

## [v1.1.1] -- 2026-08-07

### Fixed
- `cerefox web start` now prints the reason when the daemon refuses to boot
  (e.g. a schema below the client's minimum) instead of "not responding yet …
  check the log". The log already said it precisely; you had to go find it.
- The Settings page distinguishes a retired `.env` line that **matches** the
  stored value (inert, safe to delete) from one that **differs** (your tuning is
  silently not in effect). It previously said "delete that line" in both cases.
  `doctor` already made this distinction; the web UI did not.

---

## [v1.1.0] -- 2026-08-07

First minor since 1.0.0. Consolidated from `1.1.0-beta.1` … `beta.8`; the
per-beta sections below remain as granular history.

> ### Upgrading — read this first
>
> **1. `cerefox server deploy` is required, not optional.** Schema 0.9.2 →
> 0.10.4, and the minimum supported schema rises to 0.10.3, which means
> **`cerefox web` will not start until you redeploy** — the CLI and MCP servers
> keep working. See [`upgrading.md`](docs/guides/upgrading.md) for exactly what
> is gated. The most important fix in this release lives in `rpcs.sql`, so
> upgrading the client alone leaves your database on the old, defective
> behaviour. `cerefox doctor` and the web UI both say so until you redeploy.
> Cerefox Local users need no separate step — the schema ships in the image.
>
> **2. Retrieval and retention settings moved into the database.** These five
> environment variables are no longer read:
> `CEREFOX_MIN_SEARCH_SCORE`, `CEREFOX_MIN_TERM_COVERAGE`,
> `CEREFOX_SEARCH_ALPHA`, `CEREFOX_VERSION_RETENTION_HOURS`,
> `CEREFOX_VERSION_CLEANUP_ENABLED`.
> If you tuned any of them, **carry the value over** or your store silently
> reverts to defaults — a lower search-score floor means noisier results.
> `cerefox doctor` lists exactly what to run and drops the warning once done.
>
> **3. Version pruning is switched off on existing stores as a precaution**, so
> the change above cannot quietly discard version history. Nothing is deleted.
> Set your policy when convenient: `cerefox config set version_cleanup_enabled true`.
> The default retention window is now **120 hours** (was 48) — 48 did not survive
> a weekend, and a Friday mistake found on Monday is exactly when you need it.
>
> **4. If you ran `cerefox server migrate-format` on v1.0.7–v1.1.0-beta.3**, it
> reported success while converting nothing. Your documents are untouched and no
> embedding spend was incurred; re-run it on this version.

### Added
- **Document relations — a typed graph over your knowledge base.** Directed,
  typed edges between documents (`source --rel_type--> target`), a symmetric-type
  dictionary, `lifecycle_status`, four RPCs, four MCP tools, and a
  `cerefox relation` CLI group. **Ships dormant**: the tools are hidden from every
  agent until `cerefox config set relations_enabled true`. Enabling and disabling
  are both non-destructive — the flag controls visibility, never data.
- **Settings page in the web UI** — the browser face of `cerefox config`. Every
  runtime key with its description, current value and default, grouped Retrieval
  / Retention / Governance / Features. Settings that change what *other software*
  sees require an explicit confirmation naming the consequence.
- **Deployment-wide search settings** (#133) — `min_search_score`,
  `min_term_coverage` and `search_alpha` in `cerefox_config`, so one value governs
  the CLI, the web UI, local and remote MCP, and the Edge Functions alike.
- **`cerefox server migrate-format`** — converts legacy-format documents to the
  current chunk format by re-ingesting them (re-chunk, re-embed). Opt-in, with
  `--dry-run`, `--limit` and `--document-id`; resumable, and it skips any document
  edited mid-run rather than overwriting it.
- **Backups capture projects, memberships, relations and trashed documents**
  (format 4). Trash is restored **as trash** — `deleted_at` is replayed, so
  nothing deleted returns visible. `--no-trash` opts out.
- **`CEREFOX_ENV_LABEL`** — names a non-production environment. Inert when unset.
  When set, the label appears on `doctor`'s title line, as a banner on every web
  UI page, in the backup filename, and in a warning when a snapshot's environment
  differs from the target's.
- **`cerefox doctor --strict`** exits non-zero when any check warns, for CI.
- **Bulk-rewrite scale warning** on `server migrate-format` and `server reindex`,
  explaining the disk-IO cost before a large job and suggesting batching.

### Changed
- **Retrieval and retention settings are properties of the store, not of each
  client.** Previously every client sent its own values from its own environment,
  so behaviour depended on *which client wrote last* — an agent running defaults
  could prune version history an operator had deliberately kept, and search could
  rank differently depending on who asked. They now live in `cerefox_config`.
  Per-call arguments (`--min-score`, `--alpha`, the MCP equivalents) still win.
  Cerefox Local seeds its higher nomic floor into its own config at container
  init. See **Upgrading** above.
- **Dependency majors taken** (#124): Mantine 8 → 9, `@huggingface/transformers`
  3 → 4, `commander` 12 → 14, and others. Commander 15 deliberately skipped — it
  requires Node ≥ 22.12 (#154).

### Fixed
- **A permanent conflict was raised under a "retryable" SQLSTATE, causing
  unbounded retry storms** (reported by [@tdebasis](https://github.com/tdebasis)).
  `cerefox_ingest_document` raised `CEREFOX_CONFLICT` as `40001`
  (`serialization_failure`) — the one PostgreSQL class that promises "transient,
  retry me". The conflict is deterministic, so retry-aware infrastructure looped
  without limit. Measured: **one HTTP request executed the RPC 68,825 times in
  125s**, and kept running after the client was gone. A contributor's project ran
  it for ~24 hours and ~47 million calls, exhausting its disk-IO budget.
  Conflicts now raise `PT409` → HTTP 409, which nothing retries; a blank
  `expected_content_hash` is treated as *absent* (400) rather than stale.
  **This is the fix that makes `server deploy` mandatory.**
- **`server migrate-format` reported success while converting nothing** — the
  same #164 defect it was written to fix, shipped in v1.0.7. It re-ingests
  identical content by design, and the pipeline answered an unchanged hash with a
  metadata-only update. It now forces the re-chunk and counts only documents the
  pipeline confirms were re-indexed.
- **Backups**: project memberships were never captured, so every restore landed
  documents with no project assignments (#166); `backup create` aborted against
  pre-0.10.0 servers, breaking snapshots taken *before* an upgrade; `restore` was
  not idempotent, colliding on the primary key for documents edited between
  snapshots; and `CEREFOX_BACKUP_DIR` set in `.env` was ignored entirely.
- **`CEREFOX_CONFIG_DIR` was silently ignored by contributor scripts.** Bun
  auto-loads `.env` from the working directory, so `bun scripts/*.ts` used the
  repo's credentials — `db_deploy.ts --reset` would have wiped the wrong
  database while naming another on the command line. The named config directory
  is now authoritative, and `--reset` prints the project it is about to drop.
- **`.env` is now loaded once at CLI startup.** Settings were loaded lazily, so
  code reading `process.env.CEREFOX_*` directly saw an unpopulated environment —
  the root cause behind two separate ignored-setting bugs.
- **`cerefox web` daemon state follows the active environment**, so a second
  environment's `web stop` can no longer target the first one's server.
- **`cerefox doctor`**: no longer claims "All checks passed" alongside warnings
  (#152); the content-format hint is legible; stale-schema output no longer
  points at Python scripts deleted at v1.0.0; and `server reindex` no longer
  claims to convert chunk formats (#164) — it cannot.
- **UI**: end-to-end tests repaired (#155, 13 → 18 passing); dashboard rows are
  keyboard reachable and open in a new tab (#165).
- **`cerefox-local upgrade` actually upgrades** (#153).

---

## [v1.1.0-beta.8] -- 2026-08-07

### Fixed
- `doctor` no longer repeats the "carry this setting over" command for a retired
  env var whose value is already in the store. Shows ℹ and "safe to delete"
  instead, and lists only the keys still pending.

---

## [v1.1.0-beta.7] -- 2026-08-07

### Documentation
- **Relations are now documented for users.** The headline 1.1.0 feature shipped
  with no user-facing docs: `cli.md` never mentioned the `cerefox relation`
  group, and `AGENT_GUIDE.md` still told agents to use `cerefox_set_relation`
  *"when it ships"* — a stale claim in a guide that ships **inside the npm
  package**, the same class of defect that reached users in v1.0.8. Both fixed,
  plus a `cerefox relation` reference covering the commands, symmetry, cycle-safe
  traversal, and how to enable/disable the feature non-destructively.
- **`AGENT_QUICK_REFERENCE.md` no longer implies the relation tools are always
  present.** They are opt-in and hidden by default, so an agent reading the
  reference would try to call tools that were not in its list. The four tools are
  marked ⚑ with a legend telling agents to trust their own tool list and treat
  absence as normal. Re-bundled into `cerefox_get_help`.
- **`upgrading.md` flags v1.1.0's server deploy as non-deferrable**, because the
  retry-storm fix lives in `rpcs.sql` and upgrading the client alone leaves the
  database on the old behaviour.

- **Version retention is now a property of the store, not of each client.**
  `cerefox_snapshot_version` took the retention window and cleanup flag as
  parameters, and every client filled them from its own environment — so the
  surviving version history depended on **which client wrote last**. An operator
  could set "keep everything" on their machine and still lose versions the
  moment an agent running defaults saved a document. Retention describes the
  data, so it now lives with the data: `version_retention_hours` and
  `version_cleanup_enabled` in `cerefox_config`, editable from the CLI
  (`cerefox config set`) or the **Settings** page.

  `CEREFOX_VERSION_RETENTION_HOURS` and `CEREFOX_VERSION_CLEANUP_ENABLED` are
  **retired and no longer read**. `cerefox doctor` reports them if still set,
  and prints a copy-pasteable command carrying your existing value across, so
  keeping your current policy is one paste and a `.env` line deletion.

  Unchanged, and worth restating: cleanup never deletes the most recent version,
  nor any version marked `archived`. Setting `version_cleanup_enabled=false`
  keeps every version forever — useful for audit-trail stores, at the cost of
  unbounded growth, since versions carry embeddings.

  **Upgrades disable pruning as a precaution.** Because the env vars stop being
  read the moment the client updates — before anyone reads a release note — an
  operator running "keep everything" would otherwise fall back to the 48-hour
  default and lose that history on their next save. Migration 0016 therefore
  seeds `version_cleanup_enabled=false` on **existing** stores: nothing is
  deleted, and cleanup does not run until you state a policy. Fresh installs are
  unaffected and keep the ordinary bounded default (48h, cleanup on) — they have
  no history to lose. If you have already chosen a policy, the seed never
  overwrites it.

  **Requires a server redeploy** — schema 0.10.2 → 0.10.3, migration 0016. The
  1.1.0 upgrade already mandates one for the retry-storm fix, so this adds no
  extra step.
- **Retrieval tuning moved into the store as well; the `.env` overrides are
  retired.** `CEREFOX_MIN_SEARCH_SCORE`, `CEREFOX_MIN_TERM_COVERAGE` and
  `CEREFOX_SEARCH_ALPHA` are no longer read. They describe the *store*, not the
  machine asking: the right similarity floor depends on which embedder produced
  the vectors, and every client querying one database must use the same embedder
  (`doctor` enforces exactly that). So there was never a case where two clients
  should legitimately disagree — only a way for search to rank differently
  depending on who asked. One `cerefox config set` (or the Settings page) now
  governs the CLI, the web UI, local and remote MCP, and the Edge Functions
  alike. The same applies to the Edge Functions' `Deno.env` secrets, which could
  previously override the store from the other side.

  Per-call overrides are unchanged and still win: `cerefox search --min-score`,
  the MCP `min_score` / `alpha` parameters.

  **Cerefox Local** keeps its higher floor for the nomic embedder by seeding
  `min_search_score = 0.6` into its own `cerefox_config` at container init,
  rather than carrying it in the environment.

  Stale `.env` lines are surfaced in two places rather than silently ignored:
  `cerefox doctor` lists them with a copy-pasteable command carrying your value
  into the store, and the **Settings** page flags the affected key directly.

---

## [v1.1.0-beta.6] -- 2026-08-06

### Fixed
- **A deterministic conflict was raised under a "retryable" SQLSTATE, causing
  unbounded retry storms** (reported by
  [@tdebasis](https://github.com/tdebasis)). `cerefox_ingest_document` raised
  `CEREFOX_CONFLICT` with SQLSTATE `40001` (`serialization_failure`) — the one
  PostgreSQL class whose contract promises *"this was transient, retry and it
  may succeed"*. PostgREST maps it to a retryable HTTP status, so retry-aware
  infrastructure replayed the request. But an optimistic-concurrency conflict is
  **deterministic**: the same stale token fails identically forever, so "retry
  until it clears" meant retry until something died.

  Reproduced and measured on a live project:

  | | Before (`40001`) | After (`PT409`) |
  |---|---|---|
  | HTTP response | 504 after 125s | **409 after 636ms** |
  | RPC executions per request | **68,825** | **1** |
  | After the client gave up | kept running past 153,000 executions | stopped |

  The contributor's project ran the loop for roughly a day — **~47 million
  calls** — which exhausted its Disk IO budget and needed a hung connection
  killed by hand. Conflicts now raise `PT409` (PostgREST's convention → HTTP 409
  Conflict), which nothing retries.

  Also: a **blank** `expected_content_hash` (empty or whitespace) is now treated
  as *absent* rather than stale, raising `CEREFOX_TOKEN_REQUIRED` (400). `''` is
  not NULL, so it slipped past the absent-token branch into the conflict branch,
  where it could never match a real hash — a permanent failure wearing a
  retryable code, which is the exact shape that triggered the incident.

  **Requires a server redeploy** (`cerefox server deploy`) — schema 0.10.1 →
  0.10.2, migration 0015. Client detection is unchanged: every transport matches
  the `CEREFOX_CONFLICT:` message prefix, never the SQLSTATE.

### Changed
- **Bulk-rewrite warning thresholds raised** — `migrate-format` 200 → 1,000
  documents, `reindex` 1,000 → 5,000 chunks. The thresholds were originally set
  low because a contributor's Disk IO depletion appeared to follow a large
  reindex; it is now traced to the retry storm above and had nothing to do with
  bulk rewrites. The warning is kept — rewriting thousands of rows on a small
  instance is genuinely heavy — but calibrated for "objectively a large job"
  rather than for a scale that was wrongly blamed.

---

## [v1.1.0-beta.5] -- 2026-08-06

### Added
- **Settings page in the web UI** — the browser face of `cerefox config
  get/set`. Every `cerefox_config` key with its description, current value and
  default, grouped into Retrieval / Governance / Features. Keys that change what
  *other software* sees require an explicit confirmation naming the consequence
  rather than a bare toggle: turning on `relations_enabled` adds four tools to
  every connected agent's list, and `require_requestor_identity` starts
  rejecting agents that don't identify themselves. Verified end to end —
  flipping the switch in the browser moved the advertised MCP tool list from 10
  to 14 and back.

  A `CEREFOX_*` variable set on the server is shown **read-only** as an
  override, because it beats the stored value on that machine; without this the
  page would report success while the server kept using a different number. It
  is deliberately **not** an `.env` editor — that file holds the service-role
  key, OpenAI key and database password, and the server only reads it at boot.

  The key catalog now lives in `_shared/config-catalog/`, so `cerefox config
  list` and the page cannot disagree about what a key means or defaults to.
  Value validation lives there too: the RPC allow-lists the *key* but stores the
  value as opaque text, so `min_search_score = 5` was previously accepted and
  silently suppressed every search result. Bad values now get a 400.

### Changed
- **`migrate-format`'s bulk-write warning now triggers at 200 documents**
  (was 500). Converting ~200 documents already means on the order of a thousand
  chunk inserts plus version rows — comparable write volume to the reindex that
  depleted a contributor's Disk IO Budget. The command is rare and opt-in, so
  erring quiet helped nobody.

---

## [v1.1.0-beta.4] -- 2026-08-06

### Added
- **Bulk-rewrite scale warning on `server migrate-format` and `server
  reindex`.** Reported by [@tdebasis](https://github.com/tdebasis) after
  reindexing a ~1,300-document store: the Supabase project depleted its **Disk
  IO Budget**, and Supabase warned that response times would degrade, CPU would
  rise on IO wait, and the instance could become briefly unresponsive. Nothing
  was corrupted, but a maintenance command that can do that should say so
  first. Both commands now warn above a scale threshold (500 documents / 1,000
  chunks), explain the symptom, and suggest batching during a quiet period.
  Advisory only — it never blocks.

### Fixed
- **`cerefox server migrate-format` did not actually convert anything** — it
  reported `Converted N` while every document stayed on the legacy format.
  The command re-ingests byte-identical content on purpose (the goal is to
  rewrite chunk rows under the current chunker), but the pipeline answers an
  unchanged content hash with a metadata-only update: no re-chunk, so no format
  advance. It then counted every non-throwing call as a conversion. This is the
  **exact #164 defect the command was written to fix**, reproduced one layer up:
  `reindex` claimed to convert and didn't, and so did its replacement. Shipped
  broken in v1.0.7. Fixed with a `forceRechunk` path that bypasses the
  short-circuit, and the command now counts only results the pipeline reports as
  re-indexed — so a silent no-op fails loudly instead of being reported as
  success. Verified by measurement on staging: converting 2 documents moved the
  format-1 count 214 → 212 and format-2 117 → 119 (before the fix, converting 3
  moved nothing).
- **`migrate-format` counted trashed documents**, so it reported 214 where
  `doctor` reported 207 — two numbers for the same question — and would have
  spent embedding budget re-chunking deleted content. Soft-deleted documents
  are now excluded and reported separately.
- **The environment label moved to `doctor`'s title line.** It was a suffix on
  the config row — the fifth line of output, easy to scan past. `doctor` is the
  command you run to answer "what am I pointed at?", so the answer now leads:
  `Cerefox doctor [STAGING]`. Stated once rather than twice.

---

## [v1.1.0-beta.3] -- 2026-08-06

### Added
- **`CEREFOX_ENV_LABEL` — name a non-production environment.** Inert when
  unset (every normal install). When set, the environment identifies itself
  wherever it could otherwise be confused for production: a banner on every
  web UI page, `[LABEL]` on `doctor`'s config line, the label in the backup
  filename (`cerefox-staging-<stamp>.json`) and payload, and a warning from
  `backup restore` when a snapshot's environment differs from the target's.
  That last pair matters because `CEREFOX_BACKUP_DIR` does not follow
  `CEREFOX_CONFIG_DIR`, so snapshots from two environments can share a
  directory and a "most recent file" restore could seed production from
  staging.

### Fixed
- **`.env` is now loaded once at CLI startup.** Nothing did this: settings were
  loaded lazily, deep inside whichever helper first needed Supabase
  credentials, so any code reading `process.env.CEREFOX_*` directly saw an
  unpopulated environment and silently used its default. That produced two
  independent bugs — `CEREFOX_BACKUP_DIR` ignored outright, and
  `CEREFOX_ENV_LABEL` never reaching `doctor` — and would have produced one for
  every future setting read that way.
- **`CEREFOX_BACKUP_DIR` set in `.env` was silently ignored.** `backup create`
  read the variable *before* anything loaded the config file — nothing loads
  `.env` at CLI startup; `loadSettings()` runs later, inside `getClient()` — so
  snapshots always went to the built-in `~/.cerefox/backups` no matter what was
  configured. The setting appeared to work only when the variable was exported
  in the shell or when Bun's auto-dotenv injected a working-directory `.env`,
  which is how one machine's snapshots ended up split across two directories.
  This also broke the staging guide's snapshot isolation: a staging `.env`
  pointing at its own backup directory had no effect, so staging snapshots
  landed beside production's.

---

## [v1.1.0-beta.2] -- 2026-08-06

### Fixed
- **`backup create` no longer fails against a pre-0.10.0 server.** The document
  select named `lifecycle_status` unconditionally, so a v1.1.0 CLI pointed at a
  v1.0.x database aborted with *"column cerefox_documents.lifecycle_status does
  not exist"* — breaking backups at the one moment they matter most, taking a
  snapshot of production **before** upgrading it. The column is now probed and
  dropped from the select if the server predates it, recorded in the payload as
  `includes_lifecycle_status: false`.
- **Schema-status output no longer points at deleted Python scripts.**
  `db_status` told users to "run db_deploy.py" on a version mismatch; the Python
  implementation was removed at v1.0.0. All three messages now say
  `cerefox server deploy`.
- **`CEREFOX_CONFIG_DIR` now outranks an ambient `.env`.** Bun auto-loads `.env`
  from the working directory, so every `bun scripts/*.ts` run inside a repo
  clone arrived with that file's credentials already in `process.env` — and
  `loadEnv()` only filled *unset* keys, so the named config directory was
  silently ignored. `CEREFOX_CONFIG_DIR=…/staging bun scripts/db_migrate.ts
  --status` reported **production**, and the same resolution path through
  `db_deploy.ts --reset` would have wiped production while naming staging on
  the command line. When the config dir is explicitly named, its `.env` is now
  the authority. Unchanged when the override is unset, which is every
  single-environment install.
- **`db_deploy.ts --reset` now names the database it is about to drop.** The
  confirmation prompt asked for a typed `yes` without ever saying *which*
  project would be wiped. It now prints the target project ref, host, and the
  config file the connection came from.
- **`cerefox web` daemon state is now per-environment.** The pidfile and log
  were written to `~/.cerefox/web.{pid,log}` regardless of
  `CEREFOX_CONFIG_DIR`, so starting a web server in a second environment
  overwrote the first one's bookkeeping — and a later `web stop` then targeted
  the wrong process, killing the other environment's server. State now follows
  an explicitly-set `CEREFOX_CONFIG_DIR`. **No change for normal installs**:
  without the override the location is exactly as before, and the resolver is
  deliberately keyed on the env var rather than the config-dir resolver so repo
  dev-mode never drops `web.pid` into a working tree.
- **Backups now capture project memberships** (#166). `backup create` never
  read the document↔project junction, so every restore silently landed
  documents with **no project assignments** — and the restore command's help
  text claimed the opposite. Snapshots now include projects and memberships
  (backup format 2) and restore recreates them idempotently. Older snapshots
  still restore, with a warning that memberships are absent. Verified with a
  full round trip: seed → back up → wipe → restore, memberships intact.
- **`cerefox server reindex` no longer claimed to convert legacy chunk
  formats** (#164, reported by [@tdebasis](https://github.com/tdebasis)).
  Reindex refreshes embeddings on existing chunk rows; it never re-chunks, so
  it cannot advance `content_format` — verified on a 3,203-chunk store where
  it touched every chunk and moved exactly zero. `cerefox doctor` and
  `content-format.md` both told users to run it anyway.

### Added
- **Backups now capture trashed documents** (backup format 4). Soft-delete is
  not a purge — `cerefox_delete_document` only stamps `deleted_at`, and nothing
  ever collects it (the 48h retention sweep prunes document *versions*, never
  the trash). Snapshots silently omitted that durable state, so a restore
  permanently lost everything in the trash. Trashed documents are now captured
  and **restored as trash**: `deleted_at` is replayed verbatim, and since every
  read and search RPC filters on it, nothing deleted comes back visible —
  `cerefox document restore` still recovers it. Counted on its own line by both
  commands; `--no-trash` opts out.
- **`cerefox server migrate-format`** — the command that actually does the
  conversion #164 promised: re-ingests legacy documents through the normal
  pipeline so they are re-chunked, re-embedded, and stamped with the current
  format. Opt-in (it costs embedding spend), with `--dry-run`, `--limit`, and
  `--document-id`. Each document converts under optimistic concurrency, so an
  edit made mid-run is skipped rather than overwritten, and documents whose
  content is byte-identical to another document are reported as
  un-convertible rather than failing the run.

---

## [v1.1.0-beta.1] -- 2026-08-05

### Added
- **Document relations: a typed graph over your knowledge base** (iteration 29;
  schema 0.9.3 → 0.10.0 — redeploy with `cerefox server deploy`). Link documents
  with directed, typed edges — `supersedes`, `contradicts`, `references`,
  `related_to`, `follows`, or any type string you invent — and Cerefox tracks
  what that means. `supersedes` marks the older document **superseded**;
  `contradicts` marks **both** stale; symmetric types write both directions in
  one transaction. Every document now carries a `lifecycle_status`, so an agent
  retrieving a document can tell whether the knowledge still stands instead of
  presenting outdated notes as current. Four new MCP tools
  (`cerefox_set_relation`, `cerefox_delete_relation`, `cerefox_get_relations`,
  `cerefox_get_neighbors` — 14 tools total) and a matching CLI group
  (`cerefox relation set|delete|list|neighbors`). `cerefox_get_neighbors` walks
  one relation type outward, following chains and terminating safely on cycles.
  Search ranking is deliberately untouched in this release; relation-aware
  retrieval is the next slice.

  **The feature ships dormant.** The relation tools are hidden from agents
  until a deployment opts in with `cerefox config set relations_enabled true`
  — a tool an agent can see is a tool an agent may use, and this design is
  meant to evolve through experimentation before it becomes part of the
  default surface. With the flag off, Cerefox behaves exactly as it did in
  1.0.6: an empty table, a defaulted column, and 10 visible tools.
- **Deployment-wide search settings** (#133; schema 0.9.2 → 0.9.3 — redeploy
  with `cerefox server deploy`). `min_search_score`, `min_term_coverage`, and
  `search_alpha` can now be set once with `cerefox config set` and every access
  path obeys — CLI, local and remote MCP, Edge Functions, and the web UI —
  because they all resolve through the same search RPCs. Previously these were
  client-side only, so a search issued by a cloud agent silently used built-in
  defaults no matter how the deployment was configured. Order of precedence:
  per-call argument, then the client's `CEREFOX_*` env var, then the stored
  setting, then the built-in default; a malformed stored value falls back to
  the built-in rather than breaking search.
- **`cerefox doctor --strict`** exits non-zero when any check warns, for use as
  a gate. The default still exits 0 on warnings, because the client is updated
  before the server and a normal upgrade window would otherwise fail CI.

### Fixed
- **Backups capture the full picture** — projects, memberships (ported from
  v1.0.7, #166) and now **relations + `lifecycle_status`** too, so the graph
  and each document's standing survive a restore. Relations are only restored
  when both endpoint documents landed, and a snapshot from an older Cerefox
  still restores (with a note about what it cannot recreate).
- **`cerefox doctor`'s content-format hint is legible.** It ended with
  "What this means: `cerefox guides show content-format`", which read as
  though the command were the explanation. It now says plainly that the legacy
  format is harmless, how to convert, and what to run to read about it.
- **UI end-to-end tests repaired** (#155). The Playwright suite had drifted to
  8 failures and 2 silent skips out of 13 — every one a stale selector rather
  than a broken app (polished copy, renamed headings, a form moved into a
  modal). It now passes 13/13 in ~32 seconds instead of 3.7 minutes, and page
  identity is asserted through stable test hooks so copy changes cannot break
  it again.
- **Dashboard rows are keyboard reachable** (#165). Recent documents and
  projects navigated via a click handler on the table row, so keyboard and
  screen-reader users could not open them at all, and cmd/middle-click and
  "copy link" did nothing. They are real links now.
- **`cerefox doctor` no longer reports "All checks passed" alongside warnings**
  (#152) — it contradicted the remediation printed directly above it.
- **`cerefox-local upgrade` actually upgrades** (#153). With no argument it
  resolved nothing and re-pulled the pinned image while printing a success
  message; it now finds the newest release, reports the move, and pins it
  (`upgrade <tag>` still pins an exact version, `upgrade --latest` follows the
  moving tag). Container installs also stopped exposing `self-update`, which
  ran npm inside the container and could not work; it now points at the image
  upgrade path. A missing command reports "not found on PATH" instead of
  "exit undefined".

### Changed
- **Dependency majors taken** (#124): Mantine 8 → 9, `@huggingface/transformers`
  3 → 4 (local embedder re-validated end to end), `diff` 8 → 9, `@eslint/js`
  9 → 10, `commander` 12 → 14. Commander 15 was deliberately skipped: it
  requires Node ≥ 22.12, which is a support-policy decision tracked in #154.

---

## [v1.0.8] -- 2026-08-06

> Back-filled. This release was cut from the `release/1.0.7` maintenance branch
> and shipped **without release notes** — its GitHub Release body reads only
> "Open roadmap.", because the cut script's emptiness check was satisfied by its
> own placeholder. The entry below was reconstructed from the commits in
> `v1.0.7..v1.0.8`; the gate was fixed afterwards so this cannot recur.

### Fixed
- **The false `reindex` claim from #164 survived in a second file.** The 1.0.7
  doc pass corrected `content-format.md` and `doctor`, but `migration-1.0.md`
  still told users to run `cerefox server reindex` to convert legacy chunk
  formats. That one mattered more than a repo typo: guides ship **inside the npm
  package**, so `cerefox guides show migration-1.0` served the wrong instruction
  to anyone upgrading. Now points at `server migrate-format`.
  (Note: `migrate-format` itself did not work until v1.1.0-beta.4 — see that
  entry.)
- **`cut_release.ts` push log named the wrong branch.** Cosmetic, but the line
  is read during a release to confirm what is being pushed.

### Changed
- `docs/guides/cli.md` documents what a backup actually contains (documents,
  chunks, projects, memberships) and the `server migrate-format` command.

---

## [v1.0.7] -- 2026-08-06

> Back-filled from the `release/1.0.7` maintenance branch, where this release
> was cut. The code shipped to `main` via cherry-pick; only these notes were
> missing.

### Fixed
- **Backups now capture project memberships** (#166). `backup create` never
  read the document↔project junction, so every restore silently landed
  documents with **no project assignments** — and the restore command's help
  text claimed the opposite. Snapshots now include projects and memberships
  (backup format 2) and restore recreates them idempotently. Older snapshots
  still restore, with a warning that memberships are absent. Verified with a
  full round trip: seed → back up → wipe → restore, memberships intact.
  **Applies to Cerefox Local too** — this is CLI-side logic, so a self-hosted
  instance on ≤1.0.6 produces snapshots that restore without memberships.
- **`cerefox server reindex` no longer claimed to convert legacy chunk
  formats** (#164, reported by [@tdebasis](https://github.com/tdebasis)).
  Reindex refreshes embeddings on existing chunk rows; it never re-chunks, so
  it cannot advance `content_format` — verified on a 3,203-chunk store where
  it touched every chunk and moved exactly zero. `cerefox doctor` and
  `content-format.md` both told users to run it anyway.

### Added
- **`cerefox server migrate-format`** — the command that actually does the
  conversion #164 promised: re-ingests legacy documents through the normal
  pipeline so they are re-chunked, re-embedded, and stamped with the current
  format. Opt-in (it costs embedding spend), with `--dry-run`, `--limit`, and
  `--document-id`. Each document converts under optimistic concurrency, so an
  edit made mid-run is skipped rather than overwritten, and documents whose
  content is byte-identical to another document are reported as
  un-convertible rather than failing the run.
  **This command did not work as shipped** — it reported success while
  converting nothing. Fixed in v1.1.0-beta.4.

---

## [v1.0.6] -- 2026-08-05

### Fixed
- **Search result counts are consistent between chunk and document views**
  (schema 0.9.1 → 0.9.2 — redeploy with `cerefox server deploy`). When no
  result cleared the confidence threshold, the fallback capped *chunks* before
  they were grouped into documents, so a knowledge base where one document
  owned several of the top chunks returned fewer results than one where they
  were spread out. The cap now counts documents.
- **Search results header no longer conflates two different things.** It read
  "ranked by documents relevance" in document mode, borrowing the result shape
  into a slot that otherwise names a ranking method. It now states both, the
  way the search controls already do: "12 results · documents ranked by hybrid
  relevance".

### Added
- **`CEREFOX_SEARCH_ALPHA`** sets the default hybrid fusion weight (1.0 = pure
  semantic, 0.0 = pure keyword), matching the other retrieval tunables; it was
  previously per-call only.
- **Retrieval tunables now apply to the remote MCP / Edge Function path too**,
  when set as Supabase Function secrets — the shared helpers read `Deno.env`
  in addition to `process.env`. Previously a server-side search silently used
  built-in defaults no matter how the deployment was configured.

### Changed
- **`docs/TODO.md` is retired.** Its unscheduled items moved to GitHub issues
  (#140–#149), where contributors actually look; obsolete entries (a bug fixed
  by atomic ingestion, a script deleted with Python) were dropped. The file
  remains as a pointer.

---

## [v1.0.5] -- 2026-08-05

### Fixed
- **Web UI now shows the low-confidence search warning** (#138). The
  below-confidence banner shipped in v1.0.3 never appeared in the browser: the
  web API projects search rows through an explicit field allowlist that didn't
  include the flag, so it was stripped before reaching the SPA.
- **`cerefox doctor` reports a stale server consistently** (#137). The schema
  and Edge-Function checks disagreed on severity for the same condition, and
  because the EF drift was merely informational it was excluded from the
  consolidated remediation — a server behind on *both* was told to run
  `--schema-only`, silently leaving the Edge Functions stale. Both now warn,
  the wording states what is actually missing, and the next step is spelled
  out ("This release needs a server update: cerefox server deploy").
- **More silent 1000-row truncations removed** (#134, follow-up to #131):
  `cerefox_export.ts` truncated large exports, and the web UI's project-scoped
  document listing prefetched an unbounded id list (which also inflated the
  request URL — the #109 shape); both now scope server-side and paginate.
  Per-document chunk reads in backup, ingestion, and the web document view are
  bounded too, so a document with more than 1000 chunks can't render or back
  up truncated.

### Added
- **Guards against silent row-cap truncation** (#135): `fetchAllPages` now
  verifies its result against the server's own row count when the caller
  requests one, and a repo-wide test fails CI on new unbounded PostgREST
  selects (bound them, count server-side, or allowlist with a reason).

---

## [v1.0.4] -- 2026-08-04

### Fixed
- **Unbounded PostgREST selects no longer silently truncate at the 1000-row
  server cap** (#131). `backup create` backed up a 1000-document prefix of
  larger knowledge bases while reporting success (the reported
  `document_count` came from the same truncated fetch); `server reindex`
  would process the first 1000 chunks and print that count as the whole job;
  the web UI's per-project document counts under-reported once the KB
  crossed 1000 project memberships. Reads that can exceed one page now
  paginate via a shared `fetchAllPages` helper, and per-project totals are
  counted server-side. Known unpaginated siblings (project-scoped web
  listing prefilter, `scripts/cerefox_export.ts`) are documented in #131.

- **Term-coverage gate on the OR-fallback search** (follow-up to v1.0.3's
  recall fix, found dogfooding it): a query of mostly-nonsense terms plus one
  common word could return confident-looking irrelevant results, because the
  OR-fallback inherited the "any FTS match passes unconditionally" rule that
  was only sound under AND semantics (where a match meant *every* term was
  present). OR-fallback matches now earn the confident pass only by matching
  at least half of the query's meaningful terms (`p_min_term_coverage`,
  default 0.5; exposed as `cerefox search --min-term-coverage`); weaker
  matches surface as below-confidence candidates instead. The 3-of-4-terms
  recall win from v1.0.3 is unaffected. Schema 0.9.0 → 0.9.1 — redeploy with
  `cerefox server deploy`.

---

## [v1.0.3] -- 2026-08-04

### Fixed
- **Hybrid/FTS search recall: one absent query term no longer hides matching
  documents.** Feedback from AI agents using Cerefox surfaced that multi-term
  concept queries could return nothing even when a document contained most of
  the query's terms verbatim: full-text matching required *every* term
  (AND semantics), so each added term made recall strictly worse. Search now
  relaxes progressively — the strict AND query stays primary (identical
  behavior whenever it matches), and only when it matches nothing does an
  OR-composition of the same terms take over, letting multi-term evidence
  accumulate. Schema 0.8.2 → 0.9.0; redeploy with `cerefox server deploy`.
- **Search never comes back silently empty.** When nothing clears the
  relevance threshold, Cerefox now returns the closest candidates flagged
  `below_confidence` (with scores) instead of an empty set — an empty result
  reads to agent callers as "this knowledge does not exist", the most
  expensive wrong conclusion a memory layer can produce. All surfaces (MCP,
  CLI, web UI) annotate these results clearly; a truly empty response now
  reliably means nothing even weakly related exists.
- **`cerefox doctor` stays quiet on label-only Edge-Function drift** (#127).
  Stable releases bump the EF version label even when no EF code changed;
  doctor now tracks the last *actual* EF change and shows the redeploy hint
  only when the deployed functions really predate it.

### Changed
- Agent guidance (`cerefox_get_help` / AGENT_QUICK_REFERENCE): prefer a few
  distinctive search terms; a `below confidence` result means weak signal,
  not absent knowledge.
- CI gained a secret-scanning job (gitleaks), closing the last hardening gate
  from the 1.0 security-audit backlog.

---

## [v1.0.2] -- 2026-08-03

### Security
- **Dependency refresh**: `@hono/node-server` ≥ 2.0.12 (fixes a `serve-static`
  path-traversal advisory relevant to `cerefox web` on Windows), `hono` 4.12.34,
  `@modelcontextprotocol/sdk` 1.30.0, `vite` 8.2.0, `react-router` 7.18.2, plus
  transitive refreshes. Three remaining public advisories are accepted as
  unreachable, with reasoning recorded in `docs/specs/security-audit-1.0.md`
  (2026-08-02 addendum).
- **Supply-chain hardening**: `bun.lock` is now committed (CI installs are
  strict `--frozen-lockfile`), CI gained a `bun audit` gate that fails on any
  new advisory, all GitHub Actions are pinned to commit SHAs, and Dependabot
  proposes weekly grouped dependency and Actions updates.

### Changed
- **Documentation sanity pass**: corrected stale claims across the repo docs —
  the Python implementation is described as fully removed at v1.0.0 (not a
  "frozen fallback"), the embedder story reflects OpenAI + the local ONNX
  model (Fireworks is roadmap), SECURITY.md states the 1.x support policy, and
  the release playbook records the stable-cut rules (`--docker-publish`,
  unconditional `EF_VERSION` bump, CHANGELOG consolidation). The pre-v0.9 CLI
  verb husks are now documented as kept indefinitely.

---

## [v1.0.1] -- 2026-08-01

<!-- Consolidated 1.0.1 section (RELEASING.md: "Consolidate the CHANGELOG when
     cutting the stable X.Y.Z"). Cutting v1.0.1 promotes this whole block to
     [1.0.1]. It aggregates everything since v1.0.0, absorbing the
     [v1.0.1-beta.1] pre-release section. -->

### Fixed
- **Explicit Data API grants for `service_role`** (#26; schema 0.8.1 → 0.8.2 —
  redeploy with `cerefox server deploy`). Supabase is removing the implicit
  privileges Data API roles get on `public` tables (already the default for
  projects created after 2026-05-30; enforced on existing projects 2026-10-30);
  without explicit GRANTs, tables become invisible to PostgREST even for
  `service_role`. `anon`/`authenticated` deliberately get nothing.
- **`cerefox document list --project` no longer fails on large projects** (#109,
  #110 — thanks [@tdebasis](https://github.com/tdebasis)!). Project-scoped
  listing used to fetch every document id in the project and replay them in an
  `id=in.(…)` filter, whose URL blew past the Node fetch ~16KB header budget
  once a project crossed roughly 400 active documents
  (`UND_ERR_HEADERS_OVERFLOW`). It is now a single PostgREST embedded-resource
  query, filtered server-side and genuinely bounded by `--limit`.
- **`cerefox self-update` refreshes the bundled docs via the newly installed
  binary** (#106) — the version stamp and sync logic now come from the new
  release, not the still-running old process. Also fixes a stale internal verb
  (the sync ran the pre-v0.9 command name).
- **`cerefox document ingest --document-id` no longer renames the document to
  the local filename** when `--title` is omitted — it keeps the existing title.
- **Missing-author warning on every CLI write verb**: `document edit` and
  `document version archive` now warn (like ingest already did) when a write
  will be attributed to "unknown".

### Added
- **`cerefox server deploy --yes`** — skip the deployment confirmation for
  scripted or agent-driven runs.

### Changed
- **`cerefox doctor`'s Edge-Function check is calmer and clearer**: the
  above-minimum "older than bundled" case is informational (ℹ, not ⚠ — warnings
  are reserved for real compatibility violations) and names both versions
  plainly. Releases also bump the Edge-Function version at every **stable** cut,
  so stable deployments never display a pre-release EF label.
- **`cerefox-local upgrade --latest`** (or `upgrade <tag>`) re-points the
  persisted image pin in one command.
- **Small-VM hint at local-embedder selection**: the installer and
  `cerefox-local init` note when the Docker VM has under 3 GB of memory
  (the local embedder is happiest with ≥ 4 GB).
- **EF deploys on macOS: keychain heads-up + `SUPABASE_ACCESS_TOKEN` documented.**
  The Supabase CLI reads its login token from the macOS Keychain, firing a
  password dialog per function deploy; the deploy pre-flight now warns about
  this up-front, and `configuration.md` documents setting `SUPABASE_ACCESS_TOKEN`
  in `~/.cerefox/.env` to skip the dialogs entirely.

---

## [v1.0.0] -- 2026-07-12

<!-- Consolidated 1.0.0 section (RELEASING.md: "Consolidate the CHANGELOG when cutting
     the stable X.0.0"). Cutting v1.0.0 promotes this whole block to [1.0.0]. It
     aggregates EVERYTHING since v0.11.1 across the beta.1–rc.1 pre-releases, whose
     individual sections remain below as granular history. -->

**Cerefox 1.0.0 — the first stable release.** Everything below shipped across the
`1.0.0-beta.1` … `1.0.0-rc.1` pre-releases and is consolidated here. Upgrading an
existing deployment requires a server redeploy and a one-time auth migration — follow
[`docs/guides/migration-1.0.md`](docs/guides/migration-1.0.md) (short version:
`cerefox self-update` → `cerefox token generate` → `cerefox server deploy` →
update GPT Actions / remote-MCP clients to the token → revoke the legacy anon key).

### Security
- **Edge Function auth moved off the unrotatable legacy anon JWT to a rotatable,
  Cerefox-managed access token (BREAKING).** All 9 Edge Functions deploy
  `--no-verify-jwt` and validate a `cfx_pat_…` token in-function (constant-time,
  fail-closed) against the `CEREFOX_ACCESS_TOKENS` Function secret. New
  **`cerefox token generate | rotate | list`** manages it (zero-downtime rotation).
  The legacy anon JWT is retired for this layer. **Action required on upgrade** —
  see the migration guide. Design: `docs/specs/ef-auth-migration-design.md`.
- **Tightened RPC privileges**: the `cerefox_*` `SECURITY DEFINER` functions grant
  `EXECUTE` only to `service_role` (revoked from `PUBLIC`/`anon`/`authenticated`).
- **Hardened the `cerefox-mcp` OAuth surface**: issuer/JWKS derived from the
  injected `SUPABASE_URL` (not request headers); the OAuth path fails closed when
  `CEREFOX_OAUTH_OWNER_ID` is unset; the consent page uses the public-safe
  publishable key.
- **Pre-1.0 defensive security review** of the auth, database, Edge Function, web,
  and CLI surfaces (`docs/specs/security-audit-1.0.md`); hardening applied:
  `cerefox-search` / `cerefox-metadata-search` clamp the requested result count.
- New threat-model reference: `docs/specs/security-model.md`.

### Added
- **Cloud & mobile Claude over OAuth 2.1 (optional).** `cerefox-mcp` is an OAuth
  2.1 protected resource — claude.ai web and the Claude mobile app connect as a
  custom connector with the full 10-tool surface. Setup: `setup-supabase.md` Step 7.
- **Fully-offline local embedder for Cerefox Local.** Opt-in
  `CEREFOX_EMBEDDER=local` runs `nomic-embed-text-v1.5` (ONNX, 768-dim — no schema
  change) inside the container: no OpenAI key, and text never leaves your machine.
  Select at install (`install-local.sh --local-embedder`) or in `cerefox-local
  init`; the ~130 MB model downloads once into the data volume. Switching embedders
  on existing data requires `cerefox-local server reindex`.
- **`cerefox doctor` grew real server awareness**: schema-version + Edge-Function
  compatibility classification, a content-format progress line, and an
  embedder-consistency check (warns with a `server reindex` hint on mismatch).

### Fixed
- **Document reconstruction is lossless by construction (the 1.0 data-integrity
  fix).** Chunking is now an exact partition of the source (structural invariant:
  concatenating the chunks reproduces the document byte-for-byte), and
  reconstruction is versioned per chunk (`content_format`), so documents with
  large tables or blank-line-free paragraphs can no longer gain spurious blank
  lines. Existing documents keep the legacy format and reconstruct exactly as
  before; each converts on its next edit, or run `cerefox server reindex` to
  convert all. Also: an embedding-input cap so an oversized chunk can never fail
  an ingest. Design: `docs/specs/chunk-reconstruction-design.md`.
- **`cerefox metadata keys` no longer crashes when any document's `metadata` is a
  JSON scalar/array** (#89, thanks @tdebasis) — one malformed row poisoned the
  whole listing; ingest now also rejects non-object metadata at the boundary.
- **`cerefox mcp` no longer prints a false-positive "schema version mismatch"
  banner on every startup** (#90, thanks @tdebasis) — it compared the npm package
  version against the schema version; it now compares schema-to-schema with the
  correct remediation.
- **Version comparisons honor SemVer pre-release precedence** — previously every
  `1.0.0-*` pre-release compared equal, silencing doctor's "Edge Functions older
  than bundled" warning.
- **`cerefox-local` persists the pinned image ref** — previously a later `init`
  could silently recreate the container from `:latest` instead of the installed
  version.
- **`cerefox server reindex` targets the active embedder** — it hardcoded the
  OpenAI model, so it skipped everything after switching to the local embedder
  and would have mis-stamped embedding provenance.
- **Local-embedder inference is sub-batched** (default 4 texts per call,
  `CEREFOX_ONNX_BATCH`) so `server reindex` and large-document ingest survive
  small Docker VMs — a 12-text single inference was OOM-killed on a 2 GB VM.
- **Search thresholds auto-calibrate per embedder**: the default semantic floor
  is 0.6 with the local (nomic) embedder and 0.5 with OpenAI, because nomic
  scores unrelated text higher. `CEREFOX_MIN_SEARCH_SCORE` / `--min-score` win.
- **`cerefox-local doctor` is World-B aware**: no more bogus errors inside the
  container (env-based config is recognized, the Edge-Function check is skipped
  on a local backend, and the MCP-clients check points at the host).
- `cerefox-ingest` returns **409** (not 500) when content de-duplication rejects a
  write that would duplicate another document's content.
- Live-test project leak cleaned up; stale Python-era command strings in CLI
  messages corrected; `cerefox-local init` asks for the embedder before the
  OpenAI key.

### Changed
- **Documentation overhauled around the new auth narrative**: local agents use the
  local MCP, cloud Claude uses OAuth, ChatGPT uses GPT Actions + the Cerefox
  token, remote HTTP MCP is the advanced path. GPT Actions OpenAPI `info.version`
  is 3.0.0 (re-paste the schema in your Custom GPT and switch its auth to the
  token).
- Post-deploy reminders render as informational `ℹ` instead of alarming `⚠`.
- Pre-releases publish under their npm channel dist-tag (`beta` / `rc`) and never
  move `latest`; same policy for the ghcr `cerefox-local` image.

### Removed
- **Python is fully removed (BREAKING).** The frozen MCP fallback
  (`uv run cerefox mcp`), the husked Python CLI/web/ingestion packages, the legacy
  `scripts/*.py`, and `pyproject.toml` are deleted. The TypeScript runtime
  (`@cerefox/memory`) is the only implementation; the SQL schema assets under
  `src/cerefox/db/` are unaffected.
- **The `cerefox-oauth-consent` Edge Function** — the OAuth consent page is served
  solely by the Cloudflare Worker.
- `CEREFOX_MCP_STATIC_BEARER` and the anon-key auth path
  (`CEREFOX_SUPABASE_ANON_KEY` is no longer used by anything).

### Server versions at 1.0.0
- Schema **0.8.1** · Edge Functions **1.0.0** line · one `cerefox server deploy`
  brings an existing deployment current.

---

## [v1.0.0-rc.4] -- 2026-07-12

### Fixed
- **`cerefox-local doctor` no longer reports bogus World-A findings.** Inside the
  Cerefox Local container: the config check passes when settings resolve from
  environment variables (the container has no `.env` file by design), the
  Edge-Function check is skipped (a local backend has no Edge Functions), and
  the MCP-clients check points at host-side `cerefox-local configure-agent`
  instead of warning about configs it cannot see. A healthy local install now
  reports "All checks passed" instead of an error + warning.
- **Search threshold auto-calibrates per embedder.** The default semantic floor
  is now 0.6 with the local (nomic) embedder and 0.5 with OpenAI — nomic scores
  unrelated text higher, so the OpenAI-calibrated 0.5 let weak matches through
  on Cerefox Local. `CEREFOX_MIN_SEARCH_SCORE` / `--min-score` still override.

---

## [v1.0.0-rc.3] -- 2026-07-12

### Fixed
- **Local-embedder inference is sub-batched (default 4 texts per call,
  `CEREFOX_ONNX_BATCH`).** A 12-text single inference was OOM-killed (exit 137)
  on Colima's default 2 GB Docker VM — the container shares that VM with
  Postgres, PostgREST, and the web server. Sub-batching keeps peak memory flat,
  fixing `server reindex` and large-document ingest on small VMs.
  `setup-local.md` now documents the ≥ 4 GB VM recommendation.

---

## [v1.0.0-rc.2] -- 2026-07-11

### Fixed
- **`cerefox server reindex` now targets the ACTIVE embedder.** It hardcoded the
  OpenAI model as its target, so after switching Cerefox Local to the local
  embedder it reported "(nothing to reindex)" (existing OpenAI-embedded chunks
  looked already-correct), and `--all` would have stamped the wrong
  `embedder_primary` on locally-embedded vectors. The staleness filter, the
  recorded embedder, and the API-key gate all follow `CEREFOX_EMBEDDER` now.


### Fixed
- **`cerefox-local` now persists the pinned image ref.** Installing/upgrading with
  `CEREFOX_LOCAL_IMAGE=<ref>` stores the ref in the host config, and every verb
  that recreates the container (`init`, `start` on a busy port, `upgrade`) uses
  it. Previously the pin was one-shot: a later `cerefox-local init` silently
  recreated from `:latest` — observed downgrading a pinned rc.1 install to a
  stale local `:latest` image mid-init (which also re-applied that old image's
  RPCs over a newer schema until the next correct boot).


---

## [v1.0.0-rc.1] -- 2026-07-11

Feature freeze for 1.0.0 (release-candidate line): fixes only from here to stable.

### Fixed
- **Version comparisons now honor SemVer pre-release precedence.** `compareSemver`
  truncated versions to the numeric `X.Y.Z`, so every `1.0.0-*` pre-release (and
  `1.0.0` itself) compared equal — silencing `doctor`'s "Edge Functions older
  than bundled" warning across the entire beta line (a user following doctor
  ended up two EF releases stale with no hint). Also fixes the same comparison
  in the MCP startup banner and the client↔server compatibility matrix.
- **`cerefox-local init` asks for the embedder first** — choosing `[2] Local`
  now skips the OpenAI-key prompt entirely (the local embedder needs no key;
  an existing key is kept silently).

---

## [v1.0.0-beta.4] -- 2026-07-11

### Added
- **Fully-offline local embedder for Cerefox Local (iter-31).** Opt-in
  `CEREFOX_EMBEDDER=local` runs `nomic-embed-text-v1.5` (ONNX, q8, 768-dim — no
  schema change) inside the container: no OpenAI key, and document/query text
  never leaves your machine. Select it at install
  (`install-local.sh --local-embedder`) or interactively in `cerefox-local init`;
  the ~130 MB model downloads once into the data volume (survives upgrades).
  Cloud/Supabase deployments are unaffected (default stays OpenAI). Switching
  embedders on existing data requires `cerefox-local server reindex`;
  `doctor` gains an embedder-consistency check. Design:
  `docs/research/local-embedder-design.md`.

### Fixed
- **`cerefox metadata keys` no longer crashes when any document's `metadata` is a
  JSON scalar/array** (#89; schema 0.8.0 → 0.8.1 — redeploy via `cerefox server
  deploy`). One malformed row poisoned the whole listing ("cannot call
  jsonb_object_keys on a scalar"); the RPC now considers only object-typed
  metadata. Ingest (Edge Function + MCP tools) additionally rejects non-object
  `metadata` up front with a clear error, so such rows can't be stored again.
  Thanks @tdebasis for the precise report and proposed fix.
- **`cerefox mcp` no longer prints a false-positive "schema version mismatch"
  banner on every healthy startup** (#90). It compared the npm package version
  against the deployed schema version — two independent numbering scales that
  are never equal. It now compares schema-to-schema (the same source `cerefox
  doctor` uses) and warns only for the real redeploy footgun (the client bundles
  a newer schema than is deployed), with the correct remediation
  (`cerefox server deploy`, not the removed Python command). Thanks @tdebasis.

---

## [v1.0.0-beta.3] -- 2026-07-11

### Security
- **Pre-1.0.0 defensive security review (iter-28B ③).** A full read of the
  auth, database, Edge Function, web, and CLI surfaces. The material risks were
  already closed by the earlier auth work; this pass added one hardening fix and
  documented the review in `docs/specs/security-audit-1.0.md`.
- **Hardening:** `cerefox-search` and `cerefox-metadata-search` now clamp the
  requested result count to a sane maximum, so a large `match_count` / `limit`
  can't drive an oversized query. No API shape change.

---

## [v1.0.0-beta.2] -- 2026-07-10

### Removed
- **Python is fully retired (BREAKING, iter-28G).** The frozen, unmaintained
  Python implementation is deleted — the MCP-server fallback (`uv run cerefox
  mcp`), the husked CLI / web / ingestion packages, the legacy `scripts/*.py`,
  and `pyproject.toml` / `uv.lock` (31 files). The maintained paths are the
  `@cerefox/memory` npm package (local MCP + CLI), the remote `cerefox-mcp` Edge
  Function, and the Hono web app. **If you still run `uv run cerefox mcp`,
  switch to `npx --package=@cerefox/memory cerefox mcp`, or stay on 0.11.x.**
  The SQL schema assets (`src/cerefox/db/*.sql`) are unaffected — they are not
  Python and remain the source of truth for the schema + RPCs.

### Fixed
- `cerefox-ingest` now returns **409 `duplicate_content`** (was a generic 500)
  when an ingest or edit would collide with another document's content hash.
- The live pipeline suite no longer leaks `[E2E-pipeline-project…]` test
  projects — cleanup moved to `afterAll`, after the documents are purged so the
  membership rows cascade away first.

### Changed
- The two post-`server deploy` reminders (pin `CEREFOX_OAUTH_OWNER_ID` /
  generate `CEREFOX_ACCESS_TOKENS`) now render as informational `ℹ` (cyan)
  instead of a yellow `⚠` — they print on every deploy and are reminders, not a
  detected problem.

---

## [v1.0.0-beta.1] -- 2026-07-10

### Security
- **Edge Function auth moved off the unrotatable legacy anon JWT to a rotatable
  Cerefox-managed access token (breaking; iter-28E).** On Supabase projects using
  asymmetric (ES256) signing keys, the legacy anon key can only be revoked, not rotated,
  so a leak could not be cycled without disabling the Edge Function path. All 9 Edge
  Functions now deploy `--no-verify-jwt` and validate a **Cerefox access token**
  (`cfx_pat_…`) in-function (constant-time, fail-closed) against the `CEREFOX_ACCESS_TOKENS`
  Function secret; the token is rotatable and scoped to Edge Function access only. Generate
  it with the new `cerefox token generate`. The gateway no longer gates any Cerefox
  function; the only unauthenticated surface is `cerefox-mcp`'s RFC 9728 OAuth discovery
  route + 401 challenge. **Action required on upgrade** (see the migration guide): run
  `cerefox token generate`, update your GPT Actions / remote-MCP clients to the token, then
  revoke the legacy anon key. Design: [`docs/specs/ef-auth-migration-design.md`](docs/specs/ef-auth-migration-design.md).
- **Tightened RPC execute privileges (schema 0.7.0 — redeploy recommended).** The
  `cerefox_*` `SECURITY DEFINER` functions now grant `EXECUTE` only to `service_role`
  (revoked from `PUBLIC`/`anon`/`authenticated`), matching the intended
  Edge-Function-only access model. A security hardening — **existing cloud deployments
  should run `cerefox server deploy` to apply it.**
- **OAuth consent page uses the public-safe publishable key** (`sb_publishable_…`) instead
  of a broader key (the Cloudflare Worker + shared template).
- **Hardened the `cerefox-mcp` OAuth surface**: issuer/JWKS derived from the injected
  `SUPABASE_URL` rather than request headers; the OAuth path fails closed when
  `CEREFOX_OAUTH_OWNER_ID` is unset (opt out with `CEREFOX_OAUTH_ALLOW_ANY_USER=true`);
  removed the implicit `SUPABASE_ANON_KEY` fallback on the static-Bearer path.
- New threat-model reference: [`docs/specs/security-model.md`](docs/specs/security-model.md).

### Added
- **`cerefox token generate | rotate | list`** — manage the Cerefox access token (iter-28E).
  `generate` mints a `cfx_pat_…` token, sets it as the `CEREFOX_ACCESS_TOKENS` Supabase
  Function secret, and writes `CEREFOX_ACCESS_TOKEN` into your `.env` (so `doctor`, the live
  tests, and the optional remote-MCP client have it), then prints it once with paste
  guidance for a Custom GPT / remote MCP client. `rotate` widens the accepted set to the new
  and previous token for a zero-downtime cutover (`--finalize` drops the old); `list` shows
  the local token masked.
- **Cloud & mobile Claude over OAuth (optional).** `cerefox-mcp` is now an OAuth 2.1
  protected resource, so **claude.ai web and the Claude mobile app** can connect with the
  full 10-tool hybrid-search surface (previously unsupported / FTS-only). Opt-in: it needs
  the Supabase OAuth 2.1 Server enabled, an owner-user pin (`CEREFOX_OAUTH_OWNER_ID`), a
  pre-registered OAuth App (**`client_secret_post`**), and a hosted consent page shipped as
  a one-command free **Cloudflare Worker** (`cloudflare/cerefox-consent/`). Existing
  clients (Claude Code, Cursor, Codex, Gemini, Claude Desktop, local MCP) are unchanged and
  need none of it. In-function OAuth-JWT validation lives in the new dependency-free
  `_shared/mcp-auth/` (Web Crypto); the non-OAuth static path takes the Cerefox access
  token (iter-28E). Setup: `docs/guides/setup-supabase.md` Step 7. Design:
  `docs/specs/oauth-mcp-server-design.md`.

### Removed
- **The `cerefox-oauth-consent` Edge Function** (iter-28E). The OAuth consent page is now
  served solely by the free Cloudflare Worker (`cloudflare/cerefox-consent/`); the EF was a
  custom-domain alternative no longer worth its surface. If you deployed it, remove it with
  `npx supabase functions delete cerefox-oauth-consent`. (The shared `_shared/consent-page`
  template is retained — the Worker uses it.)

### Fixed
- **Document reconstruction is now lossless by construction (proper fix; schema 0.7.0 →
  0.8.0 — redeploy required).** The root cause of the corruption was that reconstruction
  synthesized a `\n\n` separator between chunks that was never stored, so any chunk boundary
  off a paragraph edge injected a blank line mid-content. The new **exact-partition chunker**
  stores chunk contents as a gapless slice-by-slice partition of the document, reconstructed by
  plain concatenation — `reconstruct(chunks) === document` byte-for-byte, so a boundary may fall
  anywhere (including inside a huge table) with zero corruption, and chunk size is bounded again.
  Versioned + lazy: a new `content_format` column on `cerefox_chunks` (`1` = legacy `\n\n`-join,
  `2` = blind-stitch) means existing documents reconstruct exactly as before and convert only on
  next edit (or `cerefox server reindex`); archived versions keep their own format. `cerefox
  doctor` reports how many docs still use the legacy format. Also caps embedding inputs
  (`CEREFOX_EMBED_MAX_INPUT_CHARS`, default 20000) so an oversized chunk can never fail an ingest.
  The three TS chunkers were consolidated into one. What it means: `cerefox guides show
  content-format`. Design: `docs/specs/chunk-reconstruction-design.md`.
- **Chunker no longer corrupts documents whose single paragraph/table exceeds
  `max_chunk_chars`.** (Interim fix, superseded by the exact-partition fix above.)
  `cerefox_reconstruct_doc` reassembles a document by joining chunks
  with `\n\n`, so the chunker must only split at paragraph boundaries. The oversized-section
  path violated this by hard-splitting *inside* a paragraph — which both duplicated content
  (an old 50%-overlap slice) and inserted spurious blank lines mid-word / mid-table-row on
  reconstruction. An oversized single paragraph (commonly a large markdown table, which has
  no blank lines) is now kept **whole** as one chunk, so reconstruction is lossless. Fixed
  identically in the TS and Python chunkers. Affected documents re-chunk cleanly on their
  next write; no schema change. (See `docs/specs/…` / the chunker regression tests, which
  now assert `reconstruct(chunks) === original`.)

---

## [v0.11.1] -- 2026-06-13

### Fixed

- **Content updates no longer wipe a document's metadata.** Every transport defaulted
  an absent `metadata` argument to `{}` and the ingest RPC applied it verbatim — so any
  content update that didn't re-pass the tags (CLI `document ingest` without
  `--metadata`, MCP `cerefox_ingest`, the REST EF, the frozen Python fallback) silently
  cleared the document's metadata. And since metadata is not versioned, the loss was
  unrecoverable. The contract is now **NULL = "not provided" → keep existing** (create
  uses `{}`), enforced once in the `cerefox_ingest_document` RPC; pass `{}` explicitly
  to deliberately clear. Schema version 0.5.0 → **0.6.0** (RPC-only; run
  `cerefox server deploy` — v0.11.1 clients sending NULL against a 0.5.0 server would
  fail the NOT NULL constraint on update).
- **CLI parity: `cerefox metadata search` no longer requires `--metadata-filter`.**
  Like the MCP tool / EF (relaxed in v0.10.x — the CLI was missed), at least one of
  filter / `--project-name` / `--updated-since` / `--created-since` is required;
  `--project-name` alone lists that project's documents.

---

## [v0.11.0] -- 2026-06-12

### Changed — BREAKING

- **Optimistic concurrency control on content updates** (design:
  [`docs/specs/concurrency-control-design.md`](docs/specs/concurrency-control-design.md)).
  Updating a document's content (via `document_id` or `update_if_exists`) now requires
  **`expected_content_hash`** — the `content_hash` of the version the edit was based on,
  returned by every read surface (`cerefox_get_document`, `cerefox_search`,
  `cerefox_metadata_search`, the REST EFs, `cerefox document get` / `cerefox search`,
  and the web edit page). The check is atomic inside the `cerefox_ingest_document` RPC
  (`SELECT … FOR UPDATE`), closing the read→embed→write race where two concurrent
  writers silently last-write-wins'd each other. A stale hash fails with a **conflict**
  (re-read → merge → retry; HTTP 409 on the REST path); a missing hash fails with
  **token-required** (HTTP 400). `last_write_wins: true` (CLI `--last-write-wins`)
  explicitly skips the check and is recorded in the audit log — `document ingest-dir`
  and `guides ingest` pass it internally (the filesystem / npm package is their source
  of truth), and the frozen Python fallback declares it to preserve its historical
  behavior. **Breaking**: pre-v0.11 clients' content updates fail against an upgraded
  server until updated (`cerefox self-update`); existing GPT Actions need the v2.0.0
  OpenAPI block re-pasted. Creates are unaffected. Schema version 0.4.0 → **0.5.0**
  (RPC-only change; ships via `cerefox server deploy --schema-only`).

### Added

- `content_hash` returned by all document-shaped reads (MCP tool headers, CLI output,
  REST EF responses, web document API) — the token for the concurrency contract above.
- CLI flags `--expected-content-hash` / `--last-write-wins` on `cerefox document ingest`.
- Web edit page detects mid-edit concurrent changes and shows a merge-needed conflict
  error instead of silently overwriting.

### Fixed

- **Web edit page could corrupt metadata keys via the key autocomplete.** The key
  suggestions embedded the usage count in the option label (`status (108)`), and
  Mantine's Autocomplete inserts the *label* into the field on select — so picking a
  suggestion (and saving) stored the literal string `status (108)` as the metadata key,
  polluting the KB taxonomy (it then showed up in the key list as `status (108) (1)`).
  The dropdown now shows the count via `renderOption` ("status · 108 docs" style),
  while only the bare key ever enters the field. The search filter's key Select (which
  was never affected — Select keeps value/label separate) now labels the count as
  "(N docs)" for clarity.

---

## [v0.10.4] -- 2026-06-09

### Added

- **`cerefox_metadata_search` can now list a project's documents** — closing a CLI↔MCP
  parity gap (the CLI's `cerefox document list --project <name>` had no MCP equivalent).
  `metadata_filter` is now **optional**: supply `project_name` (and/or `updated_since` /
  `created_since`) alone to list documents by scope, ordered newest-updated first. At
  least one of `metadata_filter` / `project_name` / `updated_since` / `created_since` is
  still required, so the tool never becomes an unbounded whole-KB dump. Backward
  compatible — existing non-empty-filter callers are unaffected. The twin
  `cerefox-metadata-search` Edge Function and the GPT Actions OpenAPI block
  (`info.version` → 1.9.0) were relaxed in lockstep. A new **CLI ↔ MCP parity matrix** in
  [`docs/guides/cli.md`](docs/guides/cli.md) documents the full surface and the remaining
  (intentional vs. actionable) gaps.
- **`cerefox document set-projects <document-id> [names…]`** — new CLI command
  closing the reverse parity gap (the `cerefox_set_document_projects` MCP tool
  had no CLI form). Full-set replace of a document's project memberships
  (`--clear` removes all); created-if-missing, case-insensitively de-duplicated,
  logged as an `update-metadata` audit entry. Shares the membership-replace core
  with the MCP tool (`_shared/mcp-tools/_projects.ts → replaceDocumentProjects`)
  so both behave identically.

---

## [v0.10.3] -- 2026-06-06

### Fixed

- **`cerefox server deploy` Edge Functions now deploy via the Supabase Management API
  (`--use-api`)** instead of the local Docker bundler. The Docker bundler bind-mounts the
  function source dir, which fails (`entrypoint path does not exist`) when the npm package
  is installed under a path Docker Desktop won't file-share — notably **`/usr/local`** (the
  classic Homebrew/`npm config set prefix /usr/local` location) — *and* Docker Desktop is
  running. The API path is Docker-independent, so the deploy works regardless of where npm
  placed the package or whether Docker is up. (Thanks @tdebasis — [#84].)

[#84]: https://github.com/fstamatelopoulos/cerefox/issues/84

---

## [v0.10.2] -- 2026-06-06

### Fixed

- **Web search now actually applies `CEREFOX_MIN_SEARCH_SCORE`.** The v0.10.1 fix was
  incomplete: the web UI defaults to `docs` mode, but only the `hybrid` branch in
  `discovery.ts` was updated — the `docs` branch still passed `p_min_score: 0.0` (a
  `replace_all` missed it due to a different indent). The default web search therefore
  applied no threshold. Both branches now use `getMinSearchScore()`. (Note: in hybrid/docs,
  the threshold filters *vector-only* matches; FTS keyword matches still pass by design.)
- **CLI honors `CEREFOX_MAX_RESPONSE_BYTES`.** The CLI enforces a response byte budget
  (`--max-bytes`) but ignored the env var; its default now reads
  `CEREFOX_MAX_RESPONSE_BYTES` (200000 fallback). Corrected CLAUDE.md: the budget applies
  to MCP/EF **and** the CLI; only the web UI is unlimited.

### Security

- **Local container binds to `127.0.0.1` by default** (was `0.0.0.0`), so a single-user
  self-hosted backend isn't exposed on the LAN. Opt in with `CEREFOX_LOCAL_BIND=0.0.0.0`.

### Docs

- World-B (local/self-hosted) coverage across the guides: `upgrading.md`
  (`cerefox-local upgrade`), `operational-cost.md` (fully-local scenario — no Supabase/EF
  cost), `access-paths.md` (in-container PostgREST + docker-exec MCP; token never leaves
  the container), `connect-agents.md` (`cerefox-local configure-agent` / `cerefox-local mcp`).

### Added — local backend (World B), continued

- **`cerefox-local configure-agent --tool <client>`** now wires non-Claude clients too
  (Claude Desktop, Cursor, Codex, Gemini), not just Claude Code. It reuses the bundled
  config writers via a one-shot `docker run` (the bin gains a `--local` flag that points
  the MCP entry at the `cerefox-local mcp` shim); Claude Code still goes through
  `claude mcp add` on the host.
- **Shell completion is program-name aware + auto-installed.** `cerefox completion <shell>`
  emits a script bound to the actual program name, so `cerefox-local completion <shell>`
  produces a working `cerefox-local` completion that doesn't clash with the cloud `cerefox`
  one (functions + bindings namespaced; cloud output unchanged). `install-local.sh` now
  wires it up host-side (best-effort, idempotent) — generating the script from the
  container and sourcing it from your shell rc, mirroring the cloud installer + printing an
  "exec $shell" hint. (The `completion install` subcommand itself can't be used for World B
  — proxied into the container, it would write inside it — hence the host-side wiring.)

---

## [v0.10.1] -- 2026-06-05

### Fixed — `.env` overrides dropped in the Python→TS migration

Several documented `CEREFOX_*` options were silently no-ops in the TS runtime. Each now
has a single default honored consistently by the CLI, MCP, and web — and forwarded into
the local/World-B container:

- **`CEREFOX_MIN_SEARCH_SCORE`** (default `0.5`). The web API previously passed `0.0`, so
  the web UI surfaced irrelevant low-similarity results; it now matches CLI/MCP.
- **`CEREFOX_MAX_RESPONSE_BYTES`** (MCP/Edge-Function ceiling; web + CLI stay unlimited).
- **`CEREFOX_MAX_CHUNK_CHARS` / `CEREFOX_MIN_CHUNK_CHARS` / `CEREFOX_VERSION_RETENTION_HOURS`
  / `CEREFOX_VERSION_CLEANUP_ENABLED`** (ingestion).
- **`CEREFOX_BACKUP_DIR`** (`cerefox backup` default).
- **OpenAI embedding overrides** `CEREFOX_OPENAI_BASE_URL` / `_EMBEDDING_MODEL` /
  `_EMBEDDING_DIMENSIONS`. ⚠ changing model/dimensions is breaking — requires
  `cerefox server reindex` (DB column is `vector(768)`); documented loudly.
- A `bun test` guard now fails if any `.env.example` var isn't referenced in the TS source
  (cheap regression guard against future migration drift). `.env.example` cleaned up:
  removed the no-op `CEREFOX_LOG_LEVEL`; marked Fireworks as not-yet-implemented in TS.

### Changed — local backend (World B) polish

- `install-local.sh` **auto-selects a free host port** (steps `+10` past a busy port, and
  past `8000` when a cloud install shares that default) instead of silently colliding;
  clearer message distinguishing "in use" from "avoiding the cloud default".
- **`cerefox-local start`/`upgrade`/`init` re-check the port at bring-up time** and step
  `+10` to a free one (persisting it to `~/.cerefox/local/.env`) if the stored port was
  taken since last run — so a port grabbed by something else doesn't leave the server
  failing to bind. Only the container-(re)starting verbs do this; proxied KB commands don't.
- Detect-and-guide when Docker is missing or its daemon is stopped (no auto-install).
- World-B users can put the `CEREFOX_*` tuning overrides above in `~/.cerefox/local/.env`;
  they're forwarded into the container (apply with `cerefox-local init`).

### Docs

- README presents cloud vs local as two backend options; trimmed "Project status".
- Fixed stale items: `.docx` ingest **is** supported (mammoth; only PDF dropped); CLI old
  flat verbs are husks (not "removed"); `--mode hybrid` (not `semantic`); quickstart
  timing + `setup-local.md` mis-links; "Python CLI/web" framing.

---

## [v0.10.0] -- 2026-06-05

**Local / self-hosted Cerefox backend (new deployment mode — "World B").** Run Cerefox
entirely on your own machine — Postgres + pgvector + PostgREST + cerefox-server in one
Docker container — with **no cloud dependency and no Node/Bun on the host**. It reuses
the existing schema, RPCs, MCP handlers, web app, and supabase-js data client unchanged
(config-only); cloud (Supabase) deployments are completely unaffected. Cloud and local
are independent worlds — **separate installers, separate command names** (`cerefox` vs
`cerefox-local`).

### Added

- **All-in-one Docker image** (`docker/local/Dockerfile`): pgvector + pinned PostgREST +
  the bundled app + the `cerefox-local` host script, supervised by **s6-overlay**
  (db-init → postgres/postgrest/cerefox-server). The container **self-generates its JWT
  secret on boot and mints the access token internally — the token never leaves the
  container.** Published multi-arch (amd64+arm64) to **ghcr.io/.../cerefox-local** by
  `.github/workflows/local-image.yml` — opt-in via `cut_release.ts --docker-publish`
  (decoupled from cutting a Release, same policy as the npm publish).
- **One-line local installer** (`docker/local/install-local.sh`, shipped as a Release
  asset): `curl -fsSL …/install-local.sh | sh`. Docker-only — pulls the image, runs it
  with `--restart unless-stopped`, waits for readiness, and installs a `cerefox-local`
  command on PATH. The only host-side secret is `OPENAI_API_KEY` (in
  `~/.cerefox/local/.env`); the cloud `~/.cerefox/.env` is never touched.
- **`cerefox-local` command**: host-side lifecycle (`init`, `start`/`stop`/`restart`,
  `upgrade`, `uninstall [--purge]`, `status`, `logs`, `configure-agent`) plus a proxy that
  runs every KB verb (`search`, `document`, `project`, `mcp`, …) inside the container via
  `docker exec` — so MCP stdio works and the same bundled binary serves the local backend.
  **`cerefox-local init`** sets/rotates the OpenAI key after install.
- **`CEREFOX_PROG_NAME`**: the bundled bin presents as `cerefox-local` in help/usage when
  the shim sets it (one binary, no fork).
- **`/rest/v1` reverse-proxy in cerefox-server** (`registerPostgrestProxy`), mounted only
  when `CEREFOX_POSTGREST_UPSTREAM` is set — so it is **inert in cloud**. Makes the server
  the single local gateway (UI + `/api/v1` + `/rest/v1`).
- **`cut_release.ts`** now uploads `install-local.sh` as a Release asset (next to
  `install.sh`).
- **Version-coupling CI** (`.github/workflows/version-coupling.yml`): runs the read/write
  smoke against the pinned PostgREST so a `supabase-js` bump that breaks the local stack
  fails CI.

### Fixed

- **Local image Help page**: bundle the docs + agent guides into the image so `/app/help`
  renders offline (was "No bundled docs available").

Design: `docs/research/local-cerefox-design.md`; plan: `docs/plan.md` (Iteration 30).
Polish deferred to v0.10.1: `cerefox-local --help` merge, in-bin `configure-agent
--local` for non-Claude clients, and `cerefox-local` shell completion.

---

## [v0.9.11] -- 2026-06-03

### Fixed

- **Web UI analytics now records usage.** The `/api/v1` web routes never called the
  usage-logging RPC, so the Analytics page stayed empty even with usage tracking
  enabled (only the CLI and MCP tools logged). The web layer now logs `search`,
  `get-document`, and `ingest` operations (`access_path = "webapp"`, fire-and-forget,
  best-effort — never blocks the response). The `cerefox_log_usage` RPC, config gate,
  and report query were all already correct; this closes the missing call sites.

---

## [v0.9.10] -- 2026-06-02

**Installer/upgrade reliability. Client-only — no server deploy.**

### Fixed

- **Stale-manifest-cache upgrades** — `install.sh` and `cerefox self-update`
  now bypass the package manager's cached registry manifest (`--no-cache` for
  bun, `--prefer-online` for npm) when installing/upgrading. Previously, if a
  new version was published soon after a prior install, bun could reuse a
  still-"fresh" cached manifest that didn't list the new version — so a
  re-install resolved `@latest` to the old version (and even an explicit
  `@<new>` failed with "No version matching"). Forcing a fresh manifest fetch
  makes upgrades deterministic regardless of release cadence.

---

## [v0.9.9] -- 2026-06-02

**Document version UX + docs/completion polish. Client-only — no server deploy.**

### Added

- **View an archived version in place** — clicking a version number (or "Open
  this version" in its ⋯ menu) opens that snapshot read-only at
  `/document/:id?version=<id>`, with a "Previous version: vN" banner and a
  "View current version" link back. In version view the header offers only
  **Download** and a **Protect / Unprotect** toggle (the version's
  archive/cleanup-protection flag); Edit, Delete, the review pill, and the
  Chunks tab are hidden.
- **Per-version size** in the Versions card — each row now shows
  `N chunks · M chars`, and the actively-viewed version is highlighted.

### Changed

- **`cerefox completion install` (zsh)** now self-bootstraps `compinit` if no
  completion system has been initialized yet, so cerefox completion registers
  even on a bare shell. It's a no-op when `compinit` already ran (no double
  init).
- **Quickstart** title no longer claims "5 Minutes"; adds a dedicated **Step 0:
  Create a Supabase project** (linking `setup-supabase.md`) so the prerequisite
  is explicit rather than buried.

---

## [v0.9.8] -- 2026-06-01

**Web UI polish + a CLI parity addition. Client-only — no server deploy.**

### Added

- **`cerefox document list --deleted`** — list soft-deleted (trashed) documents
  from the CLI (newest-deleted first, with a `deleted_at` column), closing the
  loop with `document restore` / `document delete`. Documented in `cli.md`;
  shell completion picks it up automatically.
- **Reusable multi-line CLI card** on the Dashboard, Ingest, Trash, and Projects
  pages — the `cerefox …` commands equivalent to each page, each independently
  copyable (with a ✓ confirmation), no fake example-output lines.
- **In-trash document view** — opening a trashed document now shows a clear
  "In trash" banner and swaps the header actions to **Restore / Purge** (Edit,
  Delete, and the review pill are hidden); `/documents/{id}` now returns
  `deleted_at` so the UI can detect it.
- **Pagination controls** on all list views: a **rows-per-page** dropdown
  (10/25/50/100, persisted in `localStorage` as one global preference) and
  **first / prev / next / last** arrows.

### Changed

- **Project documents view** (`/projects/:id/documents`) rebuilt to match the
  redesigned list pattern (styled table, eyebrow, CLI hint, consistent
  pagination footer), keeping its server-side paging.
- **Copy buttons** (CLI cards, search result reference) flip to a green ✓ for
  ~1.2s on click as clipboard confirmation.
- **Delete affordances** are consistent — every delete/purge highlights red on
  hover (shared `.btnDanger`); the Document page's Delete is a labelled ghost
  button matching Edit/Download. Trash/Projects row actions are always visible
  (no longer hover-only).
- **Document page**: project tags above the title are clickable (open the
  project's document list); the origin chip now has a prompt Mantine tooltip.
- **Analytics**: a tooltip on the usage-tracking toggle explaining what it logs.

### Fixed

- The slow native `title` tooltip on the Document origin chip (easy to miss) is
  now a Mantine tooltip; the Trash/Projects CLI cards were widened so commands
  aren't clipped.

---

## [v0.9.7] -- 2026-06-01

**Schema version now signals required server redeploys, enforced by the
release tooling.**

> **Upgrade:** run `cerefox server deploy` (this re-applies `rpcs.sql`).
> `cerefox doctor` / the web banner now correctly report "newer server
> available" until you do.

### Fixed

- **`cerefox doctor` / the schema banner under-reported after v0.9.6.** v0.9.6
  added two RPCs (`cerefox_corpus_totals`, `cerefox_recent_doc_authors`) — which
  require `cerefox server deploy` — but left `schema_version` at `0.3.1`, so a
  client upgraded *without* redeploying was told "schema up to date" while the
  dashboard's new RPC-backed features silently fell back. Bumped `schema_version`
  **0.3.1 → 0.4.0** (the `@version:` marker in `schema.sql` and the
  `cerefox_schema_version()` literal in `rpcs.sql`, in lockstep). An
  un-redeployed server now reports "newer server available — run
  `cerefox server deploy`." (`minSchema` stays `0.3.1`: the routes degrade
  gracefully, so this is a nudge, not a hard requirement.)

### Changed

- **`cut_release.ts` now enforces the schema version** (the symmetric
  counterpart to the existing `EF_VERSION` guard): if anything under
  `src/cerefox/db/` changed since the last tag, the cut **fails** unless
  `schema_version` was bumped — and the two literals (`schema.sql @version:` and
  `cerefox_schema_version()`) must agree. This turns the previously-manual
  RELEASING.md step into a hard gate, so the v0.9.6 miss can't recur.
- **Docs:** RELEASING.md (step 4 + the versioning table) now names *both*
  literals and the new gate; CLAUDE.md instructs agents to follow the
  RELEASING.md pre-release checklist on any release-intent PR and to bump
  `schema_version` on any `src/cerefox/db/` change.

---

## [v0.9.6] -- 2026-06-01

**v0.9.6 — web UI redesign: a distinct visual identity, all core pages
rebuilt, a theme switcher, a reusable list/table pattern, and small
read-only backend additions.**

> **Upgrade:** run `cerefox server deploy` after upgrading — this release adds
> two new **read-only** RPCs (`cerefox_corpus_totals`, `cerefox_recent_doc_authors`)
> that the dashboard uses. The web routes degrade gracefully until they're
> deployed (totals show 0, the Author column falls back to the source channel).
> **No Edge Function changes** (no `EF_VERSION` bump). Restart `cerefox web` so
> the new routes (`/api/v1/preferences`, the dashboard fields) take effect. No
> reindex required.

### Added

- **A real visual identity for the web client.** Replaces the stock-Mantine
  look with a Cerefox theme drawn from the fox logo: deep-indigo ground,
  fox-orange as the action color, violet/steel-blue/green accents; geometric
  display type (**Space Grotesk**), **Geist** for UI, **JetBrains Mono** for
  machine data. Implemented as a Mantine theme plus a semantic token layer
  (`tokens.css`, accents derived from Mantine's vars so there's one source of
  truth) and a shared primitives module reused across pages.
- **Light / dark / system theme switcher** in the header, persisted durably to
  `~/.cerefox/web-prefs.json` via a new file-based `GET/PUT /api/v1/preferences`
  endpoint (works without Supabase). Mantine's `localStorage` is the no-flash
  fast path; the file is reconciled on mount so the choice survives a cache clear.
- **Redesigned Dashboard** — eyebrow + greeting hero with quick-search and an
  Ingest action; a 4-card stat strip (Documents, Indexed chunks + total chars,
  Projects + docs-in-trash, **Agent activity over the last 30 days** from the
  usage log with a graceful "why no data?" state); a "Recently changed
  documents" table with an **Author** column (the real last editor, with an
  agent/human chip); a scrollable Projects rail with fill bars; and a CLI-mirror
  card.
- **Redesigned Search** — split the conflated mode control into a **granularity**
  toggle (Documents / Chunks) and a **ranker** dropdown (Hybrid / Keyword /
  Semantic); result cards with a **score ring**, heading-path breadcrumb, snippet
  clamp, and an expand panel. Result titles link straight to the document.
- **Redesigned Document view** — header with project chips, origin/author chip,
  meta, and a clickable review pill; a Rendered / Source / Chunks content card
  with its own scroll; and a sticky right rail (Contents TOC with anchor scroll,
  Details + metadata tags, Versions with a per-version actions menu, and an
  Activity timeline from the audit log).
- **Redesigned Ingest** — Paste / Upload tabs that no longer reshuffle the form,
  a drag-and-drop zone, project toggle chips with a filter for large lists,
  metadata key/value rows, an Edit/Preview editor, and a Pipeline + CLI rail.
- **Reusable list/table pattern (`ListPage`)** now drives **Audit Log**, **Trash**,
  **Projects**, and **Metadata Search**: a consistent header, search box,
  filter toolbar, styled table, row actions, and client-side pagination.
  - **Audit Log** gains from/to **date filters** and a max-entries selector
    (was hard-capped at 100).
  - **Trash** gains a show-up-to limit selector plus inline restore / purge.
  - **Projects** gains document-count columns (with fill bars) and create/edit
    in modals.
  - **Metadata Search** keeps its multi-field filter builder and renders results
    in the new table (row → document).
- **Per-page CLI-parity hints** — a compact terminal snippet (themed like the
  dashboard CLI card) that shows the equivalent `cerefox …` command for the
  current page/query, copies it on click, and links to the CLI docs (Search,
  Metadata Search, Projects, Audit Log, Trash, Help).
- **Dashboard read-only aggregates** — `GET /api/v1/dashboard` now returns
  global `total_chunks` / `total_chars` (`cerefox_corpus_totals`) and the latest
  audit author per recent document (`cerefox_recent_doc_authors`).
- **Analytics:** the usage-tracking toggle moved to the page header and now
  fires a confirmation toast when flipped.

### Fixed

- **Help guide content returned 404 in source/dev mode** — the docs index
  listed guides but `readDoc` resolved guide paths against the wrong root.
  Guide content now loads (and the Help page gained a sidebar guide filter and a
  viewport-height content pane).
- The Help page no longer requires the full prototype "help center" landing
  (fictional topic counts / popular lists that don't map to the bundled guides);
  the embedded docs reader is kept and lightly enhanced.

---

## [v0.9.5] -- 2026-05-31

**v0.9.5 — `deploy-server` rename fix + upgrade-doc simplification + DOCX upload (beta).**

### Added

- **DOCX ingestion in the web upload + CLI — beta.** The web Ingest page and
  `cerefox document ingest report.docx` now accept `.docx` and convert it to
  Markdown on the way in (via `mammoth`), so Word heading styles map to headings
  and the content chunks well (mammoth's empty Word-bookmark `<a id>` anchors are
  stripped so the heading path stays clean). Markdown / `.txt` are unchanged. **PDF is
  intentionally not supported** — convert it to Markdown upstream first (PDF
  layout has no reliable heading structure). The MCP path is unaffected by
  design: agents read and ingest the extracted Markdown themselves, so the
  conversion is purely a human "ingest this file for me" convenience.
  **Beta caveat:** conversion fidelity varies with document complexity —
  heading-styled documents convert cleanly, but heavy tables, images, or
  footnotes may convert imperfectly. Review the ingested Markdown before relying
  on it, and convert upstream if the result is rough.

### Fixed

- **Web UI ingest page offered `.pdf` / `.docx` uploads** though PDF/DOCX ingest
  was dropped in v0.7 — the file picker now accepts `.md` / `.txt` only.
- **Stale `cerefox deploy-server` references emitted the renamed husk.** After
  the v0.9 rename to `cerefox server deploy`, several spots still named the old
  verb (which now exits non-zero): `cerefox doctor`'s remediation, the
  `server deploy` pre-flight/error output, the `cerefox web` compatibility
  message, and the EF-predates-v0.8 banner. Worse, **`cerefox init`'s "deploy
  the server now?" flow actually *spawned* `deploy-server`** and hit the husk —
  now it spawns `server deploy`.
- **`quickstart.md` install description was self-contradictory** ("detects Bun
  or installs it *and* falls back to npm"). Now states the real behavior: prefer
  Bun if present, else npm (Node ≥ 20), else bootstrap Bun.

### Removed

- **Deleted the per-version migration guides** (`migration-v0.4/v0.5/v0.9.md`).
  The 0.1→0.9 arc happened within a week and is now reached by the installer +
  `cerefox server deploy` (which applies all pending migrations in one shot),
  so three version-specific guides were confusing clutter. `upgrading.md` is the
  single upgrade reference — tightened and simplified: it folds in the v0.9
  verb-rename note, adds the "old pre-installer clone → switch to the installer"
  path, and collapses the obsolete per-`v0.1.x` redeploy notes into "`server
  deploy` applies everything; reindex when a release says so." Inbound links
  (README, CLAUDE.md, package README, connect-agents) repointed to `upgrading.md`.
- **Dropped the dead `pdf` / `docx` / `converters` optional-dependency extras**
  from `pyproject.toml` (and `pypdf` / `python-docx` / `lxml` from `uv.lock`) —
  the converter code they supported was removed in v0.7.

---

## [v0.9.4] -- 2026-05-31

**v0.9.4 — agent retrieval guidance, Decision Log process docs, + a web-UI tweak.**

### Added

- **`AGENT_GUIDE.md`: "Choosing a retrieval tool" section.** Explains when to use
  `cerefox_search` (relevance-ranked top-N; default `match_count` 5) vs
  `cerefox_metadata_search` (exhaustive enumeration by criteria; metadata-only by
  default; raise `limit`), with worked examples and the "find the newest in a
  growing series via a `latest` metadata pointer, not text search" pattern.
- **Web UI — second Save/Cancel on the Edit Document page.** A Save/Cancel row now
  also sits between the metadata fields and the Content editor, so metadata-only
  edits don't require scrolling past the (often long) content textarea.

### Changed

- **Rewrote the `CLAUDE.md` Decision Log section** with the new discovery +
  maintenance process: a string-typed metadata convention (`type`, `seq`,
  `quarter`, `latest`; the part number stays in the title), discovery via
  `cerefox_metadata_search {type:"decision-log", latest:"true"}` instead of text
  search, global `seq` ordering, and a split/transition protocol (create the new
  part with `latest="true"` first, then clear the previous part). Reframed as a
  maintainer practice that doesn't obligate forks' agents to write to their KB.

---

## [v0.9.3] -- 2026-05-31

**v0.9.3 — docs/installer accuracy.** Client/CLI only — no schema, RPC, or
Edge Function changes.

### Fixed

- **Installer "Wire up an AI agent" step listed only two clients.** It now
  lists all five `configure-agent` targets (claude-code, claude-desktop,
  cursor, codex, gemini) and notes that each writes a local `cerefox mcp`
  server entry.
- **npm package README (`@cerefox/memory`) was stale.** Replaced the
  "clone required" server-side setup with the bundled `cerefox server deploy`
  flow (no clone), and fixed the example commands that still used pre-v0.9 flat
  verbs (`ingest`, `list-projects`, `metadata-search`, `get-audit-log`,
  `ingest-dir`) and `cerefox docs --list` → `cerefox guides list`.
- **Root README "Project status" was stale** — said "at v0.9.0" and left the
  "(current)" marker on the v0.7.0 roadmap row. Updated to the v0.9.x line and
  moved the marker to the current phase.
- **Repo-wide documentation accuracy pass.** A full audit of the guides,
  process docs, and internal specs caught and fixed: dead `uv run pytest` /
  `uv run python scripts/*.py` commands (→ `bun test` / `bun scripts/*.ts` /
  `cerefox server reindex`); lingering `cerefox deploy-server` → `cerefox
  server deploy`; an incorrect "`cerefox-mcp` delegates to Edge Functions via
  internal fetch" claim (it calls Postgres RPCs directly) in `CLAUDE.md` and
  `solution-design.md`; the `CLAUDE.md` CLI-verb list (dropped `docs`/`sync-docs`,
  added the `guides` group + newer verbs); `FastAPI`-serves-the-SPA statements
  (→ `cerefox web` / Hono) in the requirements + design docs; the Python/Click/
  pytest tech-stack table; a non-existent `cerefox_delete_document` MCP tool in
  `AGENT_GUIDE.md`; the `connect-agents.md` small-to-big default (40000 → 20000);
  and `migration-v0.9.md`'s version-verb (`document version list`).
- **`docs/guides/setup-cloud-run.md`** now opens with an "aspirational — not
  tested end-to-end" banner so readers treat it as guidance, not a verified runbook.
- **`docs/guides/operational-cost.md`** corrected: the free tier's binding limit
  for cloud usage is **Edge Function invocations (500k/mo)**, not a "50,000 API
  calls" cap (that was the Auth MAU figure — Data API requests are unlimited).
  Added a per-access-path EF-cost table and the local-MCP lever (the local stdio
  server hits the Data API directly, so it costs zero invocations).
- **`docs/examples/mcp-configs/`**: `local-stdio.json` no longer uses the legacy
  Python `uv run cerefox mcp` path — it's now `npx --package=@cerefox/memory
  cerefox mcp` (no clone, no Python); README leads with `cerefox configure-agent`.
- **`docs/solution-design.md`** + **`requirements-and-specs.md`** brought current:
  ASCII architecture diagrams converted to Mermaid (renders on GitHub); TS-runtime
  reality throughout; and several SQL-grounded corrections (phantom version-row
  columns, `metadata` column name, `cerefox_context_expand`, `cerefox_ingest` vs
  the never-shipped `cerefox_save_note`, the full 10-tool list).
- **Docker setup was broken/stale**: the `Dockerfile` built a Python image and
  ran `uvicorn cerefox.api.app:app` — a removed husk. Rewrote it to the TS
  runtime (`node` base → `@cerefox/memory` → `cerefox web`) with an "untested"
  banner; `docker-compose.yml` + `.env.example` updated to match (`cerefox
  server deploy` / `db_deploy.ts` instead of `db_deploy.py`, TS web not FastAPI).
- **CLI reference advertised flags that don't exist.** A file-by-file pass
  against the command source found `docs/guides/cli.md` (and the bundled
  `AGENT_QUICK_REFERENCE.md`) promising long-form aliases — `--count`,
  `--filter`, `--project`, `--update`, `--version`, `-y` — that were never
  implemented (only the canonical long names + single-letter short forms
  exist), plus `cerefox document ingest-dir` documenting nonexistent
  `--pattern`, `--recursive`, and `--dry-run` flags (it always recurses; the
  real selector is `--extensions`), and a wrong `search` surface (modes are
  `docs`/`hybrid`/`fts` default `docs`, `--match-count` defaults to 5, not the
  documented `hybrid`/10). Corrected the reference, the `--recursive` examples
  in the README/quickstart, the same fake-alias claims in `configuration.md`,
  `connect-agents.md`, and `AGENT_GUIDE.md`, and regenerated the
  `cerefox_get_help` bundle.
- **PR template still listed `uv run pytest`** in its test-plan checklist
  (pytest retired) → `bun test` / `CEREFOX_LIVE_E2E=1 bun test`. Also fixed a
  stale "`_shared/` will grow with `ingest/` (v0.7+)" line in CONTRIBUTING and
  an `access-paths.md` `click.confirm` reference.
- **More stale READMEs/specs**: `test-data/README.md` used `uv run cerefox` +
  pre-v0.9 verbs and an invalid `--pattern` flag (→ `cerefox document …`,
  default `.md/.txt`); `_shared/README.md` was frozen at a v0.3.0 "seed only /
  future shape (v0.4+)" snapshot (→ current module list + rationale);
  `docs/specs/ui-redesign-spa-python-api.md` got a SHIPPED/superseded banner
  (the API it targeted is now Hono/TS, not FastAPI).

## [v0.9.2] -- 2026-05-31

**v0.9.2 — CLI completion + installer polish.** Client/CLI only — no schema,
RPC, or Edge Function changes.

### Fixed

- **Shell tab-completion now completes the full resource-verb tree.** It
  previously only completed top-level commands, so `cerefox document <TAB>`,
  `cerefox document version <TAB>`, etc. offered nothing useful. The generated
  bash/zsh/fish scripts now resolve the typed subcommand path and complete
  nested verbs at any depth (including the 3-level `document version
  {list|archive|unarchive}`), plus the current command's flags. Hidden husks
  (old flat verbs) are excluded. Re-run `cerefox completion install` after
  upgrading to refresh.
- **Installer next-steps pointed at a renamed command** (`cerefox docs --list`
  → `cerefox guides list`) and the wrong upgrade guide (the v0.5-specific
  migration doc); it now links the evergreen `docs/guides/upgrading.md`.

### Changed

- **Clearer installer output on upgrade.** The shell-completion activation
  reminder (`exec $SHELL`) moved to a prominent banner at the very end instead
  of being buried under the next-steps block, and a note now reminds you to
  restart any AI agent using the local MCP server so it picks up the freshly
  installed `cerefox mcp` binary (a running agent keeps using the process it
  spawned at startup until restarted).
- **`cut_release.ts` confirmation prompt** now states the immutable-tags rule
  inline and points at CONTRIBUTING.md, instead of only naming it.

---

## [v0.9.1] -- 2026-05-30

**v0.9.1 — CLI parity + polish.** Closes CLI↔web gaps, fixes search output, and
tidies the docs commands. Client/CLI only — no schema, RPC, or Edge Function
changes. The renamed/removed commands keep working as husks that point at the
new form (removed in v1.0).

### Added

- **`cerefox document edit <id>`** — non-destructive title/metadata patch:
  `--set-meta key=value` (repeatable; value JSON-parsed when possible),
  `--unset-meta key` (repeatable), `--title`. Preserves metadata keys you don't
  touch (unlike `document ingest --update`, which replaces the whole object). A
  `--title` change refreshes the FTS index; semantic embeddings update on the
  next `cerefox server reindex`.
- **`cerefox project create <name>`** and **`cerefox project edit <name-or-id>`**
  — explicit project create/rename/describe (parity with the web UI / API).
- **`cerefox config list`** — list the runtime `cerefox_config` keys (not values).
- **`cerefox completion install [--shell] [--yes]`** — write the completion
  script + add an idempotent, sentinel-marked source line to your shell rc.
  `install.sh` now runs it on install/upgrade so completion stays current.
  Raw `cerefox completion <shell>` (print the script) still works.
- **`cerefox search --only-metadata`** — list matching docs (id, score, chunks,
  chars, partial/full) without their content — the web UI's collapsed result
  view; pair with `cerefox document get <id>`.

### Changed

- **Versions are now under `document`**: `cerefox document version
  {list|archive|unarchive}` (was a top-level `version` group). The v0.8
  `list-versions` husk points at `document version list`.
- **Bundled docs are now `cerefox guides`**: `guides {list|open|show}` (renamed
  from `docs`, to disambiguate from the `document` resource) plus **`guides
  ingest`** (was `sync-self-docs`). `cerefox sync-docs` is **removed from the
  CLI** (it synced a local repo clone — a contributor op; use `bun
  scripts/sync_docs.ts` from a clone).
- **`cerefox search` output**: every result now shows
  `score · N chunks · M chars · partial|full` plus a `best match: <breadcrumb> ·
  updated <date>` line (web parity). The previous header mislabeled the chunk
  count as chars and omitted counts for full-document results. Inter-result
  separator changed from `---` (collides with markdown content) to a
  distinctive rule. Use `--json` for robust parsing.
- **Documentation refreshed end-to-end.** First sweep since the TypeScript
  migration + installer landed: README simplified into two clear paths
  (use-it-via-npm vs. hack-on-it-from-source), every guide updated to the
  installer + resource-verb CLI, manual per-client agent config moved to an
  appendix in `connect-agents.md` (`cerefox configure-agent` now leads), Python
  marked legacy throughout, and stale pre-migration instructions (pytest,
  PDF/DOCX ingest, `uv run cerefox` for non-MCP commands) removed.

### Fixed

- **`scripts/cut_release.ts` confirms before any mutation.** It used to bump +
  commit + tag and only then prompt; declining left a local commit + tag that
  blocked re-running. Declining now leaves the working tree pristine.

### Internal

- **Live write-command round-trips folded into the test suite**
  (`packages/memory/test/write-commands.test.ts`): project create→edit→delete,
  duplicate-name rejection, `document edit` non-destructive metadata patch, and
  `document delete`→`restore`. Probe-and-skip when no Supabase is reachable;
  self-cleaning `[E2E]`-prefixed fixtures.

---

## [v0.9.0] -- 2026-05-30

**v0.9.0 — "CLI verb redesign + Python surface retirement".** The
contract-hardening release before v1.0. Client/CLI only — no data, schema, or
Edge Function changes. See [`docs/guides/migration-v0.9.md`](docs/guides/migration-v0.9.md).

> **⚠ CLI verbs renamed.** The flat verbs moved under resource groups
> (`cerefox get-doc X` → `cerefox document get X`). The old names still run but
> print the new form and exit non-zero; they are **removed in v1.0**. Update
> scripts/aliases and re-run `cerefox completion <shell>`.

### Added

- **`cerefox document restore <id>`** — un-soft-delete a document from the
  trash (inverse of `document delete`; wraps `cerefox_restore_document`).
- **`cerefox version archive <version-id>` / `version unarchive <version-id>`**
  — protect a version from the cleanup sweep (or release it), with an audit
  entry. Mirrors the web UI's version-archive action.

  (Folded forward from the v0.9.1 plan — both are thin wrappers over existing
  server operations. `document edit` + `audit tail/search` remain in v0.9.1;
  see below.)

### Changed

- **CLI is now resource-verb** (`cerefox <resource> <verb>`). Rename-only for
  the *existing* surface — no behavior or flags changed. Groups: `document`
  (get/list/delete/restore/ingest/ingest-dir), `project` (list/delete),
  `version` (list/archive/unarchive), `metadata` (keys/search), `audit`
  (list), `config` (get/set), `backup` (create/restore), `server`
  (deploy/reindex). `search` + lifecycle commands stay flat. Full old→new
  table in the migration guide.

### Removed / deprecated

- **Old flat verbs are hidden husks** that exit non-zero with a pointer to the
  new form (removed entirely in v1.0).
- **Python CLI retired to husks** — every `uv run cerefox <cmd>` except `mcp`
  now redirects to the TypeScript CLI. The `CEREFOX_NO_DEPRECATION_BANNER`
  opt-out is gone.
- **Python web app removed** — `cerefox.api.app` is a husk; use the TypeScript
  `cerefox web`. FastAPI/uvicorn dropped from `pyproject.toml`.
- **`pytest` retired as a test runner** — `tests/**/*.py` deleted; the suite is
  `bun test`. `pyproject.toml`/`uv.lock`/`.python-version` stay (the Python MCP
  runtime remains).

### Kept

- **`uv run cerefox mcp`** still launches the in-tree Python MCP server — a
  frozen, unmaintained, offline / no-npm repo-clone fallback through v1.x.

### Deferred to v0.9.1

- **`document edit`** — content edits already work via `cerefox document ingest
  --document-id <id> --update`; a dedicated `edit` adds title/metadata-only
  editing, which has a title-boosting re-embed nuance worth a small design pass
  before it joins the v1.0 contract.
- **`audit tail` / `audit search`** — `audit list` already covers filtering
  (`--author/--operation/--since/--until`) and recency (`--limit`); these would
  be redundant surface. Revisit only if a real follow/streaming need appears.

---

## [v0.8.3] -- 2026-05-29

### Fixed

- The one-line install script now pins the `latest` dist-tag instead of
  installing `@cerefox/memory` unversioned. A bare `bun install -g
  @cerefox/memory` treats an already-installed global as satisfied and skips
  the upgrade, so re-running the installer kept the old version; `@latest`
  forces bun/npm to re-resolve and upgrade. (Served from each GitHub release,
  so this takes effect for installs of the release *after* it ships.)

### Changed

- **Live Edge Function / remote-MCP test suites are now opt-in.** The TS suites
  in `packages/memory/test/edge-functions/` and `.../mcp-remote/` make real
  Edge Function calls; they're gated behind `CEREFOX_LIVE_E2E=1` (checked
  before the reachability probe), so a default `bun test` makes zero EF calls
  and doesn't consume free-tier quota. The suites also tag their calls with
  `requestor: "e2e-test"` so usage-log rows are attributable instead of
  appearing as "Unknown" in the Analytics view.

### Docs

- `setup-supabase.md`: noted that `WARNING: Docker is not running` during Edge
  Function deploy is expected and harmless (the CLI bundles server-side);
  Docker is not a prerequisite.

---

## [v0.8.2] -- 2026-05-29

### Fixed

- **`cerefox deploy-server` Edge Function deploy now works without a
  per-directory `supabase link`.** Two bugs: (1) the pre-flight detected
  linkage by looking for `supabase/config.toml` (the `supabase init` marker),
  so a correctly-linked project with no `config.toml` was reported as "not
  linked"; (2) the actual `supabase functions deploy` ran from the
  bundled-assets directory, which has no link state, so it couldn't resolve the
  target project even when the pre-flight passed. Now the project ref is derived
  from `CEREFOX_SUPABASE_URL` (override with `--project-ref <ref>`) and passed
  explicitly to `supabase functions deploy`, making the deploy
  directory-independent. The pre-flight checks that a ref is resolvable instead
  of looking for `config.toml`; `supabase login` (a global token) is all that's
  required.
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
