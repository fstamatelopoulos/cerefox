# Upgrading Cerefox

Upgrading is almost always two steps: **update the CLI, then re-deploy the
server side if the release changed it.** Everything here is idempotent and safe
to re-run.

## Pick your path

| You installed via | Upgrade with |
|---|---|
| **Installer / npm** (end user, no repo clone) | `cerefox self-update` (or re-run the [installer](quickstart.md#1-install), or `bun/npm update -g @cerefox/memory`). Then `cerefox server deploy` **if the release notes flag a server-side change**. `cerefox doctor` verifies. |
| **Source checkout** (`git clone`, contributor) | `git pull`, then `cerefox server deploy` (or the lower-level `bun scripts/db_*.ts` + `npx supabase functions deploy`). Rebuild the SPA if you run `cerefox web` from source. |
| **Local / self-hosted (Docker, World B)** | `cerefox-local upgrade` — pulls the new image and recreates the container (data persists in the volume; OpenAI key + tuning overrides preserved). **No separate `server deploy`/`reindex`**: the CLI, web, PostgREST, and schema all ship together in one versioned image, so they can't drift. See [`setup-local.md`](setup-local.md). |

> **On an old pre-installer clone (0.1.x)?** The cleanest upgrade is to stop
> running from the repo and install the package: follow the
> [quickstart](quickstart.md), then run `cerefox init` — it offers to copy your
> repo `.env` to `~/.cerefox/.env`, deploy the server, and wire up your agent.
> After that you're on the end-user path below.

## End-user upgrade

```bash
cerefox self-update      # or: re-run the installer, or bun/npm update -g @cerefox/memory
cerefox server deploy    # applies pending migrations, re-applies RPCs, redeploys the 9 Edge Functions
cerefox doctor           # verify
```

`cerefox server deploy` is the catch-all for the server side. On an existing
database it applies **every** pending migration (regardless of which version
you're coming from — so there are no per-version steps to follow), re-applies
`rpcs.sql`, and redeploys all nine Edge Functions from npm-bundled assets. No
repo clone required.

**Re-embed only when a release says so.** If a release changes the embedding
model or FTS / title weighting, also run `cerefox server reindex --all` — that's
the one thing `server deploy` doesn't cover, and the release notes will call it
out. `cerefox doctor` flags schema / Edge-Function version drift if a redeploy
is needed.

## Contributor upgrade (source checkout)

```bash
git pull origin main
cerefox server deploy                                   # = migrate + re-apply RPCs + deploy EFs, in one
cd frontend && bun install && bun run build && cd ..    # only if you run `cerefox web` from source
bun test                                                # optional
```

Lower-level equivalents, if you prefer them: `bun scripts/db_migrate.ts` (apply
migrations) + `bun scripts/db_deploy.ts` (re-apply RPCs) + `npx supabase
functions deploy <fn>`. These need `CEREFOX_DATABASE_URL` (direct Postgres) and
a linked Supabase project.

> Python is legacy: the Python CLI and FastAPI web app are husks; only
> `uv run cerefox mcp` survives as a frozen, unmaintained fallback. Tests run
> via `bun test` (pytest is retired).

## Notable cross-version transitions

Most upgrades need nothing beyond the steps above. Two transitions are worth
knowing about:

- **v0.9 — CLI verbs moved to a resource-verb shape** (`cerefox document get`,
  `cerefox project list`, …). The old flat verbs (`get-doc`, `list-docs`,
  `deploy-server`, `docs`, …) still run but print the new form and exit
  non-zero — so any scripts or aliases tell you exactly what to change. Re-run
  `cerefox completion install` to refresh tab-completion. The Python CLI + web
  app became husks at v0.9; `uv run cerefox mcp` is the only surviving Python
  path.
- **v0.4–v0.5 — the runtime moved Python → TypeScript** and became the
  `@cerefox/memory` npm package (CLI, MCP server, web server, ingestion). If
  you're coming from a pre-installer 0.1.x clone, see the "old pre-installer
  clone" note above: install the package and run `cerefox init`.

## After upgrading: AI agents

New tools and updated tool signatures are picked up by MCP clients in **new
sessions** started after the upgrade — an open session caches the tool schema at
startup and won't see changes until you start a fresh conversation. The remote
MCP path needs no reconfiguration; for the local stdio server, restart the
client. `cerefox configure-agent --tool <client>` (re)writes a client's config
if you need it.

**ChatGPT Custom GPT (GPT Actions):** after an upgrade, check the OpenAPI schema
version in [`connect-agents.md`](connect-agents.md); if it changed, paste the new
schema into the Custom GPT editor and **re-enter your Supabase legacy anon JWT**
as the Bearer token. (The editor clears the key on every schema save, and the
new `sb_publishable_…` key doesn't work for GPT Actions — see
[`setup-supabase.md`](setup-supabase.md#supabase-api-keys-2026).)
