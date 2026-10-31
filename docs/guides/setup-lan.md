# Running Cerefox on another machine on your network

Run Cerefox on an always-on machine on your home or office network (a NAS, a
mini PC, a home server) and use it from your other machines: agents, the CLI,
and the web UI in a browser. Requires **v1.20.0 or newer**.

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

## What this does not protect

**Traffic on the wire.** Plain `http://` on your network sends the key, and
everything else, unencrypted. That is usually acceptable on a home network you
control; it is not on a shared one. For TLS, put a reverse proxy in front (see
[`securing-local-access.md`](securing-local-access.md#recipe-a-reverse-proxy-on-the-same-machine));
the gate stays on, since a proxy makes every request look local.

**The internet.** Do not forward the port from your router. These setups are
for your own network.

**Anyone with the key**, or with access to the host's files, the data folder or
the compose file.

## Troubleshooting

**Nothing answers on the port.** Check which host port is actually published in
your Docker app; the container may be running on a different one than you
planned.

**Every data route returns 500 with the key, but `/version` works.** The image
is older than v1.19.6. Upgrade.

**The web UI shows a white page or keeps failing after the key.** The image is
older than v1.20.0, which is the first version whose web UI can send a key.

**The container exits right away (web container).** Read its log: it refuses
to start without `CEREFOX_API_KEY` and says so.

**A markdown image in a document does not load.** An image whose address is a
`/api/v1/…` path is fetched by the browser without the key. Links work; images
from the API do not.
