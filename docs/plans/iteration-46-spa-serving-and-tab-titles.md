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
identifies the app. Titles are truncated at 60 characters. An environment-label
prefix (`[staging] Trash`) was built and then **removed on the maintainer's
call**: running several instances side by side is their own setup rather than a
general one, and the environment banner already names it on every page. Nothing
in the title depends on the server now, so the hook makes no request.

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

## Review follow-ups (all applied)

- **The restart remedy carried no host or port.** `cerefox web start` defaults
  to 127.0.0.1:8000, so the printed command would have MOVED any daemon bound
  elsewhere — the maintainer's staging daemon listens on :8030, and following
  the advice would have replaced a blank page with a connection refused. One
  `restartCommand(host, port)` in `daemon.ts` now serves all three call sites.
- **An unreadable `index.html` answered `200` with an empty body**, which is
  the same lie as the wrong-typed 200 this iteration exists to remove. It is a
  503 with a sentence.
- **The mtime-only cache key** could miss a same-mtime replacement (npm and tar
  preserve tarball mtimes; some filesystems store whole seconds), resurrecting
  the bug. Keyed on mtime AND size.
- **`doctor` printed the client's version when the server reported none**, i.e.
  the check invented the very number it exists to compare. Now a warning.
- **A stale pidfile was a warning**, so a leftover file from a reboot failed
  `doctor --strict` during release verification. Now `skipped`.
- **`self-update` warned even when the daemon was already current.** Gated on
  the version actually differing.
- **The SPA test wrote into the shipped build artifact** with only `afterAll`
  to restore it. Restored in a `finally` plus signal handlers.
- **`dirty` on the edit page ignored metadata and project membership**, so the
  tab's one unsaved-work signal said "saved" during a metadata-only edit.

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

## #254 — search reported an empty store when nothing fit the budget

**How it surfaced.** An agent searched for a contact document it had every
reason to expect, got `No results found.`, and told the maintainer the store
did not have it. The maintainer ran the identical query in the web UI and got
the document at the top. The agent then produced a matrix of its own calls and
correctly picked `max_bytes` as the suspect.

**Cause.** `cerefox_search` returns whole documents. `applyByteBudget` walks
the rows in rank order and stops at the first that does not fit, so a top hit
larger than the budget empties the result set, and the handler's next line
returned `No results found.` The `truncated` flag was computed correctly and
never reached the caller, because the empty check returned first. The web UI
has no byte budget, which is why the same query looked fine there: the RPC and
the ranking were never in question.

Reproduced on staging before the fix: the same query returned 30,731 chars with
no budget, and the literal string `No results found.` at 15,000, 6,000 and 400.

**Why it ranks above a formatting bug.** "No results found." is the one answer
an agent acts on irreversibly: it stops searching, tells the user the knowledge
is absent, and often re-creates the document. Iteration 28I added
`below_confidence` for exactly this reason from the other direction — a weak
match must not be reported as an empty set. This was the same failure through a
different door.

**Fix.** Degrade instead of vanishing. When results matched but none fit, the
tool returns their headers (title, id, score, size, hash), the reason, and the
remedy; the header list is itself held to the same budget. A partial fit now
names the documents held back rather than only counting bytes. `No results
found.` is reserved for a genuinely empty match. The same treatment is applied
in the `cerefox-search` Edge Function (`matched` and `degraded` fields, so
GPT Actions sees the difference too; OpenAPI block 4.0.0 → 4.1.0), and
`cerefox_metadata_search` re-asks without content before reporting nothing,
because the RPC enforces its budget with the same stop-at-first-oversized-row
shape. The usage log records the matched count, so a budget-wiped search no
longer reads as an empty store in analytics either.

**Consequence for the release.** 1.14.2 now includes an Edge Function change,
so the upgrade is `cerefox self-update` **plus** `cerefox server deploy
--functions-only`, not the client-only story it was before.

## #257 — the degraded response, reviewed after the cut (v1.14.3)

