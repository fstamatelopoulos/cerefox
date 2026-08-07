# Upgrading Cerefox

Upgrading is almost always two steps: **update the CLI, then re-deploy the
server side if the release changed it.** Everything here is idempotent and safe
to re-run.

## Pick your path

| You installed via | Upgrade with |
|---|---|
| **Installer / npm** (end user, no repo clone) | `cerefox self-update` (or re-run the [installer](quickstart.md#1-install), or `bun/npm update -g @cerefox/memory`). Then `cerefox server deploy` **if the release notes flag a server-side change**. `cerefox doctor` verifies. |
| **Source checkout** (`git clone`, contributor) | `git pull`, then `cerefox server deploy` (or the lower-level `bun scripts/db_*.ts` + `npx supabase functions deploy`). Rebuild the SPA if you run `cerefox web` from source. |
| **Local / self-hosted (Docker, World B)** | `cerefox-local upgrade` — resolves the newest release, pulls it, and recreates the container (`upgrade <tag>` pins an exact version; `upgrade --latest` follows the moving tag). Data persists in the volume; OpenAI key + tuning overrides preserved. **No separate `server deploy`/`reindex`**: the CLI, web, PostgREST, and schema all ship together in one versioned image, so they can't drift. See [`setup-local.md`](setup-local.md). |

> **On an old pre-installer clone (0.1.x)?** The cleanest upgrade is to stop
> running from the repo and install the package: follow the
> [quickstart](quickstart.md), then run `cerefox init` — it offers to copy your
> repo `.env` to `~/.cerefox/.env`, deploy the server, and wire up your agent.
> After that you're on the end-user path below.

> ### Cerefox Local on an image older than v1.1.0: upgrade once with an explicit tag
>
> If your container is on **v1.0.6 or earlier**, run this once:
>
> ```bash
> cerefox-local upgrade v1.1.1     # or any newer tag
> ```
>
> A bare `cerefox-local upgrade` will **not** get you off an old image, and it
> fails quietly: it prints "Pulling …", "container (re)started" and "refreshed
> cerefox-local from the new image", having changed nothing. Before v1.1.0 a bare
> `upgrade` re-pulled the **pinned** tag rather than resolving the newest release
> (#153).
>
> The reason it cannot fix itself is a bootstrap loop: the `cerefox-local`
> launcher on your host is refreshed *out of the container image* at the end of
> every upgrade, so an old image keeps reinstalling the old launcher. Naming a
> tag explicitly bypasses the pin, pulls the new image, and the new launcher
> comes with it. `curl … install-local.sh | sh` also works, since the installer
> writes the launcher directly.
>
> **After that, a bare `cerefox-local upgrade` behaves as you would expect**: it
> resolves the newest *stable* release and pins that exact version. It does not
> start following the moving `:latest` tag — that is what `upgrade --latest`
> does, and automatic operations (`init`, `start`, `restart`) never follow a
> moving tag by design (#100).

## End-user upgrade

> ### Upgrading to v1.1.0 — `cerefox server deploy` is required
>
> Most releases let you postpone the server step. **This one does not.** Until
> you redeploy, the client and the database disagree in ways that cost data:
>
> - The conflict fix that stops [unbounded retry
>   storms](../../CHANGELOG.md) lives in `rpcs.sql`, so upgrading the client
>   alone leaves the defect live.
> - The v1.1.0 client stops sending retention and retrieval settings and expects
>   the **server** to resolve them from `cerefox_config`. An older server does
>   not read those keys, so a store configured to "keep every version" silently
>   reverts to pruning — quiet data loss.
>
> Because of that second point, v1.1.0 raises the **minimum supported schema**
> to `0.10.3` — the version where the RPCs began resolving those settings from
> `cerefox_config`. (The release ships schema `0.10.4`; the extra step only
> changed a default value, which degrades gracefully, so it is not part of the
> minimum. A schema bump does **not** normally raise the minimum.) What the
> minimum actually gates:
>
> | Surface | Below the minimum |
> |---|---|
> | `cerefox web` | **Refuses to start** — "Refusing to start: the deployed Cerefox server is incompatible with this client" |
> | `cerefox doctor` | Reports an error and exits non-zero |
> | Web UI banner | Red, blocking |
> | CLI commands (`search`, `document`, `ingest`, …) | **Keep working** |
> | MCP servers (local and remote) | **Keep working** |
>
> So the practical effect is: **your web UI is unavailable between upgrading the
> client and running `server deploy`.** Run them together and the window is
> seconds. Nothing is destroyed by being in that state — it exists to stop you
> operating a mismatched pair for days without noticing.
>
> **After redeploying**, carry over any settings you had tuned in `.env`.
> `cerefox doctor` lists them with the exact commands, and stops mentioning them
> once the store matches. The five retired variables are
> `CEREFOX_MIN_SEARCH_SCORE`, `CEREFOX_MIN_TERM_COVERAGE`, `CEREFOX_SEARCH_ALPHA`,
> `CEREFOX_VERSION_RETENTION_HOURS`, `CEREFOX_VERSION_CLEANUP_ENABLED`.
>
> **Version pruning is switched off on existing stores** by migration 0016, so
> the change above cannot quietly discard history. Nothing is deleted. Re-enable
> when you have chosen a policy:
> `cerefox config set version_cleanup_enabled true`. The default retention
> window is now 120 hours (was 48) — long enough that a Friday mistake is still
> recoverable on Monday.
>
> **Cerefox Local** users need no separate step: the schema ships inside the
> image, so `cerefox-local upgrade` moves both halves together.


```bash
cerefox self-update      # or: re-run the installer, or bun/npm update -g @cerefox/memory
cerefox server deploy    # applies pending migrations, re-applies RPCs, redeploys the 9 Edge Functions
cerefox doctor           # verify
```

`cerefox server deploy` is the catch-all for the server side. On an existing
database it applies **every** pending migration (regardless of which version
you're coming from — so there are no per-version steps to follow), re-applies
`rpcs.sql`, and redeploys all nine Edge Functions from npm-bundled assets. No
repo clone required. On **macOS**, set `SUPABASE_ACCESS_TOKEN` in
`~/.cerefox/.env` first to avoid a Keychain password dialog per function deploy
(see [`configuration.md`](configuration.md#supabase--database)).

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

> Python was **fully removed at v1.0.0** (CLI, FastAPI web app, and the
> `uv run cerefox mcp` fallback). Tests run via `bun test`.

## Notable cross-version transitions

Most upgrades need nothing beyond the steps above. Two transitions are worth
knowing about:

- **v0.9 — CLI verbs moved to a resource-verb shape** (`cerefox document get`,
  `cerefox project list`, …). The old flat verbs (`get-doc`, `list-docs`,
  `deploy-server`, `docs`, …) still run but print the new form and exit
  non-zero — so any scripts or aliases tell you exactly what to change. Re-run
  `cerefox completion install` to refresh tab-completion. The Python CLI + web
  app became husks at v0.9 and were fully removed at v1.0.0.
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
schema into the Custom GPT editor and **re-enter your Cerefox access token**
(`cfx_pat_…`, from `cerefox token generate`) as the Bearer token. (The editor
clears the key on every schema save. The legacy Supabase anon JWT is retired for
Edge Function auth as of iter-28E — see
[`setup-supabase.md`](setup-supabase.md#supabase-api-keys-2026).)
