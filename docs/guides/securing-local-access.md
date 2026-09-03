# Securing local access (the API key)

`cerefox web` and Cerefox Local serve an HTTP API on a port. This guide is
about who is allowed to use it.

**Most people need to do nothing.** Read the first section, confirm you are in
the common case, and stop.

---

## The rule

> **A request arriving on the loopback interface (`127.0.0.1`) is allowed
> without a credential. A request arriving on any other interface must present
> the server's API key.**

Loopback means "a connection that started on this machine". Your browser, an
agent running on your laptop, a script you typed into your own terminal: all
loopback, all exempt, all work with no configuration.

Introduced in **v1.12.0** ([#229](https://github.com/fstamatelopoulos/cerefox/issues/229)).

## Do you need a key?

**It depends on how Cerefox itself is running**, so start there.

### If you run Cerefox Local (Docker)

| Your publish address | Gate | You do |
|---|---|---|
| `127.0.0.1` (the default) | **Off** | Nothing. Every caller that can reach the published port is allowed, and the port is only reachable from this machine. |
| Anything wider (`CEREFOX_LOCAL_BIND=0.0.0.0`) | **On, for everyone** | Give the key to every client, including your own browser. |

There is no middle setting here, and that is deliberate rather than a
limitation we forgot to lift. **Docker rewrites the source address of every
request that comes through a published port**, so a server inside a container
cannot tell a request from your own machine apart from one that crossed the
network — both arrive from the same bridge address. Since the distinction
cannot be made, the gate does not pretend to make it: it is either off, with
the publish address as the boundary, or on for everybody.

`cerefox-local` sets this for you from `CEREFOX_LOCAL_BIND`. To force the gate
on while still publishing to loopback:

```bash
echo 'CEREFOX_API_REQUIRE_KEY=1' >> ~/.cerefox/local/.env
cerefox-local restart
```

> **v1.12.0 got this wrong** and injected a key into every container without
> require-mode, so the loopback exemption never matched and every caller — the
> web UI included — got a `401`. Fixed in **v1.12.1**. If you are on v1.12.0
> and seeing 401s from a container, upgrade.

### If you run `cerefox web` directly (npm install)

Here the server sees real client addresses, so the loopback rule applies as
written.

| Your situation | Need a key? |
|---|---|
| You use the web UI in your browser | **No** |
| An agent or script runs on the same machine | **No** |
| A container reaches your host server via `host.docker.internal` | **No** — it arrives on the host's loopback |
| You bind `--host 0.0.0.0` to reach Cerefox from another machine | **Yes** |
| A reverse proxy sits in front on the same machine | **Yes**, plus `CEREFOX_API_REQUIRE_KEY=1` (see below) |

If every row that applies to you says No, you are done.

**Not sure?** Ask for the version endpoint the way your client will. `200`
means you are on the exempt path; `401` means you need a key.

```bash
docker exec <your-client-container> \
  curl -s -o /dev/null -w '%{http_code}\n' http://host.docker.internal:8010/api/v1/version
```

## Why it works this way

The attacker worth defending against can reach the port but **cannot read your
filesystem**: a machine on the café wifi after you widened the bind, a
container on a shared Docker network, a malicious page open in your browser.

Someone who *can* read your filesystem already has the key file, your `.env`,
and your database credentials. Demanding a key from them would protect nothing
while making the common case worse for everyone. On a single-user machine,
loopback access and key-file access are the same trust boundary, so the gate is
drawn at the place where the trust actually changes: the network.

This is also why **the browser never holds a key**. The web UI is a static
file, so a key embedded in the page could be read by anything that can load the
page — precisely the attacker the key exists to stop. A key in an
unauthenticated page is not a secret. The UI works because it is local, not
because it holds a credential.

## Getting a key

### `cerefox web` (npm install)

No key exists until you ask for one. Until then the gate is off and the server
behaves exactly as it did before v1.12.0, which is what makes upgrading safe.

```bash
cerefox api-key generate   # mint one, write it to your .env, print it once
cerefox api-key show       # print it again, in full
cerefox api-key rotate     # replace it
```

`generate` refuses if a key already exists. Silently replacing one would give
every client you had already configured a `401` with no explanation.

### Cerefox Local (Docker)

The container mints a key **automatically at first boot** and persists it on
the data volume, so it survives `cerefox-local upgrade`. You never create it;
you only read it.

```bash
cerefox-local api-key            # print it (and say whether it is enforced)
cerefox-local api-key --rotate   # mint a new one and restart
```

The key exists whether or not the gate is on, so turning the gate on later
never changes the value your clients were given. `cerefox-local api-key` tells
you which state you are in — printing a key while implying it is being enforced
when it is not would be worse than printing nothing.

## Using it

A remote caller sends it as a bearer token:

```bash
curl http://<host>:8010/api/v1/documents/<uuid> \
  -H 'Authorization: Bearer cfx_lak_…' \
  -H 'X-Cerefox-Requestor: my-bot'
```

Without a valid key the server answers `401` with a `WWW-Authenticate: Bearer`
challenge and a `detail` field explaining what to do.

The key authenticates; it does not identify. `X-Cerefox-Requestor` and
`X-Cerefox-Author` are still declared labels for attribution, exactly as
described in [`api.md`](api.md#attribution-is-not-authentication). Holding the
key does not make the name you send true.

## Recipe: a harness in its own container

The case where a key is genuinely needed, and the one worth automating.

**The ordering that avoids a chicken-and-egg problem.** You could boot Cerefox,
read its key, then configure the client — but that is two steps and a manual
copy every time either side is rebuilt. Instead, mint one key on the host and
give the same value to both containers. Cerefox prefers an injected key over
the one it would generate, so this pins it across recreates.

```bash
# 1. Mint once, on the host.
KEY="cfx_lak_$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-43)"

# 2. Give it to Cerefox Local. Both variables are on the passthrough allowlist,
#    so they survive `cerefox-local upgrade` and any recreate. REQUIRE_KEY is
#    what turns the gate on: inside a container there is no loopback exemption
#    to fall back on, so the gate is all-or-nothing.
{ echo "CEREFOX_API_KEY=$KEY"; echo "CEREFOX_API_REQUIRE_KEY=1"; } >> ~/.cerefox/local/.env
cerefox-local restart

# Note: with the gate on, YOUR BROWSER needs the key too. If you use the web UI
# daily, prefer leaving Cerefox published on loopback with the gate off and
# giving your harness host networking instead.

# 3. Give the same value to your client container, however it takes config.
docker run -e CEREFOX_API_KEY="$KEY" … your-harness
```

**Rotating** is the same two writes plus two restarts, in this order: update
Cerefox first, then the client. Between them the client gets `401`s, so keep
the window short, or accept both keys briefly by setting a comma-separated list
(`CEREFOX_API_KEY=new,old`), migrating the client, then dropping the old value.

## Recipe: a reverse proxy on the same machine

**This is the case the loopback rule cannot handle on its own, so read it if it
applies to you.**

A proxy on the same host terminates the client's connection and opens its own
to Cerefox, from `127.0.0.1`. So *every* proxied request looks local and is
exempt, including requests that came from the internet.

Cerefox deliberately does **not** read `X-Forwarded-For` to recover the
original address. That header is set by the caller, so trusting it would let
anyone claim to be local — strictly worse than having no gate at all.

The answer is to stop exempting loopback:

```bash
CEREFOX_API_REQUIRE_KEY=1
```

Now every caller presents the key, proxy included. Your browser will need it
too, so this mode suits headless deployments rather than daily UI use.

## What this does not protect

**Other programs on your own machine.** Any local process can reach a loopback
port. This is a network boundary, not process isolation.

**Traffic on the wire.** There is no TLS. The key authenticates; it does not
encrypt. Anyone who can observe the connection can read the key and everything
else.

**Fine-grained access.** One key, all-or-nothing. No per-client scoping, no
read-only keys, no expiry, no revocation beyond rotating the single value.

**Being on the internet.** A key makes a widened bind survivable. It does not
turn this into an internet-facing API: there is no rate limiting, no TLS, no
audit of failed attempts. If you need Cerefox reachable over a network you do
not control, use the Edge Functions — that is the surface built for it, and it
authenticates every request against a rotatable token. See
[`access-paths.md`](access-paths.md).

## Troubleshooting

**Everything returns 401 after upgrading.** You have `CEREFOX_API_REQUIRE_KEY=1`
set, which removes the loopback exemption. Unset it unless you are running a
reverse proxy.

**My container gets 401 but curl on the host works.** With `cerefox web` on the
host, that is the gate behaving correctly: your container reaches Cerefox over
a Docker network, not loopback. Give it the key (see the recipe above).

**Everything gets 401 from a Cerefox Local container, including the web UI.**
That is the v1.12.0 bug, not a configuration problem. Run
`cerefox-local upgrade` to get v1.12.1 or newer.

**`cerefox-local api-key` says no key was found.** The image predates v1.12.0.
Run `cerefox-local upgrade`.

**I rotated and now everything is broken.** Rotation invalidates the old key at
the next restart. Update every remote client. Local callers are unaffected,
which is a useful way to confirm the server itself is healthy: if
`curl http://127.0.0.1:<port>/api/v1/version` works from the host, the server
is fine and the problem is client configuration.

**I lost the key.** You cannot recover it from the server, but you can read it
from where it is stored: `cerefox api-key show`, or `cerefox-local api-key`.
Failing that, rotate and reconfigure your clients.