The review of the #254 fix landed after 1.14.2 was already tagged, and it found
a regression the fix had introduced. The Edge Function's degraded projection
stripped `full_content`, which is a column of `cerefox_search_docs` (mode
`docs`) only: `cerefox_hybrid_search` and the FTS path return `content`, so in
those modes the rest-spread copied every matched chunk **with its text** while
the response reported `degraded: true` and a note saying content was omitted.
Measured on staging with `match_count: 20` and `max_bytes: 3000`: docs 14.7 KB,
hybrid 69 KB, fts 83 KB — the last two carrying full content.

The header list was never capped either, on any surface, so even the correct
`docs` mode answered a 3 KB budget with 14.7 KB.

Fixed: both content columns stripped, the degraded list held to `max_bytes`
(Edge Function, `cerefox_search`, and the `cerefox_metadata_search` fallback),
the 28I below-confidence flag carried into the degraded lead so weak candidates
are never presented as confident matches, the truncation footer capped at five
named documents plus a count, the metadata path logging what matched, and the
Edge Function's orphaned JSDoc and stale response contract corrected.

**Lesson.** The fix for a "reports nothing" bug is a new response shape, and a
new response shape has to be checked in every mode the tool offers. The
original change was verified in `docs` mode alone, which is the one mode where
the column name made it correct.

## v1.14.3 — one subject, seven review rounds

What began as #254 (a search that reported "No results found." when the top
hit exceeded `max_bytes`) turned into the longest review thread of the project.
Recording it in full, because the *shape* of the sequence is the lesson.

| # | Found | The defect |
|---|---|---|
| #257 | review, after 1.14.2 was cut | The degraded reply stripped `full_content` only. `cerefox_search_docs` returns that column; the chunk RPCs return `content`, so `hybrid`/`fts` shipped 83 KB of chunk text against a 3 KB budget while the response said content had been omitted. |
| #259 | review of the #257 fix | The same asymmetry in the renderer: `hybrid` and `fts` had been returning **titles with empty bodies** over MCP since the handlers moved into `_shared/`. |
| #261 | review of the #259 fix | Chunk results were indistinguishable — several chunks of one document rendered identical headings, visible only once bodies printed. |
| #263 | review of the #261 fix | The truncation footer, now informative, was appended *over* the budget it reported on: 2,830 bytes against 2,000. |
| #265 | review of the #263 fix | **The root cause.** The budget was measured in `JSON.stringify(row)` bytes while the tool returns rendered markdown, so reserving rendered bytes from a JSON budget guaranteed nothing. The below-confidence preamble was counted by nothing at all and overran even without truncation. |
| #266 | review of the #265 fix | A reply could hold results back **silently** when the footer did not fit; an oversized top hit ended the scan and suppressed smaller results that fit; `max_bytes` was unsanitised, so `NaN` bypassed every check. |
| #267 | review of the #266 fix | The same two holes in `cerefox_metadata_search`, which shares the unvalidated stdio transport, plus a zero-budget flip introduced by the previous fix. |

**Why it went so deep.** Four of these were defects in the *correction*, not in
the original code. Each fix added something to the response — a footer, a
section path, an id, a warning — and nothing measured what the response
actually was. The example-based tests passed through all seven, every time,
because each used inputs where the extra bytes happened to fit.

**What ends it.** `_shared/__tests__/search-budget-invariant.test.ts` asserts
the property rather than the examples: budgets × row sizes × row counts ×
**row shapes** (chunk, docs, below-confidence, and rows that are small as JSON
and wide as markdown), 517 cases. Each round made it stricter, and each
stricter version caught the next round's bug in advance. The seventh review
independently fuzzed the fitting loop with 10,000 randomised cases and found
no silent truncation, no mis-stated counts, and no overrun outside the
documented exception.

**The contract, now written down** (`docs/guides/response-limits.md`):

1. A reply is never "no results" when results matched. If nothing fits, it
   lists what matched, without content.
2. A reply never hides that results were held back.
3. A reply stays inside `max_bytes`, except by the framing that cannot be
   dropped without misleading the caller (the "N of M shown" notice, the
   below-confidence advisory). That framing is never traded for content.
4. A result that does not fit is skipped, not treated as the end of the list,
   so the returned set is not necessarily a rank prefix.

