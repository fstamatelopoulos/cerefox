# Running Cerefox on another machine on your network

Run Cerefox on an always-on machine on your home or office network (a NAS, a
mini PC, a home server) and use it from your other machines: agents, the CLI,
and the web UI in a browser. Requires **v1.20.0 or newer** (the CLI and coding
agents against Cerefox Local: **v1.22.0**).

There are two ways to do it, and they do not depend on each other:

| | What runs on the LAN host | Where the data lives | Image |
|---|---|---|---|
| **A. Cerefox Local** | Everything: database, server, web UI | On the LAN host | `ghcr.io/fstamatelopoulos/cerefox-local` |
| **B. Web container** | The server and web UI | Your Supabase project | `ghcr.io/fstamatelopoulos/cerefox-web` |

Pick **A** if you want the data at home and no cloud database. Pick **B** if you
already run Cerefox on Supabase and want the web UI (and the `/api/v1` API)
served from your network instead of from your laptop.

## The one rule: the API key gate is on

On your laptop, Cerefox trusts connections that start on the same machine and
needs no key. **On a LAN host that rule cannot apply.** Inside a container every
caller looks remote, because Docker rewrites the source address of every
request that comes through a published port, so the container cannot tell your
laptop apart from any other device on the network. Without a key, anything that
can reach the port can read, change and delete the whole store.

So both setups turn the gate on for every caller (`CEREFOX_API_REQUIRE_KEY=1`)
and use a key you choose. Make one now and keep it somewhere safe, such as your
password manager:

```bash
echo "cfx_lak_$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-43)"
```

