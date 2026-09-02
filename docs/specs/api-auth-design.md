# Authenticating the local HTTP surface (#229)

**Status: DESIGN APPROVED 2026-09-02, ready to build.** Target: v1.12.0
(iteration 41). The four open questions were decided by the maintainer on
2026-09-02 and are recorded under "Decisions" below.

## The problem, stated precisely

`cerefox web` serves an unauthenticated JSON API. Anything that can open a TCP
connection to the port can read every document, edit them, delete them, and
permanently purge them. Today the only boundary is that every shipped path
binds loopback: `cerefox web` defaults `--host 127.0.0.1`
(`cli/commands/web.ts:96`), and Cerefox Local publishes to `127.0.0.1`
(`docker/local/install-local.sh:30`, `docker/local/cerefox-local:101`).

That was adequate while the API was the bundled UI's private backend. #226
invited other local clients onto it, and the boundary is one `--host 0.0.0.0`
or one `CEREFOX_LOCAL_BIND=0.0.0.0` away from being absent.
`docs/guides/api.md` says so in the strongest terms available, and a warning in
a guide is not a control.

**Threat model, so the design can be judged against something.** The attacker
is a process or person that can reach the port but has **no read access to the
host filesystem**: another machine on the LAN or a coffee-shop network after
someone widened the bind, a container on a shared Docker network, a malicious
page attempting cross-origin requests. The attacker who already has filesystem
access is explicitly **out of scope**: they can read the key file, the `.env`,
and the Postgres credentials, so no key defends against them. Any design that
only stops the second attacker is theatre.

## Two findings that shape the answer

**1. The port serves more than `/api/v1`.** `registerPostgrestProxy`
(`web/routes/postgrest-proxy.ts:31`) mounts `/rest/v1/*` on the same port and
forwards the caller's headers verbatim to PostgREST. It self-gates on
`CEREFOX_POSTGREST_UPSTREAM`, so it is live on **Cerefox Local specifically** —
the deployment most likely to be running unattended. Gating `/api/v1` and
leaving this open would move the hole, not close it. **Any auth gate must cover
both surfaces.**

**2. Handing the key to the browser is the whole difficulty.** The SPA is
static: `index.html` is read once at boot and served verbatim
(`web/server.ts:160-161`). Injecting the key into that HTML would mean anything
that can `GET /app/` can read the key — which is exactly the attacker we are
defending against. **A key embedded in an unauthenticated page is not a
secret.** Every design below is really a different answer to "how does the
browser prove itself".

## The design: authenticate by network origin, with a key for everything else

Requests arriving on the **loopback interface** are allowed without a
credential. Requests arriving on any other interface must present the key.

This matches the threat model exactly. The in-scope attacker is by definition
not on loopback; the out-of-scope attacker (local filesystem access) could read
the key anyway, so requiring one from them buys nothing. Loopback access and
key-file access are the same trust boundary on a single-user machine, which is
what Cerefox is.

What it means in practice:

- **The browser keeps working with no key and no prompt.** No injection into
  `index.html`, no `localStorage`, no session mechanism, nothing to leak.
- **Local agents keep working unchanged.** The bot harness on 127.0.0.1 needs
  no code change, which matters because #226 just landed and its whole promise
  was "omitted, nothing changes".
- **`cerefox-local` needs nothing at all.** Confirmed in recon: every CLI verb
  runs *inside* the container over `docker exec`
  (`docker/local/cerefox-local:424-432`) and never crosses the published port.
- **`--host 0.0.0.0` stops being a hole.** Widening the bind now exposes a
  surface that demands a credential, which is the entire point of the ticket.
- **Default-on is safe**, because on every existing install nothing changes.
  That dissolves the upgrade problem in the ticket's question 2: there is no
  grace mode to design, because no working setup breaks.

### The caveat this design must document, loudly

