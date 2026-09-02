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

## Read this before you expose it

**`/api/v1` has no authentication.** There is no token, no session, and no
per-route check. Anything that can reach the port can read, write, and delete
every document in the store.

That is a deliberate consequence of how Cerefox is deployed, not an oversight
to route around:

- `cerefox web` binds `127.0.0.1` by default.
- Cerefox Local publishes its container port to `127.0.0.1` by default
  (`CEREFOX_LOCAL_BIND` opts into a wider bind).
- Both assume a single-user machine, where the boundary is the loopback
  interface.

So: **do not publish this port to a network you do not control**, do not put it
behind a reverse proxy without adding authentication of your own, and treat
`--host 0.0.0.0` as a decision rather than a convenience. If you need a
network-reachable Cerefox, the Edge Functions are the surface designed for it
(they authenticate in-function against a Cerefox access token).

---

## Identifying your client

By default every call is recorded as the web app: author `web-ui`, author type
`user`, access path `webapp`. Supply an identity and it is recorded as you.

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

Nothing verifies an identity claim, here or anywhere else in Cerefox. MCP takes
`author` as a client-declared string; the Edge Functions accept whatever
`requestor` arrives. These fields exist so a trail is *legible*, not so it is
*provable*. On an API with no authentication at all, the identity you send is a
label you chose, and it should be read that way.

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

### Content updates need a concurrency token

Anything that changes a document's content requires the `content_hash` you read
it at, as `expected_content_hash`, or an explicit `last_write_wins`. A stale
hash gets a `409`; omitting both gets a `400` with `CEREFOX_TOKEN_REQUIRED`.
This matches every other Cerefox surface; see the MCP guidance in
`AGENT_GUIDE.md` for the read → modify → write loop.

`POST /documents/{id}/upload` is the exception: replacing a document wholesale
from a file is a re-sync, so it defaults to last-write-wins. Pass
`expected_content_hash` as a form field if you want the checked path.

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
