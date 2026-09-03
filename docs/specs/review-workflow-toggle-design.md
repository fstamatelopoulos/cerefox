# Making the review workflow optional

**Status: DESIGN, for discussion.** No ticket, no branch, nothing built.
Target: a minor release (schema change, backwards compatible).

## The request

The `review_status` workflow assumes a human operator (or an AI judge) who
reviews everything an agent writes. On plenty of installs — an unattended agent
harness, or any single-operator store where the operator *is* the agent's
owner — nobody is ever going to review anything. So every agent write lands in
`pending_review` and stays there, accumulating a queue that is never drained
and that means nothing. Those installs want the workflow off.

## What the review system actually is today

Four facts that shape the design, each verified in the code rather than assumed.

**1. It does not gate anything.** `review_status` appears **zero times** in
every retrieval RPC: `cerefox_hybrid_search`, `cerefox_fts_search`,
`cerefox_semantic_search`, `cerefox_search_docs`, `cerefox_reconstruct_doc`,
`cerefox_context_expand`, `cerefox_get_document`. No filter, no score
adjustment, no ordering term. `cerefox_metadata_search` *returns* it but never
filters on it. `docs/research/vision.md:287` states this as the original intent
— "The content remains fully searchable in both states. Review status does not
gate access." — and the code matches.

The one exception is not in the database: `discovery.ts:494-515` post-filters
search results in TypeScript when the caller passes `review_status`, docs mode
only, opt-in. Worth knowing for two reasons — it is the only retrieval-affecting
code, and it filters *after* the RPC has applied `count`, so a filtered search
under-returns. (A pre-existing bug, orthogonal to this design; file separately.)

This is the single most important fact here: **turning the workflow off cannot
expose anything that was hidden**, because nothing was hidden.

**2. It is one of three governance pillars, and the only one affected.** v0.1.8
shipped "audit log, review status, version archival" together. Disabling review
touches none of the other two: **every write is still audited**, with author and
`author_type`, exactly as before. What stops is the flagging, not the record.

**3. The rule lives in SIX copies of client code, not in the database.**
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
| Default | `true` — every existing install behaves exactly as it does today |
| Group | `Governance` |
| `highImpact` | yes, so the web UI asks for confirmation before toggling |

Stored in `cerefox_config` like every other store setting, **not** an
environment variable. Review status is a property of the store: two clients
pointed at one database must not disagree about whether the workflow exists.
This is the same reasoning that moved `min_search_score` and
`version_retention_hours` out of the environment in v1.1.0.

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
v_review_on BOOLEAN := cerefox_config_bool('review_workflow_enabled', TRUE);

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

`p_review_status` becomes vestigial. Options: keep accepting it and ignore it
(safest for any out-of-tree caller), or drop it in a later major. Recommend
keeping the parameter, ignoring the value, and documenting it as deprecated —
removing a parameter is a breaking RPC signature change for the sake of tidiness.

### What happens to documents already pending

**Nothing. They are not touched.**

Mass-approving hundreds of rows because someone flipped a switch is a
destructive, surprising, and effectively unauditable act, and it is irreversible
— the previous state is gone. The flag changes what happens to *new* writes;
history stays as it was written.

But leaving them silently would strand a queue nobody can see. So:

> **The review UI appears when the workflow is enabled OR when pending
> documents still exist.**

With the flag off and a non-empty queue, the UI stays visible so the queue can
be drained, with a banner explaining that no new documents will be added to it.
As the operator approves them the queue empties, and the UI disappears on its
own. Nothing is stranded, nothing is mutated behind anyone's back, and the end
state is clean.

Draining should not require clicking N times, so a bulk action is part of this:
`cerefox document approve-all --yes` (and a UI equivalent), writing one audit
entry per document, explicit and opt-in. Never automatic.

**Manual review-status setting keeps working when the flag is off.** Disabling
the automatic flagging must not remove the ability to clear the backlog.

### Client behaviour when disabled

- **Web UI**, five surfaces, all subject to the "or pending documents exist"
  rule above: the clickable approve/re-queue pill (`DocumentPage.tsx:314-333`),
  read-only badges on the dashboard (`DashboardPage.tsx:332-342`) and project
  documents (`ProjectDocumentsPage.tsx:101-107`), and the "Pending review"
  search chip (`SearchControls.tsx:246-253`). The Settings page needs **no
  work** — it renders from the config catalog, so adding the entry surfaces the
  toggle automatically.
- **CLI**: nothing to remove. There is no `review` verb and no
  `--review-status` filter — the CLI only *displays* the column
  (`list-docs.ts:118`, `metadata-search.ts:133`) and includes it in backups
  (`backup.ts:159`), all of which stay correct. `cerefox doctor` should gain one
  line when the workflow is off, so the state is discoverable without hunting
  through `config list`: a governance feature that is silently off is worse than
  one that is loudly off.
