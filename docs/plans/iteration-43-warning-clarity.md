# Iteration 43 — say the true thing (v1.12.2)

**Status: COMPLETE** (2026-09-03). Branch: `fix/v1.12.2-container-warnings`.
Target: **v1.12.2**. Docker image only — no npm publish needed (see below).

Closes [#237](https://github.com/fstamatelopoulos/cerefox/issues/237).

Two messages introduced by v1.12.0/v1.12.1 that were **false or misread**. No
behaviour changes; both releases behave correctly. What was wrong is what
Cerefox *said* about itself.

## 1. A false alarm on every boot (#237)

Every Cerefox Local boot printed:

```
⚠  Binding 0.0.0.0 with NO API key configured.
   Every read, write, delete and purge on this server is reachable by
   anything that can connect to port 8000, with no credential.
```

Written for `cerefox web` on a host, where binding `0.0.0.0` really does expose
an unauthenticated API. A container is different in exactly the way v1.12.1
already established: it **must** bind `0.0.0.0` internally (its own loopback is
not the host's, so a narrower bind makes the published port unreachable), and
the boundary that matters is the **publish** address, which the process inside
cannot see.

So it described a correct, safe configuration in alarming terms, on every
single boot, and recommended `cerefox api-key generate` — the wrong command for
a container, and one that without `CEREFOX_API_REQUIRE_KEY=1` reproduces the
v1.12.0 outage.

Suppressed inside containers, for the same reason the loopback exemption is:
**in there the server is not in a position to judge.** `containerGateWarning()`
still fires on the container configuration that IS broken.

The cost of leaving it was not the noise. It was that a false alarm on every
boot teaches people to ignore Cerefox warnings, and there is a real one two
lines away.

## 2. A message that said the opposite of what it meant

`cerefox-local api-key` printed:

> The gate is OFF — this container publishes on loopback, so the bind is the
> boundary and this key is not currently required by anything.

The maintainer read that as *"we still block non-local callers, we just don't
require a key from them"*. That is the **opposite** of the truth: with the gate
off Cerefox checks nothing at all, and every caller that reaches the port is
served. The protection is that Docker publishes on `127.0.0.1` only, so a
remote caller cannot open a connection in the first place — it fails at TCP,
before Cerefox is involved.

Both facts are true simultaneously ("no key required" and "protected"), for
different reasons, and compressing them into one clause lost the reason. The
message now states plainly that Cerefox is not checking credentials, what *is*
protecting the port, and that widening the bind removes that protection — which
is why the key turns on in the same move.

`docs/guides/securing-local-access.md` gained a "what protects the port" column
and a paragraph on the same point.

**Recorded because the lesson generalises**: the maintainer is the person most
familiar with this system, and the wording still misled him. A security message
that is technically accurate but reads as its own opposite is a bug, and the
misreading is the evidence.

## Why the Docker image only

The code change is in `packages/memory/src/web/server.ts`, which ships in both
artifacts — but the only people it affects are those running `cerefox web`
**inside a container**, who get it via the image. A native npm install is
unaffected either way: for them the warning is correct and still fires.

Consequence to be aware of: `cerefox --version` (npm) reports 1.12.1 while
`cerefox-local` reports 1.12.2. Acceptable for a message-only fix; if the skew
is ever unwelcome, publishing npm too is harmless.

## Verification

- `docker/local/smoke-auth.sh` against a freshly built image: **PASS** (both
  cases, 7 assertions).
- A real container booted from that image: the false warning is **absent** from
  the logs, and the legitimate `[db-init] API key gate off …` line is still
  present. Checked in the logs of a running container rather than reasoned
  about — the v1.12.1 lesson.
