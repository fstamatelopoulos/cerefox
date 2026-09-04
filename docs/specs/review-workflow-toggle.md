# The review workflow toggle (`review_workflow_enabled`)

**Status: BUILT — v1.13.0 (schema 0.16.0, migration 0031, #241).** Started as
a discussion document (2026-09-03); the decisions below were taken with the
maintainer on 2026-09-03/04 and this file now records what shipped. Companion
fixes shipped in the same release: #240 (filtered search under-returned), #239
(`config list` hid working keys), #235 (live-test timeouts).

## The request

The `review_status` workflow assumes a human operator (or an AI judge) who
reviews everything an agent writes. On plenty of installs — an unattended agent
harness, or any single-operator store where the operator *is* the agent's
owner — nobody is ever going to review anything. So every agent write lands in
`pending_review` and stays there, accumulating a queue that is never drained
and that means nothing. Those installs want the workflow off.

## Summary of what shipped

| | |
|---|---|
| Key | `review_workflow_enabled` (`cerefox_config`, group Governance, high-impact) |
| Fresh install | **`false`** — seeded by `schema.sql` |
| Upgrade | **`true`** — seeded by migration 0031, so nothing changes until the operator flips it |
| Decision point | `cerefox_ingest_document` reads the flag; the six client-side copies of the rule are gone |
| Off contract | `review_status` is **absent** from every read on every surface; `?review_status=` on search is a `400`; `POST …/review-status` is a `404`; every write lands `approved` |
| Stored rows | Never touched by a toggle in either direction |
| `minSchema` | Raised to **0.16.0** (see Versioning) |

## What the review system was before this change

Four facts that shaped the design, each verified in the v1.12 code rather than
assumed. Line references are to v1.12.2.

**1. It does not gate anything.** `review_status` appears **zero times** in
every retrieval RPC: `cerefox_hybrid_search`, `cerefox_fts_search`,
`cerefox_semantic_search`, `cerefox_search_docs`, `cerefox_reconstruct_doc`,
`cerefox_context_expand`, `cerefox_get_document`. No filter, no score
adjustment, no ordering term. `cerefox_metadata_search` *returns* it but never
filters on it. `docs/research/vision.md:287` states this as the original intent
— "The content remains fully searchable in both states. Review status does not
gate access." — and the code matches.

The one exception was not in the database: `discovery.ts:494-515` post-filtered
search results in TypeScript when the caller passed `review_status`, docs mode
only, opt-in. It was the only retrieval-affecting code, and it filtered *after*
the RPC had applied `count`, so a filtered search under-returned — #240, fixed
in this release by moving the filter into the search RPCs. The filter remains
opt-in: an unfiltered search still ignores `review_status`.

This is the single most important fact here: **turning the workflow off cannot
expose anything that was hidden**, because nothing was hidden.

**2. It is one of three governance pillars, and the only one affected.** v0.1.8
shipped "audit log, review status, version archival" together. Disabling review
touches none of the other two: **every write is still audited**, with author and
`author_type`, exactly as before. What stops is the flagging, not the record.

**3. The rule lived in SIX copies of client code, not in the database.**
`cerefox_ingest_document` takes `p_review_status` as a **caller-supplied
parameter** (`rpcs.sql:1425`), and its only logic is a sanitizer, not a policy
(`rpcs.sql:1567-1569`): it accepts whatever it is handed, falling back to
`'approved'` if the value is invalid. The actual decision — "agent writes are
pending" — is the same ternary repeated in:

- `_shared/mcp-tools/ingest.ts:139`
- `_shared/mcp-tools/partial-edits.ts:311`
- `packages/memory/src/ingestion/pipeline.ts:314` (create)
- `packages/memory/src/ingestion/pipeline.ts:570` (update)
- `supabase/functions/cerefox-ingest/index.ts:347`
- `packages/memory/src/ingestion/client-bridge.ts:214` (passes it through)

That is the shape this project has been bitten by repeatedly (the access-path
vocabulary, the compat matrix, `require_requestor_identity`'s nine copies).
All six are gone as of v1.13.0.

**It also means a client-side flag would not actually hold.** Any caller that
reaches PostgREST directly can still pass `p_review_status := 'pending_review'`
and the database will store it, flag or no flag. A switch implemented in the
six ternaries would be a convention, not a rule.

There is also **no `cerefox_set_review_status` RPC**. The manual approve action
is a direct PostgREST table `UPDATE` in the web route
(`documents-write.ts:437-441`), with its own audit entry. That is a second,
separate write path this design has to account for.

**4. The mechanism to build this already exists.** `cerefox_config_bool(key,
fallback)` is in `rpcs.sql:2635+`, and `rpcs.sql:941-944` shows the exact
pattern in use:

```sql
v_cleanup BOOLEAN := COALESCE(p_cleanup_enabled,
                              cerefox_config_bool('version_cleanup_enabled', TRUE));
```

with the comment at `rpcs.sql:2696` stating the principle outright: a store
setting read here "governs EVERY access path (CLI, local + remote MCP, Edge
Functions, web), because they all resolve through these RPCs."

## Design

### The flag

| | |
|---|---|
| Key | `review_workflow_enabled` |
| Kind | boolean |
| Default | `false` on a **fresh install** (seeded by `schema.sql`); `true` on an **upgraded store** (seeded by migration 0031) — an upgrade never changes behaviour on its own |
| Group | `Governance` |
| `highImpact` | yes, so the web UI asks for confirmation before toggling |

Stored in `cerefox_config` like every other store setting, **not** an
environment variable. Review status is a property of the store: two clients
pointed at one database must not disagree about whether the workflow exists.
This is the same reasoning that moved `min_search_score` and
`version_retention_hours` out of the environment in v1.1.0.

**On the two defaults.** The maintainer chose `false` for fresh installs: most
single-operator stores never review anything, and a queue that is never drained
is worse than no queue. The upgrade seed is `true` because an upgrade must not
silently change what a store does. The cost — "the default depends on when you
installed" — is paid once, in the docs; `cerefox doctor` prints the current
state so nobody has to remember it.

**On the name.** `review_workflow_enabled` joins the `_enabled` family
(`usage_tracking_enabled`, `version_cleanup_enabled`, `relations_enabled`) and
reads naturally as a feature switch, which is what it is. The alternative,
`agent_writes_require_review`, describes the server-side rule more precisely
but reads oddly in the UI and under-describes the client behaviour the flag
also governs. Worth a moment's disagreement before we commit; renaming a config
key after release is a migration.

### Enforcement: in the RPC, once

`cerefox_ingest_document` decides the status, and the four client ternaries are
deleted:

```sql
v_review_on BOOLEAN := cerefox_config_bool('review_workflow_enabled', FALSE);

v_status := CASE
    WHEN NOT v_review_on            THEN 'approved'
    WHEN p_author_type = 'agent'    THEN 'pending_review'
    ELSE 'approved'
END;
```

Three things follow, and they are the argument for doing it this way:

- **One implementation.** Every transport — CLI, local MCP, remote MCP, all 9
  Edge Functions, the web API — inherits it, because they all go through this
  RPC. Contrast `require_requestor_identity`, which is nine near-identical
  copies and consequently does not apply to the local MCP server, `/api/v1`, or
  the CLI. `CLAUDE.md` already records that as the thing not to repeat.
- **Old clients get the new behaviour for free.** A v1.12 client talking to a
  server with the flag off gets approved documents without being upgraded,
  because it no longer decides. That is worth a lot for a fleet of agents.
- **It fixes a pre-existing duplication** rather than adding a fifth copy.

`p_review_status` is kept on the RPC signature, **accepted and ignored**, and
documented as deprecated — removing a parameter is a breaking RPC signature
change for the sake of tidiness, and an out-of-tree caller that still passes it
must keep working. The `cerefox-ingest` Edge Function's request body is
unchanged for the same reason.

The fallback is `FALSE` rather than `TRUE`: a store whose config row is missing
(a schema behind this one) behaves as a fresh install would. `cerefox doctor`
warns in that state and points at `cerefox server deploy --schema-only`.

### What "off" means: the feature disappears completely

Decided 2026-09-03. When the flag is off, review status is **not a concept the
system exposes** — not in the UI, not in the API, not in agent-facing output.
Not dimmed, not empty, not "0 pending". Absent.

The alternative considered and rejected was a partial state — keeping the review
UI visible while a legacy queue still had entries, so it could be drained. It is
more informative and it is worse: a feature that is "off" but still visible for
some users, in some stores, until some condition clears, is a feature nobody can
form a mental model of.

**The worry that made me propose the partial state was overblown, and the
reason matters.** I argued that hiding a non-empty queue strands it. But
`review_status` gates nothing — no RPC filters on it — so a hidden
`pending_review` value has **zero functional effect**. It is a dormant label on
a row. Nothing is stranded because nothing was ever waiting.

### Stored data is not touched

Turning the flag off changes no rows. Two reasons:

- **Re-enabling must be a perfect restore.** A store that toggles off, runs for
  a month, and toggles back on should see exactly the review state it left. A
  mass `UPDATE` on config change is irreversible and destroys that.
- **A config toggle should not rewrite hundreds of documents.** Even audited,
  that is a surprising amount of writing for flipping a switch, and it makes
  the toggle something people are afraid to touch.

So a row may still hold `pending_review` while the flag is off. Because the
field is not exposed at all in that state (next section), no surface ever
*reports* something different from what is stored — the label is simply not
shown. Turning the flag back on shows exactly what was there.

**`approve-all` is therefore not needed.** It existed in the previous draft to
drain a queue that was visible; with nothing visible, there is nothing to drain.
Dropping it also removes the only destructive command this feature would have
introduced. If someone later wants stored state to match exposed state, that is
a one-off maintenance command, not part of this.

### How each surface hides it

| Surface | With the flag off |
|---|---|
| Web UI | The pill, both badges and the search chip do not render (`useReviewWorkflow()` reads the flag through the config API). Settings still shows the flag itself. |
| `GET /documents/{id}`, `/documents`, `/dashboard`, `/dashboard/recent-docs`, `/projects/{id}/documents`, `/documents/trash`, `POST /documents/metadata-search` | The `review_status` key is **absent** from every row |
| `GET /search?review_status=…` | **`400`** — "review_status filtering is unavailable: the review workflow is off" |
| `POST /documents/{id}/review-status` | **`404`** with a message saying the workflow is off and how to enable it |
| MCP `cerefox_metadata_search` | The status segment is omitted from each line |
| `cerefox-metadata-search` Edge Function | The `review_status` key is absent from each row |
| CLI `document list`, `metadata search` | The `status` column / segment is dropped; `--json` rows have no `review_status` key |
| `cerefox doctor` | One `review workflow` line, always: `ON — …` / `OFF — …` / a warning when the row is missing |

**On the API: the field is absent, not reported as `approved`.** The first
draft proposed reporting `approved` because `_shared/schemas/discovery.ts`
declared `review_status` as required. The maintainer rejected that — "we are
changing the data … I would prefer the extra complexity of hiding the flag from
the UI and the API" — and the extra complexity turned out to be small: the
schemas now declare the field optional, one shared reader
(`reviewWorkflowEnabled()` in `_shared/mcp-tools/feature-flags.ts`) answers
every surface, and the web config route busts its cache on a `PUT` so a flip
takes effect on the next request. Every stored value is reported exactly as
stored or not at all; nothing is ever relabelled.

The write route returning `404` rather than silently accepting, and the search
filter returning `400` rather than silently ignoring, are deliberate: a
disabled feature should refuse, not pretend. A client that still calls either
has a bug and should hear about it.

### What does NOT change

Stated explicitly because the blast radius is the first thing to establish:

- **Attribution.** `author_type: "agent"` is still recorded, still audited. The
  flag changes what `review_status` gets set to, nothing about who did what.
- **The audit log.** Untouched.
- **Retrieval.** Untouched, because it never depended on this.
- **Versioning and retention.** Untouched.
- **The column and its CHECK.** Both stay. This is a behaviour switch, not a
  schema removal, and re-enabling must be a clean no-op.

## The curator question — what this flag should not foreclose

Raised by the maintainer 2026-09-03, and it reframes the feature usefully:

> There is no real approval process, unless we want to introduce one at the doc
> level. For example, if we introduce a curator agent, we could use this flag
> for the curator indicating that this doc is scanned and "review/curated".

That is a sharper reading of what `review_status` is than the one it shipped
with. v0.1.8 framed it as **human-on-the-loop governance**: a person validates
what an agent wrote. That framing is why it has never been used — it presumes a
reviewer who does not exist on most installs, and "approved" has to mean "a
human looked at this", which nobody did.

Reframed as a **curation signal** — "something has assessed this document" —
the same column becomes useful in an agent-first system, and the reviewer can
be a curator agent rather than a person.

**This does not change the design, and that is the point.** Three properties
of what is proposed above keep the door open:

- **The column, its CHECK, and the write path all survive.** This is a
  behaviour switch, not a removal. A curator would use exactly the same storage.
- **The flag governs the *automatic flagging*, not the concept.** That is
  precisely why it is named `review_workflow_enabled` and not, say,
  `review_status_enabled`. What gets turned off is the rule "an agent write
  becomes pending"; what remains available is the ability for something to set
  a status deliberately.
- **The RPC becomes the single decision point**, so adding a third mode later
  is a change in one function rather than in six clients.

**What a curator would need that does not exist today**, recorded so it is not
rediscovered:

1. **A real `cerefox_set_review_status` RPC.** There is none. The only writer
   is a direct PostgREST table `UPDATE` in the web route
   (`documents-write.ts:437-441`). An agent-driven curator needs an RPC and an
   MCP tool, not a web-only path.
2. **A third mode rather than a boolean**, most likely: `off` / `agent_writes`
   (today's rule) / `curated` (nothing is auto-flagged; a curator sets status
   explicitly). A boolean stored in `cerefox_config` widens to an enum without
   a data migration — the column is `TEXT` and `validateConfigValue` is
   per-key — so choosing a boolean now costs nothing later.
3. **A vocabulary decision.** `approved` / `pending_review` are human-review
   words. A curator signal may want `curated`, or a separate column, precisely
   so that "a human blessed this" and "a bot scanned this" are not conflated.
   That is a bigger conversation than this flag and should not be settled by
   accident here.

**Recommendation: ship the boolean, do not build for the curator yet.** The
curator is a real idea with no design behind it, and the flag as specified
neither blocks it nor pretends to anticipate it. Revisit when there is an actual
curator to serve.

## Versioning

- Schema version **0.15.0 → 0.16.0** (both literals, in lockstep). Migration
  **`0031_review_workflow_toggle.sql`** seeds the flag to `true` on an existing
  store and re-ships `cerefox_set_config` with the widened allow-list;
  `rpcs.sql` re-applies the ingest and search RPCs. `schema.sql` seeds `false`
  for a fresh deploy. No table change, no column change, no data migration.
- `cerefox_hybrid_search` and `cerefox_search_docs` gain an optional
  `p_review_status` (#240), so the filter is applied before `LIMIT` rather
  than after it in TypeScript. New parameter = new overload, so the old
  signatures are `DROP`ped first (PGRST203 otherwise).
- **`minSchema` raised to 0.16.0.** The earlier draft argued against raising
  it; the final design makes it necessary. A v1.13 client no longer decides
  the review status itself, so against a 0.15 server the old RPC's sanitizer
  would fall back to `approved` for *every* agent write — a silent behaviour
  change, which is exactly the "the client misbehaves" test `CLAUDE.md` sets
  for raising the minimum. (The search overloads would also fail loudly with
  PGRST202.) `cerefox doctor` errors and `cerefox web` refuses to start until
  `cerefox server deploy --schema-only` has run.
- `cerefox config list` now derives from `CONFIG_CATALOG` (#239) and a static
  test pins the catalog to the RPC's `v_allowed` list, so a third copy of the
  allow-list cannot drift again.

## Rejected alternatives

**Per-agent trust** ("this agent's writes are auto-approved, that one's are
not"). Attractive until you remember `author` is a **declared, unverified
string** on every transport. Any agent could claim a trusted name. It would be
security theatre, and it would imply the identity is meaningful in a way
Cerefox deliberately does not promise.

**Per-project setting.** More configuration surface, no demand for it, and it
would make "why is this document pending?" a per-document investigation.

**Three modes** (`all` / `new documents only` / `off`). No use case has been
articulated for the middle one, and each mode multiplies the states the UI must
explain.

**An environment variable.** Lets two clients on one store disagree. Already
settled against in v1.1.0 for the same reason.

## Decisions (all taken 2026-09-03/04)

1. The name is `review_workflow_enabled`.
2. "Off" means the feature is hidden everywhere, **including the API** — the
   field is absent, never relabelled.
3. Stored data is untouched; `approve-all` is dropped, there is no visible
   queue to drain.
4. Fresh installs default to `false`; upgrades seed `true`.
5. The CLI drops the `status` column when off, for consistency with every
   other surface.
6. `cerefox doctor` always prints one `review workflow` line (on, off, or
   missing) — silence about a disabled governance feature is the failure
   mode worth avoiding, and a line that only appears when off is easy to miss.
7. The curator is a future idea; nothing here anticipates it beyond keeping
   the column and making the RPC the single decision point.

## Testing (as shipped)

- **Both sides of the toggle, live, every run:**
  `packages/memory/test/web-integration/review-workflow.test.ts` flips the flag
  itself through the config API, ingests as an agent under each state, and
  asserts the full off contract (field absent on document GET, recent-docs,
  metadata-search and trash; search filter `400`; review-status `404`) and the
  on contract (`pending_review`, filter honoured server-side, endpoint flips),
  plus that a flip takes effect on the very next request. Restores the flag it
  found and purges its fixtures.
- **Flag-aware suites** (branch on the store's current value):
  `pipeline-ingest-text`, `web-integration/attribution`,
  `web-integration/destructive`, `edge-functions` (metadata-search row).
- **Unit:** `_shared/__tests__/feature-flags.test.ts` (fail-closed, per-key
  cache, failures not cached); `config-catalog-allowlist.test.ts` (catalog ⟷
  `v_allowed`); `rpc-guard-invariants` (migration ⟷ `rpcs.sql` lockstep for
  `cerefox_set_config`).
- **UI:** the Playwright document-detail test reads the flag and expects the
  pill when on / no pill when off; the Settings test asserts the Governance row
  renders. Run once against staging in each state before release.
- Toggling is audited (config writes have been audited since v1.9.0).

## Found while mapping this (both fixed in the same release)

1. **`cerefox config list` hid three working keys** (#239). The CLI kept a
   hand-written duplicate of `v_allowed` and had drifted. Fixed by deriving the
   list from `CONFIG_CATALOG`; a static test now pins the catalog to the RPC.
2. **A filtered search under-returned** (#240). The review-status filter ran
   in TypeScript *after* the RPC had applied `count`. Fixed by passing
   `p_review_status` into `cerefox_hybrid_search` / `cerefox_search_docs`.
