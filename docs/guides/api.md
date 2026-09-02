# The `/api/v1` HTTP API

`cerefox web` serves a JSON API at `/api/v1` alongside the web UI. It was built
as the UI's own backend, and since **v1.11.0** it is also usable by other
clients: any caller can identify itself, so its reads and writes are attributed
to it rather than to the web app. Since **v1.12.0** it is authenticated for
callers that are not on the same machine (see below).

This guide covers what you need to call it from something that is not the
bundled UI. It is not an exhaustive endpoint reference; the routes live in
`packages/memory/src/web/routes/` and the response shapes are pinned by the zod
schemas in `_shared/schemas/`.

**If you are choosing a surface, read [`access-paths.md`](access-paths.md)
first.** MCP is the right answer for most agents. This API is the right answer
when you want plain HTTP, are already running `cerefox web` (or Cerefox Local),
and do not want an MCP client in the loop.

---

## Security posture: local by default, key for anything else

Since **v1.12.0** this surface has an authentication gate, and the rule is
short:

> **Requests arriving on the loopback interface (127.0.0.1) are allowed without
> a credential. Requests arriving on any other interface must present the
> server's API key.**

### Why it is built this way

The attacker worth defending against can reach the port but has no read access
to your filesystem: another machine on the network after someone widened the
bind, a container on a shared Docker network, a malicious page in your browser.
An attacker who already has filesystem access can read the key, the `.env` and
your database credentials, so demanding a key from them would achieve nothing.
On a single-user machine, loopback access and key-file access are the same
trust boundary.

The practical result is that **nothing local needs configuring**. The web UI,
an agent on the same machine, your own scripts: all keep working exactly as
before, with no key and no prompt. The browser in particular never holds a
credential, which is deliberate — the SPA is a static file, so a key embedded
in it could be read by anything that can load the page.

### What this does NOT protect

**Anything already running on your machine.** Any local process can reach a
loopback port. The gate is about the network boundary, not about isolating
programs from each other.

**A same-host reverse proxy.** If you put nginx or Caddy in front of Cerefox on
the same machine, it reconnects from `127.0.0.1`, so every forwarded request
looks local and is exempt. `X-Forwarded-For` is deliberately **never** consulted
to recover the original address: that header is set by the caller, so trusting
it would let anyone claim to be local. If you front Cerefox with a proxy, set
`CEREFOX_API_REQUIRE_KEY=1`, which demands the key from every caller including
loopback.

**Confidentiality on the wire.** There is no TLS here. The key authenticates;
it does not encrypt.

### Getting and using a key

```bash
cerefox api-key generate     # mint one, written to your .env, printed once
cerefox api-key show         # print it again, in full
cerefox api-key rotate       # replace it (remote clients must be updated)

cerefox-local api-key            # Cerefox Local: print the container's key
cerefox-local api-key --rotate   # mint a new one and restart
```

Cerefox Local mints its key automatically at first boot and persists it on the
data volume, so it survives `cerefox-local upgrade`. `cerefox web` mints
nothing on its own: until you run `api-key generate` there is no key, and the
server behaves exactly as it did before v1.12.0. That is intentional, so
upgrading never breaks a working setup.

A remote caller presents it as a bearer token:

```bash
curl http://<host>:8000/api/v1/documents/<uuid> \
  -H 'Authorization: Bearer cfx_lak_…' \
  -H 'X-Cerefox-Requestor: my-bot'
```

Without a valid key the server answers `401` with a `WWW-Authenticate: Bearer`
challenge and a `detail` explaining what to do.

### Still: do not put this on the internet

A key makes a widened bind survivable. It does not make this surface an
internet-facing API. There is no TLS, no rate limiting, no per-client scoping,
and no revocation beyond rotating the single key. If you need Cerefox reachable
over a network you do not control, use the Edge Functions: that is the surface
built for it.

## Identifying your client

By default every call is recorded as the web app: author `web-ui`, author type
`user`, access path `webapp`. Supply an identity and it is recorded as you.

