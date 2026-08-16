# Running a staging environment alongside production

Cerefox can talk to more than one backend from a single machine. This guide sets
up a **staging** environment — a second Supabase project you can deploy
pre-release builds to, import production data into, and break freely — while
production stays untouched.

> **Nothing here affects a normal single-environment install.** Every mechanism
> below is opt-in and inert unless you set `CEREFOX_CONFIG_DIR`. If you never
> want staging, you can stop reading; `cerefox …` behaves exactly as documented
> in [`setup-supabase.md`](setup-supabase.md).

**Status**: validated end to end — config, database, backups, CLI version, and
the web server all separate cleanly. One gap remains (agent/MCP wiring); see
[Known limits](#known-limits).

This is a **convention, not a feature**. There is no `--env` flag and no profile
system to learn: two environment variables and a shell alias do the whole job,
which is why none of it can destabilise a normal single-environment install.

---

## Why bother

Three things, and the third turned out to matter most:

- **Upgrades.** A release that changes the schema will run its migrations
  against your real data exactly once. Staging lets you rehearse that on a copy.
- **Destructive or expensive operations.** `server migrate-format` re-embeds
  every legacy document (real spend, rewrites chunks). Proving it on a copy
  first turns an act of faith into a measurement.
- **Development.** A store you are willing to break is the cheapest way to turn
  a claim about runtime behaviour into a measurement. During the 1.1.0 cycle this
  found a retry loop executing 68,825 times per request, a `migrate-format` that
  reported success while converting nothing, and a `backup create` that failed
  against older servers — none visible from the code or the test suite. Keep it
  available during development stretches, not only around releases.

---

## 1. Create the staging Supabase project

Follow [`setup-supabase.md` Step 1](setup-supabase.md), with two differences:

- Name it distinctly (`cerefox-staging`) — the dashboard project switcher is
  your first defense against acting on the wrong database.
- Pick the **same region as production** if you care about comparable timings.
  A different region is fine functionally; just never compare *speed* across
  the two.

The creation-time security options are the same as production, and the
"automatically expose new tables" setting is worth disabling on both — Cerefox
grants its tables to `service_role` explicitly.

---

## 2. Give staging its own config directory

`CEREFOX_CONFIG_DIR` overrides where Cerefox reads `.env`. Production lives at
`~/.cerefox/.env` and is never consulted when the override is set.

```bash
mkdir -p ~/.cerefox/staging && chmod 700 ~/.cerefox/staging
```

Then either run the interactive setup against it:

```bash
CEREFOX_CONFIG_DIR=~/.cerefox/staging cerefox init
```

…or write `~/.cerefox/staging/.env` (mode 0600) directly:

```bash
CEREFOX_ENV_LABEL=staging
CEREFOX_SUPABASE_URL=https://<staging-ref>.supabase.co
CEREFOX_SUPABASE_KEY=sb_secret_…                 # staging project's secret key
CEREFOX_DATABASE_URL=postgresql://postgres.<staging-ref>:…@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require

# Isolate snapshots. CEREFOX_BACKUP_DIR does NOT follow the config dir, so
# without this line staging backups land beside production's.
# Use an ABSOLUTE path: a relative value resolves against the working
# directory, so snapshots scatter wherever you happen to run the command.
CEREFOX_BACKUP_DIR=~/.cerefox/staging/backups

OPENAI_API_KEY=sk-…
SUPABASE_ACCESS_TOKEN=sbp_…                       # account-level; same as prod
```

> **Snapshot isolation needs v1.1.0-beta.3 or later.** On **beta.2 and
> earlier**, `backup create` read `CEREFOX_BACKUP_DIR` *before* loading the
> `.env` file, so the setting above was silently ignored and staging snapshots
> landed in production's directory. Until staging is on a build with the fix,
> pass the destination explicitly: `cfx-stg backup create --output-dir
> ~/.cerefox/staging/backups`.

**Mirror production's tuning.** Chunking and embedder settings still live in
`.env` (`CEREFOX_MAX_CHUNK_CHARS`, `CEREFOX_MIN_CHUNK_CHARS`, `CEREFOX_EMBEDDER`);
retrieval and retention moved into the database in v1.1.0, so mirror those with
`cerefox config set` against staging (or the Settings page).
A staging result only means something if the knobs match; different chunk sizes
make every comparison noise. **Do not** copy credentials — staging has its own.

---

## 3. Pin a Cerefox version for staging

`CEREFOX_CONFIG_DIR` switches the *database*, not the *code*. The `cerefox` on
your PATH is a single global npm install, so on its own it would point both
environments at the same version — which defeats the main purpose of staging:
rehearsing a **pre-release** build before production ever sees it.

Give staging its own install tree. npm's `--prefix` keeps it entirely separate
from the global one, so production's binary is never touched:

```bash
# Rehearsing a pre-release (the usual case):
npm install -g --prefix ~/.cerefox/staging/cli @cerefox/memory@beta

# Rehearsing a NORMAL release, where no beta was cut: pin the version
# explicitly. A bare `@cerefox/memory` resolves `latest` at install time, so
# staging silently records nothing about what it is running — and running it
# before the publish completes would install the PREVIOUS version, which is the
# one thing staging exists to avoid.
npm install -g --prefix ~/.cerefox/staging/cli @cerefox/memory@1.4.0
```

Then bind **both axes — version and environment — in a single alias**, so they
can never drift apart:

```bash
alias cfx-stg='CEREFOX_CONFIG_DIR=~/.cerefox/staging ~/.cerefox/staging/cli/bin/cerefox'
```

Put it in `~/.zshrc` (or `~/.bashrc`) and reload. From here on, `cerefox` means
production-version-on-production-data and `cfx-stg` means
staging-version-on-staging-data. There is no combination of the two that a typo
can produce.

> **The alias is the protection — scripts and agents that bypass it lose it.**
> `CEREFOX_CONFIG_DIR=~/.cerefox/staging cerefox …` (bare binary, staging
> config) recombines the axes: production *code* on staging *data*. Aliases
> don't exist in non-interactive shells, which is exactly where automation
> runs, so spell out the pinned binary path there. And remember the global
> binary is itself a production component: `cerefox self-update` replaces it
> no matter which `CEREFOX_CONFIG_DIR` is set — updating "for staging" that
> way is a production change.

Verify the split before trusting it:

```bash
cerefox --version    # production, e.g. 1.0.8
cfx-stg --version    # staging, e.g. 1.1.0-beta.2
```

To move staging to a newer pre-release later, re-run the `npm install` above;
production is unaffected. If you'd rather not keep an install tree at all,
`npx --package=@cerefox/memory@beta cerefox …` works too, but it re-resolves the
package on every call and makes the version harder to pin down when something
misbehaves.

---

## 4. Deploy and verify

```bash
cfx-stg server deploy      # fresh database → schema + RPCs + 9 Edge Functions
cfx-stg doctor
```

`doctor` should report the staging config path and URL. Two lines are expected
on a fresh project:

- `ℹ edge functions … No CEREFOX_ACCESS_TOKEN set` — staging has no Cerefox
  access token yet. Run `cfx-stg token generate` if you plan to test the Edge
  Function / remote-MCP path there.
- `✓ content format  no documents yet` — nothing imported.

**Checking database/schema state.** There is no `cerefox db status` command.
Use one of:

| Want | Command |
|---|---|
| Deployed schema version, reachability, drift banner | `cfx-stg doctor` |
| What a deploy *would* do, without doing it | `cfx-stg server deploy --dry-run` |
| Per-migration applied/pending list | `bun scripts/db_migrate.ts --status` (repo clone; contributor-only) |

`doctor` is the one to reach for; the migration list is only interesting when a
deploy behaved unexpectedly.

> **Contributor scripts and a repo `.env`.** The `bun scripts/*.ts` tools honour
> `CEREFOX_CONFIG_DIR` — but only from the version that fixed this. Bun
> auto-loads `.env` from the working directory, so on **v1.1.0-beta.1 and
> earlier** a repo clone with its own `.env` silently outranked the config dir:
> `CEREFOX_CONFIG_DIR=…/staging bun scripts/db_migrate.ts --status` reported
> *production*. If you're on an older build, run those scripts from a directory
> with no `.env`, and confirm the target before trusting the output.

---

## 5. Populate from a production snapshot

```bash
cerefox backup create                       # production
cfx-stg backup restore ~/.cerefox/backups/<snapshot>.json
```

Backups carry documents, chunks, projects, memberships and (from v1.1.0)
relations and lifecycle status. Restore is idempotent — re-running it is safe
and converges on the same state rather than duplicating anything.

Restoring an **older** snapshot into a **newer** schema works — new columns take
their defaults. The reverse is not supported.

Two count details that look like bugs and are not:

- **Trashed documents are not carried over.** `backup create` captures live
  documents only (`deleted_at IS NULL`), so anything in production's trash is
  absent from staging. Nothing in the trash is lost *in production* — it just
  isn't part of the snapshot.
- **A membership shortfall on pre-v1.1.0 snapshots.** Older `backup create`
  captured the document↔project junction unfiltered, including rows belonging
  to trashed documents. Restore drops those (their document isn't in the file),
  so the summary reports fewer memberships than the header claims — 362 of 369
  on the maintainer's store. From v1.1.0 the capture filters them out, and the
  two numbers agree.

---

## 6. Run both web servers at once

The daemon's pidfile and log follow `CEREFOX_CONFIG_DIR`, so staging writes to
`~/.cerefox/staging/web.{pid,log}` and production to `~/.cerefox/web.{pid,log}`.
Each `web stop` / `web status` acts only on its own environment.

> **Requires v1.1.0-beta.2 or later.** On **beta.1 and earlier** both
> environments shared `~/.cerefox/web.pid`, so `cfx-stg web start` refuses with
> *"A Cerefox web daemon is already running on :8000"* — it is reading
> production's pidfile. Until staging is on a build with the fix, start it in
> the **foreground** instead, which never touches the pidfile:
>
> ```bash
> cfx-stg web --port 8030      # no `start` subcommand; Ctrl-C to stop
> ```

Pick a different port for staging so the two can run simultaneously:

```bash
cfx-stg web start --port 8010
cfx-stg web status      # staging only
cerefox web status      # production only — unaffected
```

Set `CEREFOX_ENV_LABEL=staging` in the staging `.env` (Step 2) and the
environment names itself everywhere it matters — two tabs that look identical
otherwise:

| Surface | With the label set |
|---|---|
| Web UI | A banner on every page: *"STAGING environment — not production."* |
| `doctor` | Title line reads `Cerefox doctor [STAGING]` |
| `backup create` | Filename becomes `cerefox-staging-<stamp>.json`, and the label is stored in the payload |
| `backup restore` | Warns when the snapshot's environment differs from the target's |

The filename and restore warning matter because `CEREFOX_BACKUP_DIR` does not
follow `CEREFOX_CONFIG_DIR`: staging and production snapshots can end up in one
directory, and a restore that picks "the most recent file" there would
otherwise seed production from staging without saying so.

**Requires v1.1.0-beta.3 or later** — on earlier builds `CEREFOX_ENV_LABEL` is
read but nothing acts on it.

---

## Known limits

| Area | Problem |
|---|---|
| **Agent (MCP) config** | Safe since v1.4.0 ([#168](https://github.com/fstamatelopoulos/cerefox/issues/168)). `configure-agent` names the server after `CEREFOX_ENV_LABEL`, so a staging environment registers as **`cerefox-staging`** alongside your production `cerefox` entry rather than replacing it, and an agent can hold both. The labelled entry also carries its own `CEREFOX_CONFIG_DIR` and `CEREFOX_ENV_LABEL` in the config it writes — without that the client would spawn the server with *its own* environment (a GUI client launched from the dock has none), `CEREFOX_CONFIG_DIR` would be absent, and an entry named `cerefox-staging` would quietly serve production. Before v1.4.0 it registered every environment as `cerefox` and running it from staging silently repointed all your agents. |
| **`doctor`'s `mcp clients` line** | It inspects your global agent configs, which point at production, and reports them even in staging mode. Informative, but easy to misread as "staging is wired to my agents". |
| **`doctor` remediation commands** | Environment-aware since v1.8.0: in a staging environment the remediations tell you to prefix `CEREFOX_CONFIG_DIR` (or use the alias). Before that, a staging `doctor` printed bare `cerefox …` remediations that act on production. |

Everything else — config, database, backups, CLI version, web daemon — is
separated and validated.

### What is *not* isolated, by design

Two things are shared on purpose, and both are safe:

- **`SUPABASE_ACCESS_TOKEN`** is an account-level credential, not a
  project-level one. The same value belongs in both `.env` files; the project
  it acts on comes from the URL and database URL beside it.
- **Your OpenAI key.** Staging embeds against the same account, so staging
  ingestion and `migrate-format` rehearsals cost real money. That is the point —
  it is how you measure the spend before committing production to it.

---

## Housekeeping

Pause the staging project in the Supabase dashboard between test rounds — a
paused project keeps its data without consuming free-tier compute. Check your
plan's limit on simultaneously active projects before creating the second one.

## Pause it when you are not using it

A Supabase project on the free tier costs nothing while paused, and leaving a
staging environment running between bursts of work is pure waste. Pause it from
the Supabase dashboard when you finish, and unpause it when you start.

Two things follow from that:

- **Give it a minute after unpausing.** The first queries against a
  just-resumed project are slow while the instance wakes.
- **A paused project does not announce itself.** Commands hang or fail with
  connection and timeout errors, and `cerefox doctor` reports the Data API as
  unreachable. That looks identical to a broken deployment or a bad credential.
  Check whether the project is paused before diagnosing anything else.

## Running the test suites against staging

The package suite's live tests write real documents. They resolve credentials
exactly as the CLI does, so a bare `bun test` on a maintainer's machine targets
**production** — which is how a run once left ~79 audit-log entries there. Since
v1.4.0 those suites **skip unless the target carries `CEREFOX_ENV_LABEL`**, so
point them at staging explicitly:

```bash
CEREFOX_CONFIG_DIR=~/.cerefox/staging bun test
```

`CEREFOX_ALLOW_PROD_WRITE_TESTS=1` overrides the guard, for the rare case where
production really is the intended target. Pointing every *command* at staging is
not enough: the test runner is a separate process with its own resolution.