Every client then presents it as `Authorization: Bearer <key>`. **The web UI
asks for it once per browser** (see [Using the web UI](#using-the-web-ui)).

## A. Cerefox Local on a LAN host

The same all-in-one image the [local install](setup-local.md) uses, run directly
with Docker instead of through `cerefox-local`.

### With `docker run`

```bash
docker run -d --name cerefox --restart unless-stopped \
  -p 8000:8000 \
  -v /path/on/host/cerefox-db:/var/lib/postgresql/data \
  -e CEREFOX_API_REQUIRE_KEY=1 \
  -e CEREFOX_API_KEY=cfx_lak_YOUR-KEY \
  -e CEREFOX_EMBEDDER=openai \
  -e OPENAI_API_KEY=YOUR-OPENAI-KEY \
  --memory 2g \
  ghcr.io/fstamatelopoulos/cerefox-local:v1.20.0
```

- **The data folder** (`/path/on/host/cerefox-db`) holds the database. Deleting
  or recreating the container keeps it, which is how you upgrade.
- **Publish only port 8000.** Postgres (5432) and PostgREST (3000) stay inside
  the container; do not publish them.
- **`CEREFOX_API_KEY`** sets the key. Without it the container mints one on
  first boot and keeps it in the data folder; you can read that one with
  `docker exec cerefox cat /var/lib/postgresql/data/.cerefox_api_key`. Setting
  it yourself is easier on hosts whose Docker app gives you no shell.
- **Embeddings:** `CEREFOX_EMBEDDER=openai` with your key, or
  `CEREFOX_EMBEDDER=local` for the bundled offline model (no API key, needs more
  memory; see [`setup-local.md`](setup-local.md) for the figures).
- **Memory:** 2 GB is comfortable with OpenAI embeddings.

### With a compose file (or a NAS Docker app)

Most NAS Docker apps (Synology Container Manager, QNAP Container Station,
Unraid, Portainer) accept a compose file as a "project" or "stack". Use one:
an upgrade is then a one-line change to the image tag.

```yaml
services:
  cerefox:
    image: ghcr.io/fstamatelopoulos/cerefox-local:v1.20.0
    container_name: cerefox
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - /path/on/host/cerefox-db:/var/lib/postgresql/data
    environment:
      CEREFOX_API_REQUIRE_KEY: "1"
      CEREFOX_API_KEY: "cfx_lak_YOUR-KEY"
      CEREFOX_EMBEDDER: openai
      OPENAI_API_KEY: "YOUR-OPENAI-KEY"
    mem_limit: 2g
```

The compose file holds both keys, so treat it as a secret. Give the project its
own folder, never the data folder.

Set only the variables above. The image's own variables (`PGDATA`,
`POSTGRES_*`, `CEREFOX_DATABASE_URL`, `CEREFOX_SUPABASE_URL`,
`CEREFOX_POSTGREST_UPSTREAM`, `PGRST_*`, `CEREFOX_MODELS_DIR`) are defaults
baked into it; some Docker apps display them, but do not change them.

### If the host cannot pull the image

Some NAS Docker apps fail to pull from `ghcr.io` (for example "registry returned
bad result"). Pull it on another machine and copy it over as a file. Most NAS
hosts are x86-64, so ask for `linux/amd64` explicitly when the other machine is
an Apple Silicon Mac:

```bash
docker pull --platform linux/amd64 ghcr.io/fstamatelopoulos/cerefox-local:v1.20.0
docker save ghcr.io/fstamatelopoulos/cerefox-local:v1.20.0 -o cerefox-local-v1.20.0-amd64.tar
```

Then import the `.tar` in the Docker app (usually Image → Add → From file). Keep
the `image:` line exactly as the imported name and tag, or the app will try to
pull again.

### Upgrading

Change the tag (and import the new `.tar` first if the host cannot pull), then
recreate the container. The data folder carries the database and, if you let the
container mint it, the key. Cerefox Local applies pending schema migrations on
boot.

### On a Synology NAS

Step by step with **Container Manager** on DSM 7.2. Menu names can differ a
little between DSM versions.

**1. Check the model can run it.** Container Manager has to be in Package
Center for your model; if it is not there, the model cannot run containers. The
image is published for both CPU types Synology uses, and Docker picks the right
one when it pulls. You only need to know which one when you copy the image over
as a file (step 3): **Control Panel → Info Center → General** shows the CPU. An
Intel or AMD processor needs `linux/amd64`; an ARM one (Realtek, for example)
needs `linux/arm64`.

**2. Install Container Manager and make two folders.** Install it from Package
Center; it creates a shared folder named `docker`. In File Station, create two
folders inside it:

- `docker/cerefox-db`: the database. Nothing else goes here.
- `docker/cerefox-project`: the compose file. Keep it separate from the data.

**3. Get the image.** Try **Container Manager → Registry** first. If the search
or the download fails (some DSM versions answer `ghcr.io` with "registry
returned bad result"), copy the image over as a file instead
([above](#if-the-host-cannot-pull-the-image), with the `--platform` from step
1), then **Image → Import → Add from file**. The image list must then show
`ghcr.io/fstamatelopoulos/cerefox-local` with the tag you will put in the
compose file, or Container Manager will try to pull it again.

**4. Create the Project.** **Project → Create**:

- **Project name:** `cerefox`.
- **Path:** `docker/cerefox-project`.
- **Source:** "Create docker-compose.yml", and paste:

```yaml
services:
  cerefox:
    image: ghcr.io/fstamatelopoulos/cerefox-local:v1.22.0
    container_name: cerefox
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - /volume1/docker/cerefox-db:/var/lib/postgresql/data
    environment:
      CEREFOX_API_REQUIRE_KEY: "1"
      CEREFOX_API_KEY: "cfx_lak_YOUR-KEY"
      CEREFOX_EMBEDDER: openai
      OPENAI_API_KEY: "YOUR-OPENAI-KEY"
    mem_limit: 2g
```

- **The volume path** is the full path on the NAS. `/volume1` is the first
  storage volume; if your `docker` shared folder lives on another volume, File
  Station shows which (right-click the folder, Properties).
- **The left port** (`8000:`) is the one your other machines will use. Change
  it if something on the NAS already uses 8000; leave the right one alone.
- Skip the web portal (Web Station) step, then finish. Container Manager starts
  the container.

**5. Check it started.** **Container → cerefox → Log.** The first boot creates
the database, which takes a minute; later boots apply any pending schema
migrations and then the server starts. Then, from another machine, run the
`curl` checks under [Using it from your other machines](#using-it-from-your-other-machines).

**6. Keep it on your network.** Do not forward the port on your router, and do
not publish it through QuickConnect, DSM's reverse proxy (Login Portal) or any
other remote-access feature. To go one step further, **Control Panel → Security
→ Firewall** can allow the port only from your local subnet.

**Upgrading.** Back up first (below). Then:

1. Stop the Project.
2. Get the new image (step 3).
3. Change the tag on the `image:` line in the Project's YAML.
4. Build the Project again.

The data folder carries the database, and the key stays in the Project's YAML
(a key set there is not saved in the data folder), so nothing else changes.
Once the new version is running, you can delete the old image under **Image**.

**Protecting the data.** The NAS gives you three layers; use the last one in any
case:

- **Snapshots** (the Snapshot Replication package, on a Btrfs volume) of the
  `docker` shared folder. A snapshot of a running database is only
  *crash-consistent*, like pulling the power cord: Postgres recovers from it,
  but stop the Project first if you want a clean copy.
- **Hyper Backup** of the same folder to another disk or NAS. The same caveat
  applies.
- **`cerefox backup create`** from one of your machines, with the CLI set up as
  below. It writes a JSON snapshot of your documents and projects to that
  machine, which `cerefox backup restore` can load into a new Cerefox, on the
  NAS or elsewhere.

  A backup made on the NAS itself (`cerefox backup create` in the container's
  terminal) is saved in the data folder, under `.cerefox-backups`, so it
  survives a rebuild and the layers above include it. Before v1.22.1 it was
  saved inside the container and lost on the next build (#359).

  To take these every night from a container on the NAS, for this store and
  others, see [`scheduled-backups.md`](scheduled-backups.md).

## B. The web container, with your Supabase backend

You need a working Supabase-backed Cerefox first (see
[`setup-supabase.md`](setup-supabase.md)): the schema, RPCs and Edge Functions
are deployed by `cerefox server deploy`, not by this image.

```bash
docker run -d --name cerefox-web --restart unless-stopped \
  -p 8000:8000 \
  -e CEREFOX_SUPABASE_URL=https://YOUR-REF.supabase.co \
  -e CEREFOX_SUPABASE_KEY=YOUR-SECRET-KEY \
  -e OPENAI_API_KEY=YOUR-OPENAI-KEY \
  -e CEREFOX_API_KEY=cfx_lak_YOUR-KEY \
  ghcr.io/fstamatelopoulos/cerefox-web:v1.20.0
```

- **The image refuses to start without `CEREFOX_API_KEY`** and turns the gate
  on for every caller. It holds your Supabase secret key, so an open container
  on the network would hand out full access to your cloud store.
- **`CEREFOX_WEB_NO_KEY=1`** starts it without a key. Use it only when
  something in front of the container already controls who can reach it (an
  authenticating proxy, Cloud Run IAM). It logs a warning at every start, and
  sets `CEREFOX_ALLOWED_HOSTS=*` unless you set it, since the container is then
  reached by the proxy's host name.
- The image runs as an unprivileged user and has a healthcheck that uses the
  key from its own environment.
- The local offline embedder is not included: it runs only in Cerefox Local.

## Using it from your other machines

Use the host's address and the published port, for example
`http://192.168.1.20:8000`.

```bash
KEY=cfx_lak_YOUR-KEY; HOST=http://192.168.1.20:8000
curl -s -o /dev/null -w '%{http_code}\n' "$HOST/api/v1/projects"                              # 401
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $KEY" "$HOST/api/v1/projects"  # 200
```

**Check `/api/v1/projects`, not `/api/v1/version`.** The version route never
touches the database, so it answers even when the data path is broken. (From
v1.12.1 to v1.19.5 a gated Cerefox Local container answered `version` while
every data route failed; fixed in v1.19.6.)

The HTTP API is documented in [`api.md`](api.md).

### Using the web UI

Open `http://<host>:<port>/app/`. The page loads, the server refuses its first
call, and the UI asks for the key:

- **Paste the key** and press Continue. The UI checks it with the server before
  keeping it, so a mistyped key is refused in the dialog.
- **"Remember on this browser"** keeps it in the browser's local storage for
  this address. Unticked, it lasts until the tab closes.
- **The key-off icon** in the header forgets it. So does a key the server stops
  accepting (rotated, or the container recreated with a new one): the UI says
  the saved key was not accepted and asks again.

The key is kept per address and port, so other apps on the same host cannot
read it. It is readable by scripts running in the Cerefox page itself; the page
renders documents without raw HTML, and the project's tests fail on any change
that would let a document inject script.

### The CLI and coding agents (Cerefox Local only)

Requires **v1.22.0 or newer** on the LAN host. Your other machines run the
ordinary `cerefox` client (`npm install -g @cerefox/memory`) against the host,
the same way they would run it against a Supabase project: a URL and a key in a
`.env`. With the web container (B), point the client at your Supabase project as
usual instead; the web container plays no part in it.

Keep this setup in its own config directory, as you would a staging
environment ([`staging-env.md`](staging-env.md)), so it never mixes with another
Cerefox you use:

```bash
mkdir -p ~/.cerefox/lan && chmod 700 ~/.cerefox/lan
cat > ~/.cerefox/lan/.env <<'ENV'
CEREFOX_SUPABASE_URL=http://192.168.1.20:8000
CEREFOX_SUPABASE_KEY=cfx_lak_YOUR-KEY
CEREFOX_ENV_LABEL=lan
CEREFOX_PROG_NAME=cerefox-lan
CEREFOX_EMBEDDER=openai
OPENAI_API_KEY=sk-YOUR-OPENAI-KEY
ENV
chmod 600 ~/.cerefox/lan/.env
alias cerefox-lan='CEREFOX_CONFIG_DIR=~/.cerefox/lan cerefox'

cerefox-lan doctor
cerefox-lan configure-agent --tool claude-code   # adds an MCP server named cerefox-lan
```

- **The embedder must match the LAN host's.** The client computes the
  embeddings for what it ingests and searches, as it does against Supabase, so
  it needs the same `CEREFOX_EMBEDDER` as the host, and for `openai` its own
  OpenAI key. A host that runs the local embedder needs `CEREFOX_EMBEDDER=local`
  here, and the client then downloads the model once (about 130 MB).
- **How the key gets in.** The client sends the key where a Supabase client
  sends its secret key. The server checks it, then passes the request to the
  database with the container's own internal credential, which never leaves
  the container. This is the same exchange Supabase's gateway makes for an
  `sb_secret_` key.
- **`CEREFOX_PROG_NAME`** is the alias's name. Hints that tell you what to run
  next (`doctor`'s suggestions, for example) then say `cerefox-lan …`, so a
  copied one acts on the LAN host and not on another Cerefox you use.
- **`CEREFOX_ENV_LABEL`** puts `[LAN]` on `doctor`'s title line and in backup
  file names, and names the agent entry `cerefox-lan`.
- **Agents without MCP.** A coding agent can also run `cerefox-lan` commands in
  its shell, or call the HTTP API ([`api.md`](api.md)) with the key.
- `configure-agent` pins the config directory into the agent's MCP entry, so
  the agent reaches the LAN host whichever directory it starts in.


**Traffic on the wire.** Plain `http://` on your network sends the key, and
everything else, unencrypted. That is acceptable on a home network you control;
do not run these setups on a network you share with people or devices you do
not trust.

**The internet.** These setups are for your own network only. Do not forward
the port from your router, and do not publish the host's Cerefox port through
a remote-access service or a proxy.

**Anyone with the key**, or with access to the host's files, the data folder or
the compose file. On Cerefox Local the key is the store's master key: besides
the web UI and the HTTP API, it opens the database API the CLI uses, which can
read and change every table directly.

## Troubleshooting

**Nothing answers on the port.** Check which host port is actually published in
your Docker app; the container may be running on a different one than you
planned.

**Every data route returns 500 with the key, but `/version` works.** The image
is older than v1.19.6. Upgrade.

**The CLI or an agent fails with `Expected 3 parts in JWT; got 1`.** The
Cerefox Local image on the LAN host is older than v1.22.0, which passed the key
to the database unchanged. Upgrade the image; the client needs no change.
`cerefox doctor` says the same.

**The web UI shows a white page or keeps failing after the key.** The image is
older than v1.20.0, which is the first version whose web UI can send a key.

**The container exits right away (web container).** Read its log: it refuses
to start without `CEREFOX_API_KEY` and says so.

**A markdown image in a document does not load.** An image whose address is a
`/api/v1/…` path is fetched by the browser without the key. Links work; images
from the API do not.
