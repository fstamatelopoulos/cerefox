# Local / Self-Hosted Setup (Docker)

Run Cerefox **fully on your own machine** — no hosted Supabase, no cloud database. One
Docker container bundles everything: Postgres + pgvector, the PostgREST Data API, and the
Cerefox web server. You get the same web UI, CLI, and MCP server as the cloud setup.

> **Embeddings still use the OpenAI API.** An `OPENAI_API_KEY` is required even for a
> local setup (the database and web server are local; embedding generation is not). A
> fully offline embedder is on the roadmap.

## Cloud vs. Local — pick one

Cerefox has two independent "worlds". Most people run **one or the other**:

| | Cloud / Supabase | **Local / self-hosted (this guide)** |
|---|---|---|
| Install | `curl … install.sh \| sh` (npm) | `curl … install-local.sh \| sh` (Docker) |
| Command | `cerefox` | `cerefox-local` |
| Backend | hosted Supabase | a Docker container on your machine |
| Host runtime | Node/Bun | **Docker only** |

The two never collide — different installer, different command name — so even if you run
both, your cloud `~/.cerefox/.env` is never touched by the local installer.

---

## Prerequisites

- **Docker** (Docker Desktop, or [Colima](https://github.com/abiosoft/colima): `colima start`).
- An **OpenAI API key** — [platform.openai.com/api-keys](https://platform.openai.com/api-keys).

That's it. No Node, Bun, Postgres, or repo clone needed.

---

## Step 1 — Install

```bash
curl -fsSL https://github.com/fstamatelopoulos/cerefox/releases/latest/download/install-local.sh | sh
```

This pulls the published multi-arch image (`amd64` + `arm64`), starts the container, and
installs a `cerefox-local` command (symlinked into `~/.local/bin`). To set your OpenAI key
inline at install instead of via `cerefox-local init` (Step 2), use the command-substitution
form: `OPENAI_API_KEY=sk-... sh -c "$(curl -fsSL …/install-local.sh)"`. Pick a specific port
with `PORT=8017 …`.

> If the installer warns that `~/.local/bin` isn't on your `PATH`, add it:
> ```bash
> echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
> ```

The web UI is now at **http://localhost:8000/app/** — **or the port the installer chose**
(it auto-steps to 8010/8020/… if 8000 is busy or you also run the cloud `cerefox web`, which
defaults to 8000). The installer prints the actual URL; `cerefox-local status` shows it too.

The installer also wires **shell tab-completion** for `cerefox-local` (best-effort) — run
`exec $SHELL` or open a new terminal to activate it.

**How the credential works:** the container generates its own JWT secret on first boot and
mints the access token internally — the token never leaves the container. The only secret
stored on your host is `OPENAI_API_KEY` (in `~/.cerefox/local/.env`), so `upgrade` can
re-supply it.

---

## Step 2 — Use the CLI

`cerefox-local` runs the same commands as the cloud `cerefox`, but against your local
container:

```bash
cerefox-local status                                   # is it running? what URL?
cerefox-local document ingest my-notes.md --project-name personal
cerefox-local search "what did I write about planning?"
cerefox-local document list
```

KB verbs (`search`, `document`, `project`, `metadata`, `audit`, `config`, `guides`, `mcp`)
run inside the container; lifecycle verbs run on the host (next section).

---

## Step 3 — Connect an AI agent (MCP)

```bash
cerefox-local configure-agent
```

If the `claude` CLI is present this registers an MCP server named `cerefox-local` with
Claude Code automatically. Otherwise it prints the snippet to add to your client — the MCP
command is simply `cerefox-local mcp` (stdio), which the client launches per session. The
client never needs a token; the container holds it.

---

## Managing the container

All host-side, via `cerefox-local`:

```bash
cerefox-local start          # start a stopped container
cerefox-local stop           # stop it (your data persists in the Docker volume)
cerefox-local restart
cerefox-local logs -f        # follow the logs
cerefox-local upgrade        # pull the latest image + recreate (keeps data + OPENAI key)
cerefox-local uninstall          # remove the container, KEEP the data volume
cerefox-local uninstall --purge  # remove the container AND delete the data volume
```

`upgrade` is the single update path: it pulls the newest image, recreates the container,
and refreshes the `cerefox-local` script itself. Because the CLI, web server, PostgREST,
and database schema all ship together in one versioned image, they never drift out of
sync.

---

## Where things live

| Thing | Location |
|---|---|
| Container | name `cerefox-local` (override: `CEREFOX_LOCAL_CONTAINER`) |
| Your data | Docker volume `cerefox_local_pgdata` (survives `stop`/`upgrade`) |
| Host config | `~/.cerefox/local/.env` (OPENAI key + port only — **no token**) |
| Host command | `~/.cerefox/local/cerefox-local`, symlinked to `~/.local/bin/cerefox-local` |

---

## Troubleshooting

**`docker not found` / can't connect** — start Docker Desktop, or `colima start`.

**`cerefox-local: command not found`** — `~/.local/bin` isn't on your `PATH` (see Step 1).

**`container 'cerefox-local' is not running`** — `cerefox-local start` (or `status` to
check). After a reboot the container may be stopped depending on your Docker settings.

**Ingest/search fail with no embeddings** — `OPENAI_API_KEY` wasn't set at install time.
Re-run the installer with the key, or set it and `cerefox-local upgrade`.

**Port already in use** — re-install with a free port: `PORT=8017 sh -c "$(curl -fsSL …/install-local.sh)"`.

---

## Contributor notes

To build + test the image from a checkout (instead of pulling ghcr):

```bash
docker build -f docker/local/Dockerfile -t cerefox-local:dev .
CEREFOX_LOCAL_IMAGE=cerefox-local:dev sh docker/local/install-local.sh
```

See [`docker/local/README.md`](../../docker/local/README.md) for the image internals
(s6-overlay supervision, the `/rest/v1` proxy, the pinned PostgREST version) and
`docs/research/local-cerefox-design.md` for the design of record.
