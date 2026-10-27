# Using the web UI on a gated server (#346)

**Status: DESIGN, revised after Codex round 1, 2026-10-27.** Target v1.20.0 (minor, additive). No schema or
Edge Function change.

## The problem

Cerefox can now run on a machine on the home or office network rather than on
the machine you sit at: a NAS, a mini PC, a home server. Two shapes:

- **(a) Web UI container, cloud backend.** `cerefox web` in a container on the
  LAN host, using the operator's Supabase project.
- **(b) Cerefox Local on a LAN host.** The all-in-one `cerefox-local` image on
  that host instead of on localhost.

Both need the API key gate on (`CEREFOX_API_REQUIRE_KEY=1`). Inside a container
every caller looks remote, because Docker rewrites the source address of
published-port traffic, so the loopback exemption cannot apply
(`containerGateWarning` in `web/auth.ts`). A container published on the LAN with
the gate off gives anyone on the network full read and write access; in shape
(a) that is the operator's cloud store, through the server's Supabase secret key.

With the gate on, agents, the CLI and curl work: they send
`Authorization: Bearer <key>`. The web UI does not. `/app/` loads (static files
are not gated), then every `/api/v1` call returns 401, because the SPA has no way
to hold or send a key. `api-auth-design.md` assumed the browser is always on
loopback and never holds a credential, and rejected a key prompt for that case.
This design adds the prompt for the case that assumption does not cover, and
only for it. v1.19.6 (#343) fixed the other half: before it, a gated Local
container could not reach its own data at all.

A third shape gets the same fix for free: a native `cerefox web --host 0.0.0.0`
with a key, opened from another machine.

## The design

**When the server refuses the browser with the Cerefox challenge, the web UI
asks for the API key, keeps it in the browser, and sends it as
`Authorization: Bearer` on every API call.**

1. **Trigger: a 401 carrying `WWW-Authenticate: Bearer realm="cerefox"`.** That
   header is set only by `apiAuth()`, so no other 401 can open the prompt. A
   browser on loopback with the gate off is never refused and never sees the
   prompt: no change for any existing install.
2. **The prompt** is a modal over the app shell: one password field, a
   "Remember on this browser" checkbox (off by default), a short line on where
   to find the key (`cerefox api-key show`, `cerefox-local api-key`, or the
   value the operator injected as `CEREFOX_API_KEY`). It validates by calling
   `GET /api/v1/version` with the key: 200 stores it and refetches every query,
   401 shows "That key was not accepted" and keeps the dialog open. No new
   server endpoint.
3. **Storage.** `sessionStorage` by default (gone when the tab closes);
   `localStorage` when "Remember" is ticked. Both are scoped to the exact origin
   (scheme, host **and port**), which matters on a NAS that serves several apps
   from one address. Every read and write is wrapped in try/catch: a browser
   that blocks storage gets a key that lives in memory until reload.
4. **One fetch path.** Every call goes through `apiRequest` in
   `frontend/src/api/client.ts` (which `apiFetch` and `apiFetchResponse` wrap).
   It adds the header when a key is held, and sets the JSON content type
   **only when the body is not a `FormData`**, so the browser still writes the
   multipart boundary for uploads. The raw `fetch` sites (`api/docs.ts` ×3, the
   `IngestPage` file upload) move onto it. A browser-free source scan (like
   `no-event-in-updater.test.ts`) fails if a bare `fetch(` appears anywhere else
   in `frontend/src`.
5. **Links that cannot carry a header.** A plain `<a href="/api/v1/…">` is a
   browser navigation and sends no `Authorization`. Four sites do this: the
   document download (current and per-version, `DocumentPage` ×3), the usage
   CSV export (`AnalyticsPage`) and the raw doc link on the Help page, the first
   two built by helpers (`getDownloadUrl`, `getUsageExportUrl`). They become
   buttons that fetch through the client and save (or open) the resulting blob;
   the Help page opens the text it already loaded. The helpers that returned a
   URL are removed, and the source scan fails on any `/api/v1` string literal
   outside `api/client.ts` except as a comment.

   **Links inside a document.** `MarkdownLink` passes an absolute link through,
   so a document that links to `/api/v1/…` would navigate without the key. Such
   a same-origin `/api/v1/` link is fetched through the client and opened as a
   blob instead. The key is never attached to any other URL, same-origin or
   not. A markdown **image** whose source is `/api/v1/…` still loads without
   the key and fails on a gated server; no endpoint serves images, so that is
   documented rather than handled.
6. **A stored key that stops working** (rotated, or the container recreated
   with a new one): the next challenge 401 clears it and reopens the prompt
   with "The saved key was not accepted".
7. **Requests stop while the prompt is open.** With no key held and the prompt
   showing, `apiRequest` refuses locally without touching the network, so
   polling (`SchemaVersionBanner` every 60 s, `UpdateBadge`) and React Query's
   retry cannot produce a stream of 401s. Retries also skip
   `AuthRequiredError`. When the key is accepted, every query is reset and
   refetched, and the one non-query read at boot (`useThemePreference`, which
   fetches preferences once on mount) reruns when a key appears.
8. **Forgetting the key.** When a key is held, the header shows a "Forget key"
   item. It clears both storages and the query cache, and the next call brings
   the prompt back.

### Why a header and not a cookie

A session cookie (`POST` the key once, receive an `HttpOnly` cookie) keeps the
key away from page script and makes the plain download links work unchanged. It
was rejected for two reasons specific to this deployment:

- **Cookies are not isolated by port.** A NAS typically serves its own admin UI
  and other apps from the same address on other ports. A cookie for that host is
  sent to every one of them whose paths match, and any of them can overwrite it.
  `sessionStorage` and `localStorage` are per origin, port included.
- **An ambient credential needs CSRF defenses** (`SameSite`, an `Origin` check on
  every state-changing route), and `SameSite` treats the other ports on the same
  host as the same site. A header is never attached by the browser on its own,
  so a cross-origin page cannot use it: the server sends no CORS headers, and a
  custom `Authorization` header needs a preflight it will not pass.

### What the key in the browser costs

Today the browser holds nothing, so the page has nothing to steal. With this
change, on a gated server, the key sits in the origin's storage, readable by any
script that runs on the Cerefox origin. That is the trade, stated plainly:

- **It is opt-in.** Only a server that refused the browser causes a key to be
  stored, and only after the user types it.
- **The SPA has no HTML injection sink today**: `react-markdown` without
  `rehype-raw` (raw HTML in a document is escaped), no `dangerouslySetInnerHTML`,
  no `innerHTML`. Because the page now holds a secret, the source scan also
  fails on any of those, so adding one becomes a deliberate act with a review.
- **The key never goes into a URL**, a query string, a log line or an error
  message. The server's request logger prints method and path only.
- **Plain HTTP on a LAN sends the key in clear**, exactly as it already does for
  every agent and curl call. The guide says so and points at the existing
  reverse-proxy-with-TLS recipe (which already requires the gate).

### Out of scope, filed separately

- **The `Origin` check that `api-auth-design.md` planned was never built.** It
  defends the loopback, gate-off case: a malicious page in the user's browser
  posting to `127.0.0.1`. It does not affect this design (no ambient credential
  on a gated server), so it gets its own issue rather than riding along.
- **A browser sign-in with accounts.** Cerefox is single-user; one key is the
  whole model.

## Packaging

**(b) Cerefox Local on a LAN host.** No image change. Docs: a "LAN or NAS
deployment" section in `docs/guides/setup-local.md`, cross-linked from
`securing-local-access.md`: publish one port, `CEREFOX_API_REQUIRE_KEY=1`,
inject a known key with `CEREFOX_API_KEY` (for hosts whose GUI gives no shell to
read the minted one), a compose file for GUIs that take one, and loading the
image from a `docker save` tar on hosts that cannot pull from ghcr.io.
`smoke-auth.sh` gains: `/app/` is served without a key under the gate (the SPA
must load to show the prompt), and a hashed asset it references is a 200.

**(a) Web UI container.** The root `Dockerfile` (marked untested, never
published) becomes a supported image:

- a `CEREFOX_VERSION` build argument, defaulting to the release being built, so
  an image is reproducible;
- runs as the image's non-root `node` user;
- **refuses to start without `CEREFOX_API_KEY`**, and sets
  `CEREFOX_API_REQUIRE_KEY=1` unless the operator sets it. This image exists to
  be reached from other machines, and inside a container a key without
  require-mode cannot work (`containerGateWarning`). The one escape hatch is
  `CEREFOX_WEB_NO_KEY=1`, for an operator who protects the service another way
  (Cloud Run IAM, an authenticating proxy); the image logs that choice at boot;
- **this is a deliberate break for the Cloud Run recipe.** `setup-cloud-run.md`
  builds this Dockerfile and deploys it `--allow-unauthenticated` with no key,
  which today leaves a write-capable Cerefox open to the internet. After this
  change a redeploy from the new Dockerfile without a key fails to start, with
  a message saying what to set. The guide's deploy and "Updating" steps gain
  `CEREFOX_API_KEY` (from Secret Manager), and the CHANGELOG lists it under
  "Changed" with the migration;
- the `HEALTHCHECK` sends the key from the container's own environment, since
  an unauthenticated probe always gets a 401 under the gate;
- a Node floor check, like the Local image's Bun floor (`MIN_BUN`);
- a manual-dispatch workflow, `web-image.yml`, publishing
  `ghcr.io/<owner>/cerefox-web`, gated on a smoke test (no key → 401, key → 200,
  `/app/` served, refuses to start keyless). Publishing is a release decision,
  like the Local image.

`setup-cloud-run.md` uses the same Dockerfile and gets the gate added to its
steps.

## Testing

- **Frontend unit** (`frontend/src/lib/*.test.ts`, browser-free): the key store
  (session vs local, storage throwing, forget), challenge detection (401 with
  the realm opens the prompt; a 401 without it and a 403 do not), and the client
  with a stubbed `fetch`: header present only with a key, no JSON content type
  on a `FormData` body, a stored key dropped on a challenge, **no network call
  while the prompt is open** (bounded request count under concurrent
  challenges), recovery after a key is set, `filenameFrom` on both
  `Content-Disposition` forms.
- **Source scan:** no bare `fetch(` outside the client, no `/api/v1` literal
  outside it (which also catches a helper that builds a URL), no
  `dangerouslySetInnerHTML` / `innerHTML` / `rehype-raw` / `urlTransform`
  override. Each rule has a fixture that must trip it, so the scan cannot pass
  by matching nothing.
- **Playwright, gated:** a second web server in `playwright.config.ts` started
  with `CEREFOX_API_REQUIRE_KEY=1` and a test key, and a spec that: sees the
  prompt; rejects a wrong key; accepts the right one and loads the dashboard;
  searches, opens a document, downloads it, uploads a file; reloads (session:
  still in, until the tab closes); a stored key that the server no longer
  accepts brings back the prompt with the "not accepted" notice; forgets the
  key and gets the prompt back. The gated and ungated specs run against
  separate servers on separate ports, and the existing ungated suite must not
  see a prompt anywhere.
- **Server unit:** none new (the gate is unchanged); a regression test that a
  gated server still serves `/app/` and its assets without a key.
- **`smoke-auth.sh`** additions above; the new web-image smoke test, which
  also checks the container reports `healthy` and that a keyless start exits
  with the message.
- **Reference deployment (manual acceptance, #346):** a `cerefox-local` amd64
  container on an x86-64 consumer NAS, image loaded from a tar, one published
  port, gate on with an injected key. From another machine: no key and wrong
  key → 401, right key → 200; the browser prompts once and then dashboard,
  search, document view, download, ingest, edit and delete work; a wrong key in
  the prompt is refused cleanly; forgetting the key brings the prompt back; a
  container recreate with the same key keeps the browser working.

## Review log

**Codex round 1 (2026-10-27, about 76K tokens): "revise first".** Claims 1, 3, 4
and 5 held. Changes made from the rest:

| # | Finding | Severity | Change |
|---|---|---|---|
| 2 | Markdown links to `/api/v1` and markdown images bypass the client | Medium | Same-origin `/api/v1/` links go through the client; images documented as unsupported |
| 6, 9 | Moving the upload onto the client would send a JSON content type | Medium | `FormData` bodies get no content type (point 4); gated upload test |
| 7 | A keyless Cloud Run deployment breaks on upgrade | High | Kept as a deliberate break with a migration, an escape hatch (`CEREFOX_WEB_NO_KEY=1`), guide and CHANGELOG updates |
| 8 | Test plan misses stored-key invalidation, bounded requests, helper-built URLs | Medium | Requests stop while the prompt is open (point 7); tests and scan fixtures added |
| 10 | The image healthcheck gets a 401 under the gate | Medium | Healthcheck sends the key from the environment; smoke test checks `healthy` |
| 11 | `useThemePreference` reads once on mount and never recovers | Medium | It reruns when a key appears |
