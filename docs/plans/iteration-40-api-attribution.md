# Iteration 40 — API attribution and environment honesty (v1.11.0)

**Status: IMPLEMENTATION COMPLETE, awaiting review + release** (opened 2026-09-01). Branch:
`feat/v1.11.0-api-attribution`. Target: **v1.11.0**. No schema change (confirmed, see below).

Closes [#225](https://github.com/fstamatelopoulos/cerefox/issues/225),
[#226](https://github.com/fstamatelopoulos/cerefox/issues/226),
[#227](https://github.com/fstamatelopoulos/cerefox/issues/227), and
[#228](https://github.com/fstamatelopoulos/cerefox/issues/228) (filed in
flight — see "Found in flight" below).

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

- [x] **#225** — `checkLegacyShadowEnv()` resolves the active env file through
      `resolveEnvFile()` and gates on the shared `CEREFOX_*`-key predicate.
      Both guards proven to fire independently by regressing each alone.
- [x] **#226 core** — `packages/memory/src/web/identity.ts`: one resolver, used
      by every route that writes or logs. Headers first, body honoured, derived
      access path, `author_type` validated at the boundary (the DB CHECK would
      otherwise surface as a 500 for a caller mistake).
- [x] **#226 routes** — ingest (3), document write (6), projects (3), config,
      and the two reads that log usage. No route carries a default any more.
- [x] **#226 domain** — the vocabulary moved to a dependency-free leaf
      (`_shared/mcp-tools/access-paths.ts`); `AccessPath` derives from it, the
      Analytics filter derives from it through a vite alias, and its label map
      is keyed by the union so an unlabelled path fails the typecheck.
      `deriveAccessPathStats()` and the Dashboard learn `api` explicitly.
- [x] **Audit authorship unification** — the two `author: "user"` routes.
- [x] **#227** — repo-root `docker-compose.yml` publishes to loopback.
- [x] **#228 (found in flight)** — `POST /documents/{id}/upload` broken since
      v0.11.0. Takes the SAME contract as every other content update: the hash,
      or an explicit `last_write_wins=true`. No implicit default — the endpoint
      has been a hard error for eleven releases, so there is no working caller
      to preserve and the strict semantics cost nothing.
- [x] **Delete follows a read on the API too.** `DELETE /documents/{id}`
      requires the hash from an identified caller, matching what
      `cerefox_delete_document` enforces over MCP. Anonymous callers (the
      bundled UI, which confirms in a dialog) are unaffected.
- [x] **Tests** — resolver unit tests (20), deriver tests (+3), HTTP-boundary
      attribution tests (5) covering omitted-parameter parity against the
      stored row.
- [x] **Docs** — `docs/guides/api.md` (new), `configuration.md` enforcement
      scope, config-catalog description, `access-paths.md` + README + CLAUDE.md
      cross-links, CHANGELOG.
- [x] **Live regression** — staging 215 pass / 0 fail; a throwaway Cerefox
      Local container on 18040, destroyed afterwards.

## Found in flight

Three things this iteration did not set out to fix, recorded because each was
invisible until the code was opened.

**The web-integration suite had been skipping since v0.9.0.** `probeSupabase()`
shelled out to `cerefox list-projects`; v0.9.0 renamed that verb and left a
husk that exits non-zero by design. The probe read that as "backend
unreachable". Eleven releases, green throughout, running nothing — and the
reason #228 survived. The fix is one probe that **throws** when the CLI rejects
the probe command, because a probe that cannot tell "the backend is down" from
"that command no longer exists" is not a probe.

**Turning the suite on turned its billing on.** `destructive.test.ts` built its
fixture through the deployed `cerefox-ingest` Edge Function, a v0.6 workaround
from when `/api/v1/ingest` was a 503 stub. That suite is not one of the two
`CEREFOX_LIVE_E2E` suites permitted to spend free-tier quota. It now ingests
over HTTP, and the dead helper is deleted rather than left for reuse.

**Live suites skip in a full run (#230, filed, not fixed here).**
`ingest.test.ts` passes when its directory is run and skips under the
documented full `bun test`, because `LIVE_OK` is frozen at module load and
`live-write-guard-coverage.test.ts` blanks `CEREFOX_CONFIG_DIR` mid-run to
exercise the guard. Same shape as the renamed-probe bug — a suite reporting
success while running nothing — with ordering as the trigger instead of a stale
verb. Filed rather than fixed because the durable answer is to evaluate
`LIVE_OK` lazily across every live suite, which is its own change.

**A local `bun run typecheck` never checked the frontend.** `tsc --noEmit`
there checks nothing, because `tsconfig.json` is `files: []` plus references.
CI builds the frontend and was unaffected, but the local script that people
actually run was blind to the whole SPA. This is the same shape as the two
incidents `CLAUDE.md` already records under "tests and CI are only as honest as
their coverage", which is why it is written down rather than quietly fixed.

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