- **Agents**: write responses stop mentioning review, and
  `metadata-search.ts:112` renders the status into the agent-facing result line.
  `AGENT_GUIDE.md:579,625`, the bundled `cerefox_get_help` content, and the
  guides listed at the end of this doc all describe the workflow as
  unconditional; they need a note that it is per-store. If a TypeScript-side
  gate is wanted, `_shared/mcp-tools/feature-flags.ts:44-59` (`relationsEnabled()`,
  60-second TTL, fails closed) is the established template — but see below for
  why the RPC should be the enforcement point regardless.

### What does NOT change

Stated explicitly because the blast radius is the first thing to establish:

- **Attribution.** `author_type: "agent"` is still recorded, still audited. The
  flag changes what `review_status` gets set to, nothing about who did what.
- **The audit log.** Untouched.
- **Retrieval.** Untouched, because it never depended on this.
- **Versioning and retention.** Untouched.
- **The column and its CHECK.** Both stay. This is a behaviour switch, not a
  schema removal, and re-enabling must be a clean no-op.

## Versioning

- `rpcs.sql` changes (the ingest RPC, the `v_allowed` allowlist in
  `cerefox_set_config` at `rpcs.sql:2685-2698`) → **bump `schema_version` in both
  places, in lockstep**: the `-- @version:` marker at `schema.sql:7` and the
  literal at `rpcs.sql:3082`, currently **0.15.0**. Plus migration
  **`0031_*.sql`** (0030 is the latest) re-shipping `cerefox_set_config` and
  `cerefox_ingest_document` with the usual `DROP FUNCTION IF EXISTS … ; CREATE
  FUNCTION …` shape.
- **A third allowlist has to be updated, and it is already stale.**
  `packages/memory/src/cli/commands/config-list.ts:16-52` hardcodes its own
  duplicate of `v_allowed`, described in its own comment as a mirror — and it
  is **already missing `version_retention_hours`, `version_cleanup_enabled` and
  `document_size_warning_chars`**. So `cerefox config list` does not list three
  keys that exist and work. That is a pre-existing bug found while mapping this
  feature, it should be filed separately, and this work must not add a fourth
  divergence to it.
- **Do not raise `minSchema`.** A newer client against an older server hits a
  server that rejects the unknown config key — a loud, visible error, not a
  silent misbehaviour. That is exactly the distinction `CLAUDE.md` draws: raise
  the minimum only when an older server makes the client do something *wrong*.
- No table change, no column change, no data migration.

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

## Open questions

1. **Name.** `review_workflow_enabled` vs `agent_writes_require_review`.
2. **Scope of "disabled".** This design says the flag governs only the
   *automatic flagging*. Should it also hide the manual approve action once the
   queue is empty, or is that just the UI rule above?
3. **`approve-all`**: worth building now, or is draining a queue by hand
   acceptable for the first version? It is the one piece here with real
   destructive potential.
4. **Default for fresh installs.** `true` preserves today's behaviour for
   everyone. Should a *brand new* store default to `false` instead, on the
   argument that most single-operator installs never review? That would make
   the default differ between new and upgraded stores, which is a real cost.

## Testing

- RPC-level: with the flag off, an `author_type: agent` ingest lands
  `approved`; with it on, `pending_review`. Asserted on the stored row.
- **Every transport, since the point is that they all inherit it**: at minimum
  MCP (local), `/api/v1`, and the CLI, against a live store.
- Toggling is audited (config writes have been audited since v1.9.0).
- Existing `pending_review` documents are untouched by a toggle in either
  direction — asserted, because "nothing happens" is exactly the kind of claim
  that rots.
- The UI-visibility rule: workflow on → visible; off with a non-empty queue →
  visible with the banner; off with an empty queue → hidden.
- A regression test that retrieval still ignores `review_status`, so a future
  change cannot quietly turn a label into a filter.
- **`docs/e2e-use-cases.md:219` lists "Review status auto-transition" as still
  TODO.** The behaviour this design modifies has never had an end-to-end test.
  Writing that test first, against current behaviour, is the honest order: it
  pins what exists before the flag changes it, and this project has now been
  bitten twice in one week by suites that passed while covering nothing.

## Found while mapping this (file separately, do not fold in)

Two pre-existing bugs surfaced during the survey. Neither blocks this design;
both would be silently inherited if left unnoted.

1. **`cerefox config list` hides three working keys.**
   `cli/commands/config-list.ts:16-52` duplicates the `v_allowed` allowlist by
   hand and has drifted: `version_retention_hours`, `version_cleanup_enabled`
   and `document_size_warning_chars` are all settable but unlisted. The durable
   fix is to derive the list from `CONFIG_CATALOG` rather than restate it.
2. **A filtered search under-returns.** `discovery.ts:494-515` applies the
   review-status filter *after* the RPC has already limited results to `count`,
   so asking for 10 approved documents can return fewer than 10 while more
   exist.