**Also in 1.14.3**: the 2026-09-08 dependency advisories. `hono` → `^4.13.7`
and `js-yaml` → `^4.3.2` by override (the hono set includes a `parseBody()`
advisory, and the web server reaches `parseBody`); `adm-zip` and `sharp`
accepted with reasoning in `docs/specs/security-audit-1.0.md`, since the
former has no fixed release and the latter's fix is outside the range
`@huggingface/transformers` pins.

## Release notes for the cut (v1.14.3)

- `cerefox self-update` **and** `cerefox server deploy --functions-only`: the
  `cerefox-search` Edge Function changed. No schema change, no `minSchema`
  change.
- Staging already runs the fixed function (deployed from the branch during
  verification), so it is ahead of `main` until the cut.
- **#154** (Node baseline) moves again, for the sixth time.

---

## v1.14.4 — finishing the sweep the reviews stopped short of (#268)

The seven review rounds behind 1.14.3 were stopped by decision, not because
they had converged. Post-release verification against staging asked the
obvious follow-up question — *which surfaces were never swept?* — and found
two, both reachable by an agent and both silent.

**What the release verification actually covered.** All suites green
(`_shared` 1143, package 313/2/0, live EF 23, remote MCP 26, Playwright
23/23), plus live probes of the contract on real data: four modes × six
budgets × hostile inputs, on the local MCP, the remote MCP and the search
Edge Function. Rule 4 needed a constructed fixture, because staging's own
corpus ranks its smallest document first and so cannot exercise a skip; with
one oversized document ranked above two tiny ones, the two small rows came
back and the big one was named as skipped. 1.14.3 itself is sound.

**What was missed.** `cerefox_metadata_search` and its Edge Function answer
the same question — *which documents match?* — and neither had the guarantees
the search path now has. The database applies `p_max_bytes` by stopping at the
first document whose content does not fit, so an oversized first row emptied
the reply: `[]` from the Edge Function, "No documents match" from the tool.
The tool's degraded branch fires only on `rows.length === 0`, so a *partial*
cut — one document returned where five matched — was reported as a complete
answer. And `max_bytes` was unsanitised on the Edge Function, the same
`NaN` → `p_max_bytes NULL` → *no limit* hole #267 closed on the search tool,
in the file whose `limit` two lines above **was** sanitised.

**Decisions.**

- **The Edge Function keeps its bare-array shape.** An envelope would match
  `cerefox-search` and carry a notice field, but Custom GPTs are configured
  against the documented array, and a shape change is not a patch-release
  matter. Instead the array is made *complete*: every matching document is
  listed and only content is negotiable, marked `content_omitted: true`. The
  count is then structural — `results.length` is the truth — and no notice
  field is needed.
- **The partial case costs one extra probe, and only when it can say
  something.** The count is resolved with the same content-free query the
  empty branch already used, skipped when the page is full or no budget was
  set.
- **The guard is derived, not a list.** Surfaces are found by how each layer
  reads caller input (`args` / `body` / `options`), so a new one is policed on
  the day it is written. Proven to fire by reverting the real fix, not only
  against a synthetic string — two static checks in this project once passed
  vacuously.

**Checked before fixing** (the maintainer asked, and it changed the write-up):
the Decision Log records `p_max_bytes` on metadata search as using "the same
whole-row-drop model as `cerefox_search_docs`", so parity with the search path
was always the intent. The 2026-03-20 entry does say "Web UI/CLI = no
truncation" — but **v0.10.2** deliberately reversed that for the CLI and
corrected `CLAUDE.md`, leaving `docs/guides/response-limits.md` stale for three
months until 1.14.3 cited it as the contract. The guide was the drift, not the
code.

### Release notes for the cut (v1.14.4)

- `cerefox self-update` **and** `cerefox server deploy --functions-only` — the
  `cerefox-metadata-search` Edge Function changed. No schema change, no
  `minSchema` / `minEdgeFunctions` change.
- GPT Actions OpenAPI block → **4.3.0** (additive response field).
- **#154** (Node baseline) still waiting; seventh deferral.
