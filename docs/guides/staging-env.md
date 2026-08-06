# Running a staging environment alongside production

Cerefox can talk to more than one backend from a single machine. This guide sets
up a **staging** environment — a second Supabase project you can deploy
pre-release builds to, import production data into, and break freely — while
production stays untouched.

> **Nothing here affects a normal single-environment install.** Every mechanism
> below is opt-in and inert unless you set `CEREFOX_CONFIG_DIR`. If you never
> want staging, you can stop reading; `cerefox …` behaves exactly as documented
> in [`setup-supabase.md`](setup-supabase.md).

**Status**: the environment split (config, database, backups) is **validated**.
Running two *different Cerefox versions* in parallel has **known gaps** — see
[Known limits](#known-limits) before relying on it.

---

## Why bother

Two things are hard to test safely against production:

- **Upgrades.** A release that changes the schema will run its migrations
  against your real data exactly once. Staging lets you rehearse that on a copy.
- **Destructive or expensive operations.** `server migrate-format` re-embeds
  every legacy document (real spend, rewrites chunks). Proving it on a copy
  first turns an act of faith into a measurement.

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
CEREFOX_BACKUP_DIR=~/.cerefox/staging/backups

OPENAI_API_KEY=sk-…
SUPABASE_ACCESS_TOKEN=sbp_…                       # account-level; same as prod
```

**Mirror production's tuning** (`CEREFOX_MIN_SEARCH_SCORE`,
`CEREFOX_MAX_CHUNK_CHARS`, `CEREFOX_MIN_CHUNK_CHARS`, `CEREFOX_EMBEDDER`, …).
A staging result only means something if the knobs match; different chunk sizes
make every comparison noise. **Do not** copy credentials — staging has its own.

Add an alias so you never type the prefix:

```bash
alias cfx-stg='CEREFOX_CONFIG_DIR=~/.cerefox/staging cerefox'
```

---

## 3. Deploy and verify

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

---

## 4. Populate from a production snapshot

```bash
cerefox backup create                       # production
cfx-stg backup restore ~/.cerefox/backups/<snapshot>.json
```

Backups carry documents, chunks, projects, memberships and (from v1.1.0)
relations and lifecycle status. Restore is idempotent, so a re-run is safe.

Restoring an **older** snapshot into a **newer** schema works — new columns take
their defaults. The reverse is not supported.

---

## Known limits

**Two environments, one CLI version.** `CEREFOX_CONFIG_DIR` switches the
*database*, not the *code*. The `cerefox` on your PATH is a single global npm
install, so today both environments run the same version. To point staging at a
pre-release build without disturbing production, install it under its own
prefix and bind both axes in the alias:

```bash
npm install -g --prefix ~/.cerefox/staging/cli @cerefox/memory@beta
alias cfx-stg='CEREFOX_CONFIG_DIR=~/.cerefox/staging ~/.cerefox/staging/cli/bin/cerefox'
```

The following still collide across environments and are being worked on:

| Area | Problem |
|---|---|
| **Web daemon** | `web start` writes its PID and log to `~/.cerefox/web.{pid,log}` regardless of `CEREFOX_CONFIG_DIR`, so a staging daemon overwrites production's bookkeeping. Until that is fixed, run staging's server in the **foreground** on a different port (`cfx-stg web --port 8010`) rather than as a daemon. |
| **Agent (MCP) config** | `configure-agent` registers the MCP server under the fixed name `cerefox`, so running it from staging **overwrites your production agent wiring**. Don't run it against staging yet. |
| **`doctor`'s `mcp clients` line** | It inspects your global agent configs, which point at production, and reports them even in staging mode. Informative, but easy to misread as "staging is wired to my agents". |

---

## Housekeeping

Pause the staging project in the Supabase dashboard between test rounds — a
paused project keeps its data without consuming free-tier compute. Check your
plan's limit on simultaneously active projects before creating the second one.
