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

So the stored value and the exposed value can differ while the flag is off. That
is the one wart in this design and it is worth stating plainly in the docs: the
database may hold `pending_review` on rows the API reports as `approved`.

**`approve-all` is therefore not needed.** It existed in the previous draft to
drain a queue that was visible; with nothing visible, there is nothing to drain.
Dropping it also removes the only destructive command this feature would have
introduced. If someone later wants stored state to match exposed state, that is
a one-off maintenance command, not part of this.

### How each surface hides it

| Surface | With the flag off |
|---|---|
| Web UI | The pill, both badges and the search chip do not render. Settings still shows the flag itself. |
| `GET` document / search / dashboard / metadata-search | `review_status` reports **`approved`** |
| `POST /documents/{id}/review-status` | **`404`** with a message saying the workflow is disabled |
| MCP / agent output | The status column and any review mention are omitted |
| CLI | The `status` column is dropped from `document list` and `metadata search` output |

**On the API: report `approved`, do not omit the field.** Omitting looks tidier
and breaks things — `_shared/schemas/discovery.ts:88,107` declare
`review_status: z.string()` as **required**, so a missing field fails client
validation. Reporting `approved` keeps every schema valid, every existing client
working, and is semantically defensible: with no review workflow, nothing is
awaiting review. This is the cheap answer to "unless the API is really difficult
to do" — it is not difficult, and it costs no compatibility.

The write route returning `404` rather than silently accepting is deliberate: a
disabled feature should refuse, not pretend. A client that still calls it has a
bug and should hear about it.

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

**Decided 2026-09-03**: the name is `review_workflow_enabled`; "off" means the
feature is hidden everywhere, including the API; stored data is untouched; and
`approve-all` is dropped, since there is no visible queue to drain.

Still open:

1. **Default for fresh installs.** `true` preserves today's behaviour for
   everyone and is the safe answer for upgrades. Should a *brand new* store
   default to `false`, on the argument that most single-operator installs never
   review anything? The cost is that the default then differs between new and
   upgraded stores, which is a thing to explain forever. Weak preference for
   `true` everywhere.
2. **Whether the CLI should drop the `status` column or keep it.** Dropping is
   consistent with hiding everywhere. Keeping it costs nothing and avoids a
   column appearing and disappearing in scripted output. Weak preference for
   dropping, for consistency.
3. **Whether `cerefox doctor` should mention the workflow is off.** It makes an
   invisible governance setting discoverable, which is usually right — but "the
   feature disappears completely" argues the other way. Suggest one line only
   when the flag is off, since silence about a *disabled* governance feature is
   the failure mode worth avoiding.

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
