# Iteration 46 — the SPA after an upgrade, and what the tab says (v1.14.2)

**Status: IN PROGRESS (2026-09-08, branch `fix/spa-stale-index-and-tab-titles`).**
Closes [#252](https://github.com/fstamatelopoulos/cerefox/issues/252) and
[#253](https://github.com/fstamatelopoulos/cerefox/issues/253).

## #252 — a blank page after `self-update`

**What happened.** The maintainer's production client was upgraded to 1.14.1
while their `cerefox web` daemon (1.13.1, started hours earlier) kept running.
Refreshing a deep route showed a blank page; the root loaded fine.

**Why, exactly.** Two independent defects, both invisible in the access log:

1. `server.ts` read `index.html` **once at startup** for the SPA catch-all,
   while `/app/` itself was answered by `serveStatic` from disk. An in-place
   upgrade therefore split the two: the root served the new shell, every deep
   route the pre-upgrade one, which referenced a hashed bundle the upgrade had
   deleted.
2. A missing `/app/assets/*` fell through to that catch-all and was answered
   `200 text/html`. A script tag that receives HTML executes nothing.

**Confirmed from the maintainer's own `web.log`**: at 18:11 and 18:13 a deep
route (`/app/projects/<uuid>/documents`) requested `index-InRztcXr.js` → `200`
(the deleted bundle, answered with HTML); at 18:15 `/app/` requested
`index-BC_iqEHZ.js` → `200` (the real one) and worked; at 18:16 `/app/trash`
went back to the stale bundle. A restart at 19:03 fixed it.

**Fix.** `index.html` read per request, cached on mtime, so an upgrade is
picked up without a restart and the root and deep routes can never disagree.
`/app/assets/*` misses return `404 text/plain`. `self-update` reads the pidfile
and prints the restart command when a daemon is running. `statusDaemon()` now
reports the running server's version, which `cerefox web status` and a new
`doctor` row ("web server") compare against `PKG_VERSION`.

## #253 — browser tab titles

The tab said `Cerefox` on every page. Now each page sets its own, through
`usePageTitle()` (one call per page) over a pure `pageTitle()`.

| Route | Title |
|---|---|
| Dashboard | `Cerefox` |
| Document | the document's title |
| Edit | `Editing: <title>`, with a leading `•` while unsaved |
| Search | `Search: <query>` |
| Project documents | the project's name |
| Help | `Help: <doc title>` |
| the rest | the page's own name |

**Decisions.** The app name is *not* prefixed: tabs truncate from the right, so
`Cerefox: <x>` would make every tab look alike, and the favicon already
identifies the app. The one thing allowed to push the title right is the
**environment label** (`[staging] Trash`), because someone with production,
staging and a local container open needs to see which tab they are about to act
in; production and Cerefox Local report no label and stay clean. Titles are
truncated at 60 characters.

## Tests

- `packages/memory/test/web-integration/spa-serving.test.ts` (new, 5 cases):
  root and deep route serve the same shell; a rewritten `index.html` is picked
  up with no restart; a missing asset is a 404 and not HTML; a real asset still
  has a JavaScript content type; a client-side route still gets the shell.
- `cli-web-daemon.test.ts`: `web status` flags a daemon reporting a different
  version, driven by a stub server. **It must spawn the child asynchronously**:
  `spawnSync` blocks bun's event loop, so an in-process stub cannot answer the
  probe and the daemon reads as "alive but not responding".
- `frontend/src/lib/pageTitle.test.ts` (7 cases) via `bun test src/`.
- Playwright: static page titles, the dashboard, a search query, a document's
  own title, and the environment prefix.

## Verification (staging, 2026-09-08)

- `bun run typecheck` clean; frontend lint clean; `_shared` 610 pass.
- Package suite against staging: **313 pass / 2 skip / 0 fail**.
- Playwright: tab-title specs pass; full run below.
- `doctor` shows the new row: `✓ web server  v1.14.1 on :8030 (pid …)`.

## Release notes for the cut

- Frontend + web server only. No schema, no Edge Function, no `minSchema`
  change: `cerefox self-update` (and `cerefox-local upgrade`) is the whole
  upgrade, and **the daemon must be restarted**, which this release is the
  first to say out loud.
- **#154** (Node baseline) moves again, same reasoning as the last four times.
- Filed but not fixed here: **#254** (`cerefox_search` reports "No results
  found." when the top hit exceeds `max_bytes`).