**A same-host reverse proxy makes every request look like loopback.** Someone
who puts nginx or Caddy in front of `cerefox web` on the same machine
terminates the connection and reconnects from 127.0.0.1, so every forwarded
request is exempt. `X-Forwarded-For` must **never** be consulted to recover the
original address: it is caller-supplied, so trusting it would let any client
claim any origin and would be strictly worse than having no gate.

The answer is an explicit opt-out for that topology: `CEREFOX_API_REQUIRE_KEY=1`
(or `--require-key`) forces the key on every request including loopback. The
guide tells anyone fronting Cerefox with a proxy to set it. The default stays
the one that is right for the 99% who run it directly.

### Alternatives considered

**Key on every request, including the browser.** Rejected on the browser
problem above: it forces either an injected-key page (not a secret) or a prompt
the user must answer with a value they must first go find. It also breaks every
existing local client on upgrade, converting a security improvement into a
support burden, and the pressure would then be to default it off — which
reproduces today's state for everyone who does not opt in.

**Session cookie issued to the browser.** Real, and strictly more machinery:
something must authenticate the human before issuing the cookie, and on a
single-user local tool the only available proof is "you reached loopback". It
arrives at the same trust decision with a login flow bolted on.

**Origin/CSRF checks only.** Necessary but not sufficient. They stop a
malicious web page driving the API from a victim's browser, and stop nothing
arriving from another host. Worth adding regardless (see below), not as the
gate.

## What gets built

**Reuse the existing auth primitive; do not write a second one.**
`_shared/ef-auth/index.ts` is deliberately runtime-portable (Web Platform
globals only, documented at `ef-auth/index.ts:1-20`) and already does the hard
parts: `parseAccessTokens` for a comma-separated accept-set,
`checkAccessToken` comparing against every token **without short-circuiting**
so timing leaks nothing (`ef-auth/index.ts:93-96`), fail-closed on an empty
token set, and a 401 with `WWW-Authenticate: Bearer`. It imports
`constantTimeEqual` from `_shared/mcp-auth/index.ts:141`, the single audited
compare in the codebase. A Hono middleware can return `efAuthGate`'s `Response`
directly.

One auth implementation covering Edge Functions and the local server is worth
more than a marginally better second one.

**Insertion point.** `web/server.ts:82`, after the logger and before
`registerMetaRoutes`. One `app.use()` covering `/api/v1/*` and `/rest/v1/*`.

**Credential.** `Authorization: Bearer <key>`, matching the Edge Functions and
every HTTP client's defaults. Prefix `cfx_lak_` ("local api key") so it is
visually distinct from `cfx_pat_` in a log or a paste. Minted with
`randomBytes(32).toString("base64url")`, the same as
`cli/commands/token.ts:37-39`.

**Where it lives.**

- `cerefox web`: `CEREFOX_API_KEY` in the resolved `.env`, written with the
  existing `upsertEnvVar` (`cli/util/env-file.ts:35`). Minted on demand by a
  new `cerefox api-key generate|show|rotate`, modelled on `token.ts`.
- Cerefox Local: minted in `s6/scripts/db-init` beside the JWT secret, using
  the same env-override → persisted-file → generate ladder (`db-init:11-13`),
  persisted `chmod 600` on the data volume, and emitted into
  `/run/cerefox-runtime.env` (`db-init:18`) so the server reads it from the
  environment. A new host verb (`cerefox-local api-key`) surfaces it, since the
  wrapper deliberately keeps container secrets in the container
  (`cerefox-local:8-9`).

**Not a `cerefox_config` row.** The toggle would live behind the surface it
protects, and a request that fails auth would still need a database read to
learn whether auth applies. Boot-time environment, self-gating like
`CEREFOX_POSTGREST_UPSTREAM` (`postgrest-proxy.ts:32-35`), avoids the ordering
problem entirely.

**Ride-along hardening**, cheap once the middleware exists: reject
cross-origin requests carrying an `Origin` header that is not the server's own,
so a malicious page in the user's browser cannot drive the API even though the
browser is on loopback. This is the one real gap the loopback design leaves,
and it closes it.