**This identity is declared, not verified.** It is a label the caller chooses,
recorded for attribution and record-keeping: so the audit trail says which
harness wrote a document, so usage analytics can tell your bot's reads from the
web app's, and so an agent-authored ingest is queued for review. It is not a
credential, it grants nothing, and nothing checks it. See
[Attribution is not authentication](#attribution-is-not-authentication) below
before relying on it for anything else.

Three optional fields:

| Field | Header | Recorded as | Default |
|---|---|---|---|
| author | `X-Cerefox-Author` | `cerefox_audit_log.author` on writes | `web-ui` |
| requestor | `X-Cerefox-Requestor` | `cerefox_usage_log.requestor` on reads and writes | `web-ui` |
| author type | `X-Cerefox-Author-Type` | `cerefox_audit_log.author_type` | `user` |

`author_type` must be `user` or `agent`. Anything else is a `400` naming the
two valid values.

**Headers work on every method.** A `GET` cannot carry a body, and reads are
half the point of attribution, so headers are the primary mechanism. Endpoints
that take a JSON body (or a multipart form) also accept the same three as
fields in it, for clients that find that more natural. If both appear, the
header wins.

```bash
# A write, attributed
curl -X POST http://127.0.0.1:8000/api/v1/ingest \
  -H 'Content-Type: application/json' \
  -H 'X-Cerefox-Author: my-bot' \
  -H 'X-Cerefox-Author-Type: agent' \
  -d '{"title": "Meeting notes", "content": "# Notes\n\n..."}'

# A read, attributed
curl http://127.0.0.1:8000/api/v1/documents/<uuid> \
  -H 'X-Cerefox-Requestor: my-bot'
```

`author` and `requestor` stand in for each other. They name one actor; MCP
splits them only because reads and writes log to different tables. Supplying
either identifies you for both, so a client that only sets `X-Cerefox-Author`
still has its reads attributed correctly.

### Two consequences worth knowing before you use it

**`author_type: agent` queues your documents for review.** An agent-authored
ingest lands in `pending_review` rather than `approved`, exactly as it does
over MCP. That equivalence is the point of the feature: the same actor is
recorded, and treated, identically whichever transport it used. If you want
your writes approved on arrival, send `user` (or send nothing).

**Identifying yourself changes the access path.** There is deliberately no way
to ask for a particular `access_path`: the server derives it. Supply any
identity field and the operation is logged as `api`; supply none and it is
logged as `webapp`. The reasoning is that `access_path` is the one field in the
usage log the server still sets itself, so accepting it from the caller would
let a client misreport which transport it used. In the Analytics dashboard,
`api` operations count toward the agent total; `webapp` does not.

### Attribution is not authentication

`author`, `requestor` and `author_type` are **declared by the caller and taken
at face value**. Nothing verifies them, here or anywhere else in Cerefox: MCP
takes `author` as a client-declared string, and the Edge Functions accept
whatever `requestor` arrives. Any client can send any name, including a name
another client uses.

They exist for **attribution and record-keeping**: a legible audit trail, usage
analytics that can tell callers apart, and the review-queue behaviour of
`author_type: agent`. They are not a security measure, they do not establish an
authenticated identity, and no access decision is made on them. Treat a name in
the audit log as "what the caller said", never as "who the caller was".

The API key added in v1.12.0 (#229) does not change this. It proves a caller is
*allowed to talk to this server*; it does not prove the caller is *who it says
it is*. A remote client holding the key can still send any `author` it likes.
Authentication and attribution stay separate on purpose — conflating them would
produce a design that does neither well.

`require_requestor_identity` and `requestor_identity_format` do **not** apply to
this surface. They are enforced by the Edge Functions only. See
[`configuration.md`](configuration.md).

---

## Endpoints

Base URL is wherever `cerefox web` is listening (`http://127.0.0.1:8000` by
default; Cerefox Local picks its own port and `cerefox-local status` prints it).

| Method + path | Purpose |
|---|---|
| `GET /version` | Server version and environment label. |
| `GET /schema-version` | Deployed schema version. |
| `GET /search?q=…` | Hybrid search (FTS + semantic). |
| `GET /dashboard`, `GET /dashboard/recent-docs` | Dashboard aggregates. |
| `GET /documents/{id}` | Full document, with metadata, projects and versions. |
| `GET /documents/{id}/chunks` | The document's chunks. |
| `GET /documents/{id}/versions` | Version history. |
| `GET /documents/{id}/download` | Raw markdown. |
| `GET /documents/trash` | Soft-deleted documents. |
| `POST /documents/metadata-search` | Query by metadata / project / time, no text query. |
| `GET /metadata-keys` | Metadata keys with counts and example values. |
| `GET /resolve-link`, `GET /check-filename` | Link and title resolution helpers. |
| `POST /ingest` | Create or update from JSON (`title`, `content`, …). |
| `POST /ingest/file` | Create from a multipart file upload. |
| `POST /documents/{id}/upload` | Replace a document's content from a file. |
| `POST /documents/{id}/edit` | Update title, content, metadata, projects. |
| `DELETE /documents/{id}` | Soft-delete (to trash). |
| `POST /documents/{id}/restore` | Restore from trash. |
| `DELETE /documents/{id}/purge` | Permanent delete. Irreversible. |
| `POST /documents/{id}/review-status` | Approve or re-queue for review. |
| `GET /projects`, `POST /projects`, `PUT /projects/{id}`, `DELETE /projects/{id}` | Project CRUD. |
| `GET /projects/{id}/documents` | A project's documents. |
| `GET /config`, `GET /config/{key}`, `PUT /config/{key}` | Runtime config. |
| `GET /audit-log` | Audit trail, filterable. |
| `GET /usage-log`, `GET /usage-log/summary`, `GET /usage-log/export.csv` | Usage queries. |

Paths are shown without the `/api/v1` prefix for width; every one carries it.
The writes and the two reads that log usage (`/search`, `/documents/{id}`)
honour the identity headers. `/version` needs nothing.

### Every mutation needs a concurrency token

Cerefox uses optimistic locking, and this API is no exception. A content update
requires the `content_hash` you read the document at, as
`expected_content_hash`, or an explicit `last_write_wins`. A stale hash returns
`409` (with `current_hash`, so you can re-read without a second round trip);
sending neither returns `400` with `CEREFOX_TOKEN_REQUIRED`. Read, then modify,
then write with the token you read.

**Check the status code, not just the body.** Every refusal is a real HTTP
status: `400` for a malformed or incomplete request, `409` for a concurrency
conflict, `404` for a missing document, `503` when the embedder is
unavailable. The reason is in the body's `detail` (and, on the ingest routes,
also in `error`, which they have always used). Before v1.12.0 the three ingest
routes answered `200` with `success: false` for a *refused* write, so a client
checking only `resp.ok` read a refusal as a success; that is fixed, and it is
the one response-shape change in v1.12.0.

`POST /documents/{id}/upload` takes the same contract: pass
`expected_content_hash` as a form field, or `last_write_wins=true` if the file
you are uploading is an external source of truth and a conflict is genuinely
meaningless. There is no implicit default.

**Delete follows a read too.** `DELETE /documents/{id}` requires the hash from
an identified caller, as `X-Cerefox-Expected-Content-Hash` or an
`expected_content_hash` query parameter, exactly as `cerefox_delete_document`
requires it over MCP. A caller that sends no identity is the bundled web UI,
which confirms with the human in a dialog instead, and it keeps working
unchanged.

Purge (`DELETE /documents/{id}/purge`) is irreversible and takes no token. It is
reachable by anything that can reach the port, which is another reason the
warning at the top of this guide is not boilerplate.

---

## Choosing between this and MCP

Both surfaces run the same code underneath and write the same rows. The
practical differences:

| | `/api/v1` | MCP |
|---|---|---|
| Transport | Plain HTTP | stdio or Streamable HTTP |
| Client needs | An HTTP client | An MCP client |
| Identity | Optional, defaults to `web-ui` | Per-call `author`/`requestor` |
| Partial edits | `POST /documents/{id}/edit` | `cerefox_insert`, `cerefox_edit` |
| Guidance for agents | This guide | `cerefox_get_help()`, in-band |
| Authentication | None on loopback; API key otherwise | None locally; token or OAuth remotely |

If an agent is doing the calling, MCP is usually better: the tools carry their
own documentation, and `cerefox_get_help()` keeps the conventions in front of
the model. Reach for the API when the caller is a program you are writing
yourself, or when you want one transport for a harness that already speaks
HTTP.
