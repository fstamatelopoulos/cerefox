# Iteration 40 — API attribution and environment honesty (v1.11.0)

**Status: IN PROGRESS** (opened 2026-09-01). Branch:
`feat/v1.11.0-api-attribution`. Target: **v1.11.0**. No schema change
expected (see "No schema change" below).

Closes [#225](https://github.com/fstamatelopoulos/cerefox/issues/225),
[#226](https://github.com/fstamatelopoulos/cerefox/issues/226),
[#227](https://github.com/fstamatelopoulos/cerefox/issues/227).

## Why

`/api/v1` was built as the web app's private backend and hardcodes its own
identity: `author: "web-ui"` at 17 call sites, `access_path: "webapp"`
unconditionally in `logWebUsage()`. Any other client of that API is therefore
unattributable, which pushes agent harnesses onto the MCP surface purely to
obtain an identity, even where the HTTP API would serve them better. #226
reports exactly that: a harness reading over the API and writing over MCP,
split for no reason other than this gap.

Two smaller items ride along because they are the same subject (who and where
an operation came from) and because they are cheap once the code is open:
`doctor` misreporting which config file is in effect (#225), and the repo-root
compose file contradicting the shipped installers on network exposure (#227).

## Design decisions

Confirmed with the maintainer 2026-09-01 before implementation.

- **Optional parameters, defaults unchanged.** `author`, `requestor` and
  `author_type` are accepted and optional everywhere. Omitted, the routes
  behave exactly as today: `author: "web-ui"`, `author_type: "user"`,
  `access_path: "webapp"`. The bundled web app is not modified and no
  existing client observes a difference. This is the whole design constraint,
  not a nicety.

- **`access_path` is derived, never accepted.** A caller-settable
  `access_path` would let a client lie about *where* as well as *who*, and
  *where* is the only field in the usage log currently worth trusting because
  the server sets it per transport. Rule: **if any caller identity is
  supplied, `access_path` is `"api"`; otherwise `"webapp"`.**

  This is an approximation and is recorded as one. It reads "named itself" as
  the signal that the caller is not the bundled web app. The known edge: if
  the web app ever passes a real `requestor` (multi-user, SSO), it would begin
  labelling itself `"api"`. Acceptable now, since it passes nothing, and
  commented at the derivation site so a future reader does not have to
  rediscover the coupling.

- **`"api"` becomes a first-class access path.** `AccessPath` in
  `_shared/mcp-tools/types.ts` is the guard for this domain (the DB column is
  free text, no CHECK, verified). Adding the value there, in the type's doc
  comment, and in `CLAUDE.md`'s usage-tracking paragraph is what makes it
  documented rather than incidental.

- **The dashboard must learn `"api"` explicitly.**
  `deriveAccessPathStats()` resolves each path by exact name and deliberately
  refuses to sweep unknown values into `agentOps` ("a future transport should
  appear deliberately, not by silently inflating this number"), with a test
  pinning that refusal. Left alone, API-attributed operations would be
  written, charted in Analytics, and invisible in the Dashboard agent tile.
  This is the failure this iteration is most likely to ship by accident.

- **No `/api/v2`.** These are additive optional parameters that reproduce
  current behaviour byte for byte when omitted, which is what a stable v1
  absorbs. A v2 would mean two route trees, two test suites, and a permanent
  question about which the bundled app targets. The version bump stays
  available for a change that genuinely breaks callers.

- **Attribution is not authentication, and that is not this iteration's
  problem to solve.** No Cerefox transport verifies an identity claim: MCP
  takes `author` as a client-declared string, the Edge Functions accept
  whatever `requestor` arrives. This change extends an existing convention to
  one more surface. It introduces no new trust assumption, and withholding it
  would not make identity trustworthy anywhere else. That `/api/v1` has no
  authentication at all is real, separate, and belongs in its own issue.

- **`require_requestor_identity` scope: document, do not duplicate.** The
  config is enforced in each Edge Function separately (eight near-identical
  copies) and by neither the web API nor the local stdio MCP server. Adding a
  ninth copy buys little and risks breaking installs that have it enabled. The
  fix is honesty: state the transports it covers in
  `docs/guides/configuration.md` and in the config catalog description, so an
  operator who enables it is not left believing identity is required
  everywhere. If it is ever made global it goes in one shared helper that all
  transports call.

## Found during recon, folded in

**`documents-write.ts` is inconsistent with itself.** The review-status route
(`:401`) and the version-archive route (`:436`) write `author: "user"`, while
every other web write uses `"web-ui"`. `projects.ts` documents the intended
convention explicitly ("the convention every other web audit site uses, so
`author='web-ui'` catches dashboard-originated store-level writes too") and
those two routes silently break it: an `author='web-ui'` audit filter misses
every review-status change and every version archive.

Unifying them on `"web-ui"` is a **behaviour change to existing audit
authorship** for those two operations, so it is called out here rather than
slipped in. Judgement: consistency wins, because the current state makes an
audit filter quietly incomplete, which is worse than a visible change in what
two operations record. Existing rows are not rewritten.

## No schema change

`cerefox_usage_log.access_path` is `TEXT NOT NULL` with no CHECK and no enum
(`src/cerefox/db/schema.sql:415`), so `"api"` needs no migration and no
`schema_version` bump. Recorded explicitly because the reflex on this project
is to bump, and the gate in `cut_release.ts` only fires when `db/` changes.
If a step below ends up touching `src/cerefox/db/`, both literals get bumped
in lockstep and this section is wrong.

## Steps

- [ ] **#225** — `checkLegacyShadowEnv()` resolves the active env file through
      `resolveEnvFile()` instead of assuming `~/.cerefox/.env`, and gates on
      the same "has a `CEREFOX_*` key" heuristic `resolveConfigDir()` uses, so
      it stops calling an unrelated project's `.env` safe to delete. Tests
      drive the resolver, never a hardcoded path.
- [ ] **#226 core** — a single shared helper resolves caller identity and the
      derived access path from a request, used by every `/api/v1` route that
      writes or logs. One implementation, not 17 edits.
- [ ] **#226 routes** — ingest, document write, projects, config routes accept
      the optional parameters; `logWebUsage()` accepts requestor and access
      path.
- [ ] **#226 domain** — `AccessPath` gains `"api"`; `deriveAccessPathStats()`
      and its test learn it; `CLAUDE.md` usage-tracking paragraph updated.
- [ ] **Audit authorship unification** — the two `author: "user"` routes move
      to the shared resolver.
- [ ] **#227** — repo-root `docker-compose.yml` binds published ports to
      loopback, matching `docker/local/compose.yml` and the installer.
- [ ] **Tests** — unit tests for the resolver and the deriver; HTTP-boundary
      tests under `web-integration/` covering omitted-parameter parity and
      supplied-parameter attribution.
- [ ] **Docs** — `/api/v1` reference guide; `configuration.md` enforcement
      scope; CHANGELOG.
- [ ] **Live regression** — staging first, then a throwaway local Docker
      instance. The maintainer's own Cerefox Local is in use by another agent
      and is not to be touched.

## Verification plan

- `bun test` in `_shared/` and `packages/memory/` (built bin).
- HTTP-boundary tests against staging (`CEREFOX_CONFIG_DIR=~/.cerefox/staging`),
  which is where the write-bearing suites are allowed to run.
- A second, throwaway Cerefox Local container on a non-default port, to
  exercise the API path the reporting harness actually uses. The maintainer's
  running instance is off limits.
- The parity assertion that matters: with no parameters supplied, audit and
  usage rows are identical to those the current code writes. Recorded as a
  baseline and compared, rather than eyeballed.