## Decisions

Settled with the maintainer 2026-09-02.

**1 — Loopback-exempt is the design.** Requests on the loopback interface are
allowed without a credential; every other interface must present the key.

**`X-Forwarded-For` is never consulted, and that is enforced in code, not
prose.** A documented rule that some future change could quietly violate is
kicking the can down the road: the header is caller-supplied, so trusting it
would let any client claim any origin and would be strictly worse than no gate
at all. Build requirements: the middleware reads only the transport-level
remote address; a test asserts a request carrying
`X-Forwarded-For: 127.0.0.1` from a non-loopback address is still refused; the
test says in its own comment that it exists to fail a plausible future "fix".

**2 — `/api/v1/version` is gated with everything else. No exceptions.**
Verified before deciding: **nothing local is affected.** The CLI never calls
the local web API at all — it talks to the Supabase Data API directly
(`${supabaseUrl}/rest/v1/...`, `cli/util/checks.ts:183-189`), and the only CLI
references to `/api/v1` are doc comments plus the URL `cerefox web` prints.
`doctor`'s peer-version aggregator is a *different* endpoint on the Edge
Function host, authenticated with the Cerefox access token. The browser is on
loopback. The one contributor script that curls `/version`
(`scripts/capture_python_parity.sh:27`) runs against localhost.

So the only caller a gate affects is a **remote** one, and a remote caller
probing liveness without a credential is precisely what this ticket exists to
stop. One rule with no exceptions is also easier to reason about than one rule
plus a carve-out, and liveness can still be answered by a TCP connect.

**3 — Purge stays reachable over the API.** It cannot be removed without
breaking the web UI's own trash-purge button, and the maintainer wants it
reachable from both surfaces. Hiding it was a defensive measure against
hallucinating models; soft-delete-then-purge is two deliberate steps, which is
friction enough, and agents overwhelmingly reach Cerefox through MCP rather
than the API or CLI. No additional flag, no confirmation token.

**4 — #229 ships in v1.12.0 alongside #232.** The question was badly framed on
my part: a PR is not a release. #233 (#232 + #230 + the deploy message) merges
as soon as it is reviewed, #229 lands as a second PR, and v1.12.0 is cut when
both are in. There is no reason to hold finished work behind unbuilt work, and
no reason to split the release. The only case for revisiting is if #229 grows a
long tail in review, in which case v1.12.0 cuts with what is ready and #229
becomes v1.13.0 — a decision to defer, not to make now.

## What this does NOT do: mint a key when the page loads

Worth stating because it is the intuitive reading and it is the design that was
rejected. There is **no** flow where the SPA loads, triggers minting, and
receives a key. The browser never holds the key, is never sent it, and never
asks for it.

The key is minted by an explicit action, never as a side effect of a page load:

- `cerefox api-key generate` (or `rotate`), modelled on `token.ts`, writing to
  the resolved `.env` via `upsertEnvVar`.
- Cerefox Local mints it at container boot in `s6/scripts/db-init`, beside the
  JWT secret it already mints, persisted on the data volume.

The browser works because it is on loopback, not because it holds a credential.
And the CLI is untouched by any of this: it never talks to the web server, so
there is nothing for it to read or present.

## Testing

- Unit: the middleware's decision table (loopback vs not, key present/absent/
  wrong, force-key on, `Origin` mismatch).
- **`X-Forwarded-For` changes nothing.** A non-loopback request carrying
  `X-Forwarded-For: 127.0.0.1` is still refused. This is a regression test
  against a plausible future "fix" — someone adding proxy support without
  realising the header is caller-supplied — and the test comment says so, so
  the next reader does not delete it as redundant.
- Integration: the existing `web-integration` suite spawns a real server, so it
  can assert a keyless remote-shaped request is refused and a keyed one is not.
- Explicitly: a test that `/rest/v1/*` is gated too, since forgetting it is the
  most likely way this ships half-done.
