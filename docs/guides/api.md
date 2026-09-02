# The `/api/v1` HTTP API

`cerefox web` serves a JSON API at `/api/v1` alongside the web UI. It was built
as the UI's own backend, and since **v1.11.0** it is also usable by other
clients: any caller can identify itself, so its reads and writes are attributed
to it rather than to the web app.

This guide covers what you need to call it from something that is not the
bundled UI. It is not an exhaustive endpoint reference; the routes live in
`packages/memory/src/web/routes/` and the response shapes are pinned by the zod
schemas in `_shared/schemas/`.

**If you are choosing a surface, read [`access-paths.md`](access-paths.md)
first.** MCP is the right answer for most agents. This API is the right answer
when you want plain HTTP, are already running `cerefox web` (or Cerefox Local),
and do not want an MCP client in the loop.

---

## ⚠ This API is unauthenticated. It is for local access only.

**`/api/v1` has no authentication of any kind.** No token, no session, no
per-route check. Anything that can open a TCP connection to the port can read
every document, edit them, delete them, and permanently purge them.

**Never expose this port outside the machine it runs on.** Not to your LAN, not
through a tunnel, not behind a reverse proxy that does not add authentication of
its own. There is no setting that makes it safe to do so, and a proxy that only
adds TLS adds nothing here: encryption is not authorization.

The surface is designed for **local callers only**:

- an agent or bot harness running on the same machine,
- the bundled web UI in your own browser,
- your own scripts on localhost.

Both supported deployments bind loopback by default and mean it:

- `cerefox web` binds `127.0.0.1`.
- Cerefox Local publishes its container port to `127.0.0.1`
  (`CEREFOX_LOCAL_BIND` exists for the case where you have decided otherwise
  and accept what follows).

`--host 0.0.0.0` and a wider `CEREFOX_LOCAL_BIND` are decisions with a blast
radius, not conveniences. If you need Cerefox reachable over a network, use the
Edge Functions: that is the surface built for it, and it authenticates every
request in-function against a Cerefox access token.

*Adding a locally generated key to this surface is tracked as
[#229](https://github.com/fstamatelopoulos/cerefox/issues/229). Until it ships,
the loopback interface is the whole security boundary.*

---

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

Authentication for this surface is a separate problem and is tracked as
[#229](https://github.com/fstamatelopoulos/cerefox/issues/229). A key, when it
ships, will prove that a caller is allowed to talk to this server; it will not
prove the caller is who it says it is, and these fields will remain labels.

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
`409`; sending neither returns `400` with `CEREFOX_TOKEN_REQUIRED`. Read, then
modify, then write with the token you read.

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
| Authentication | None | None locally; token or OAuth remotely |

If an agent is doing the calling, MCP is usually better: the tools carry their
own documentation, and `cerefox_get_help()` keeps the conventions in front of
the model. Reach for the API when the caller is a program you are writing
yourself, or when you want one transport for a harness that already speaks
HTTP.
