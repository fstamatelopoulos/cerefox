# Partial Document Edits

**Status**: Draft — not implemented. Revised twice on 2026-08-08 against a second
real session: once because its usage contradicted the scope this document proposed,
and again after it reviewed the result and found five under-specified edges (§3, §8). Still gathering sessions before committing to
semantics — **if you are an agent using Cerefox as memory, §8 is what we want from
you**, and [issue #186](https://github.com/fstamatelopoulos/cerefox/issues/186) is
where to put it.
**Date**: 2026-08-08
**Motivation**: an agent that wants to add three paragraphs to a 24,000-character
document must currently resend all 24,000. That is a correctness problem before it
is a cost problem.

## 1. The problem, observed

Writing three entries to the Cerefox Decision Log in one session meant, each time:

1. `cerefox_get_document` → ~21,000 characters into the agent's context
2. splice the new entry in
3. `cerefox_ingest` → ~24,000 characters back out
4. the server re-chunks and **re-embeds the entire document** to add ~3,000

Three costs, in increasing order of importance:

- **Tokens.** Roughly 45,000 characters moved per edit, to change 3,000.
- **Embedding spend and latency.** Every chunk re-embedded, including the ~90% that
  did not change.
- **Transcription risk.** This is the real one. An agent with no filesystem must
  reproduce the entire document *verbatim* inside a tool call. Any drift silently
  rewrites content nobody asked to touch, and the diff is invisible to the caller.

That third risk is not hypothetical. `CLAUDE.md` already carries the rule
*"append, never compress — accidental compression is data loss"*, which exists
precisely because this failure mode is known and currently unmitigated by the API.
The mitigation available today is discipline. It should be a tool.

A second session (2026-08-08) reported the same pattern on a different document
kind: three or four re-ingests of 6,000 to 13,000 character strategy documents to
change a few lines each, including one that reproduced a large table and a contact
list verbatim while editing unrelated content. Nothing failed. But the correctness
of several thousand untouched characters rested entirely on transcription
fidelity, repeatedly, and the caller could not have diffed it if it had not held.
See §8 Q4 on why "no corruption observed" is weak evidence here.

## 2. Design principle

> The agent sends **what changed**. The server owns **assembling the result**.

Everything below follows from that. The agent never holds the full document in
order to modify part of it.

## 3. The contract

Two real sessions have reported their write mix, and they disagree:

| session | pure appends | mid-document edits |
|---|---|---|
| the one that motivated this doc (decision log) | 100% | 0% |
| a strategy/registry knowledge base, 2026-08-08 | ~30% | ~70% |

That disagreement is the most useful thing we know, and it is not noise. The split
falls along **document kind**, not along agent or habit: registries and logs
accumulate at the end, while strategy documents, plans and indexes get edited in
place. A store tends to accumulate the second kind as it matures.

**Session 1's 100% should be discounted further than it first appeared.** It was
writing the Cerefox Decision Log, which carries an explicit *"append, never
compress"* rule. That figure therefore measures a **policy that mandates appending**
rather than a natural distribution of intent. The document it was writing to had
already decided the answer. Session 2, editing ordinary strategy documents under no
such rule, is the better evidence about what agents reach for, and this document is
now weighted accordingly.

Appending is still real and still the right primitive for logs. It is just not the
*shape* of the feature, which is what the previous draft got wrong.

### 3.1 One addressing model

Every operation names a **position**. Only one of them needs no anchor:

| position | anchor | meaning |
|---|---|---|
| `end_of_document` | none | add to the end of the document (the old `append`) |
| `end_of_section` | heading | add to the end of a section's body |
| `after_heading` | heading | add immediately after the heading, before its body |
| `before_heading` | heading | add a new block before an existing section |

`append` is not a separate operation; it is `end_of_document`. Collapsing it in
costs nothing and buys a lot: one addressing vocabulary instead of two, and
`before_heading` / `after_heading` stop being a separate feature to schedule and
become two more values in an enum that already exists. They are **in scope**, not
deferred.

### 3.2 Why this is three tools and not one

The obvious next step is to collapse further: one `edit` tool taking a position, an
operation, and text. Orthogonal, minimal, elegant. This section argues against it,
but the argument is a trade-off rather than a rule, and it is worth re-opening if
someone sees it differently.

The relevant fact is in the MCP specification, not in anything Cerefox has already
built: **tool annotations are declared per tool, in the `tools/list` response.**
There is no per-call annotation. A tool's `destructiveHint` therefore has to
describe its worst case, not the call in front of the user.

That gives three shapes:

- **One `edit` tool, annotated destructive.** Honest, and it makes every purely
  additive insert prompt as though it might remove a section. The documented
  response to a tool that always warns is to blanket-approve it, at which point the
  annotation stops carrying information for the calls where it mattered.
- **One `edit` tool, annotated non-destructive.** Rejected outright: it tells
  clients a delete is safe.
- **Split along the safety boundary.** The additive surface can honestly declare
  itself additive, and the destructive surface can honestly warn.

The third is recommended, so the tool boundary follows the **safety** boundary
rather than the elegance boundary:

- **`cerefox_insert`** — every position in §3.1. Purely additive. Cannot destroy
  content, because it never addresses any. Annotated **not destructive**.
- **`cerefox_replace_section`** — overwrites a section's body. Destructive.
- **`cerefox_delete_section`** — removes a section. Destructive.

One addressing model, three tools, split where the risk changes. An agent can be
granted the additive tool freely and asked about the other two, which is the
distinction annotations exist to express.

The cost is real and worth naming: three tool descriptions to keep consistent
instead of one, and a client that wants "let this agent edit documents" has to
grant three things. If that friction shows up in practice, collapsing to one
destructive-annotated `edit` is a legitimate alternative — it trades prompt
fidelity for surface area, and the v1.2.0 annotation work is a starting point to
revise, not a commitment to honour.

**The larger cost is atomicity, and it is not specific to the split.** Restructuring
a document is now a *sequence* — insert here, replace there, delete that — where a
full re-ingest was one write. Each call carries its own token, so a concurrent
writer can interleave between them, and the agent must be prepared to re-plan
partway through a restructure rather than assuming its plan survives to the last
call. A half-applied restructure is also a state no single re-ingest could produce.

This is a genuine regression against re-ingest on one axis, and it is worth being
straight about rather than filing under "safety wins". Three things bound it: each
call returns the new hash, so an uncontended sequence chains without re-reading;
every step is individually conflict-checked, so the failure is a stop rather than a
silent overwrite; and the intermediate states are ones a *reader* can make sense of,
unlike the transcription corruption in §1. It belongs in the agent-facing guide as a
usage note: a large restructure is several operations with conflict checkpoints, not
one atomic write.

If it bites in practice, the answer is a batched form (§7), not merging the tools —
the atomicity problem and the annotation problem have different solutions and
should not be traded against each other.

### 3.3 `cerefox_insert` — additive, any position

```jsonc
{ "document_id": "…",
  "position": "end_of_section",
  "anchor_heading": "## Active decisions",
  "text": "- …",
  "expected_content_hash": "…" }
```

`anchor_heading` is required for every position except `end_of_document`, where it
must be absent.

This is the highest-value tool in the set, and `end_of_section` is its highest-value
position: session 2 reached for it more than anything else (a bullet into a list
under a heading, a lesson under a subheading, a block inside an existing section).
It is *append, scoped to a section* — the same purely additive, unclobberable
operation, just anchored.

`before_heading` and `after_heading` address the **seam** between sections rather
than a section's interior, so anchor uniqueness matters more for them (§3.6). They
are still additive: a mis-anchored insert puts text in the wrong place, which is
visible and fixable, not lost.

**Where `end_of_section` ends, when sections nest.** If `## Active decisions`
contains `### Monday` and `### NOT doing`, "the end of the section" has two
defensible readings: the end of the whole subtree, or the end of the parent's *own*
body, before its first child heading. They are different places and the chunker will
pick one whether or not this document says which.

**Specified: `end_of_section` inserts immediately before the next heading of
equal-or-higher level — the end of the entire subtree.** That is what "the section"
colloquially means, and it is the less surprising of the two when an agent is adding
a new subsection to a section that already has some.

The other reading needs no second position, because the addressing model already
expresses it: *end of the parent's own body* is `before_heading` anchored to the
first child. Two positions, no overlap, and nothing ambiguous left in the enum. This
is a second argument for keeping the seam positions in scope rather than deferring
them (§3.1): without `before_heading`, one of the two natural insertion points in a
nested document would have no vocabulary at all.

### 3.4 `cerefox_replace_section` — swap a section's body

```jsonc
{ "document_id": "…", "anchor_heading": "## Outcome", "text": "…",
  "expected_content_hash": "…" }
```

Not additive, so it carries real risk, but bounded: a wrong anchor damages one
section rather than a document.

**Body-only by design. The heading always survives; there is no `scope` parameter
here**, unlike `delete_section` (§3.5).

A draft of this section gave it one, so that a section could be renamed while its
content changed (`## Pending` becoming `## Resolved`), on the argument that the
alternative — delete then insert — is two destructive calls with a window where the
section does not exist. **That was reasoning, not usage, and it was removed on those
grounds.** Asked directly, the session that proposed it went back through its own
edits and found no instance: headings stayed put while bodies changed, every time.
The one restructure that did change titles was a full rewrite, not a partial edit.

Recorded because the removal matters more than the parameter. The whole discipline
of this document is that sessions outrank reasoning (§8), and a reasoned suggestion
arriving *inside* session feedback is still reasoning — it does not inherit the
weight of the observations it travelled with. Rename is now §8 "Still open": if a
real session reaches for it, it can be added then, and delete-then-insert serves it
in the meantime, window and all.

It also carries a load the previous draft did not credit it with. Roughly half of
session 2's mid-document edits were to a **single line or bullet inside a larger
section**. `replace_section` serves those by having the agent resend the enclosing
section: worse than surgical, far better than resending the document, and
deliberately preferred over the line-anchored alternative (§3.8).

### 3.5 `cerefox_delete_section` — remove a section

```jsonc
{ "document_id": "…", "anchor_heading": "## Obsolete",
  "scope": "body_only", "expected_content_hash": "…" }
```

The previous draft left "does the heading itself go, or only the body?" open. It is
answered: **a `scope` parameter defaulting to `body_only`**, because both are real.
Removing a subsection outright wants `heading_and_body`; clearing a section to
refill it wants `body_only`. The default preserves the structural anchor and the
document's outline.

This parameter stays where the near-identical one on `replace_section` was removed
(§3.4), and the difference is the point: here a session reported wanting **both**
variants, having done both. There it was a case someone might want. Same shape of
parameter, opposite evidence, opposite outcome.

Deletion deserves particular care: it is the one operation where a wrong anchor
destroys content the caller never saw and cannot diff, and where the agent's intent
("remove the obsolete section") is indistinguishable in the response from the
failure ("removed the wrong one"). Mitigations are §3.6 and §3.7.

### 3.6 Anchor resolution: never guess

Every anchored position shares one failure mode, and it is the one that corrupts
documents quietly. The rules:

- **Absent anchor → error.** Never fall back to inserting at the end. An agent that
  mistyped a heading and got a silent `end_of_document` has content in the wrong
  place and a success response.
- **Ambiguous anchor → error, returning paths that resolve it.** Duplicate headings
  are common in real documents (`### Notes` under three parents). Matching the first
  is a coin flip that writes to the wrong section half the time.

  Erroring is only half an answer, and the earlier draft stopped there. If the
  agent's *only* addressing vocabulary is the exact heading text, and that text is
  what was ambiguous, then the error names a problem the agent has no way to fix:
  it can see three collisions and cannot express which one it meant. That is an
  unrecoverable surfaced error, which contradicts §5's own principle that a
  surfaced problem must be recoverable.

  **So `anchor_heading` also accepts a parent path**, and the ambiguity error
  returns the qualifying paths so the retry needs no extra round trip:

  ```jsonc
  // error: 3 sections match "### Notes"
  { "code": "CEREFOX_AMBIGUOUS_ANCHOR",
    "candidates": ["## Monday > ### Notes",
                   "## Tuesday > ### Notes",
                   "## Backlog > ### Notes"] }
  // retry
  { "anchor_heading": "## Tuesday > ### Notes", … }
  ```

  **Path, not occurrence index.** An index (`{heading: "### Notes", occurrence: 2}`)
  is positional: it silently retargets when sections are reordered or one is
  inserted above. That is the same fragility §3.8 rejects line-anchoring for, and it
  would be inconsistent to reject it there and adopt it here. A path is stable under
  reordering and breaks loudly under renaming, which is the correct direction to
  fail. A path that is still ambiguous is still an error.
- **Matching is exact on heading text**, after trimming whitespace. Normalised or
  fuzzy matching buys convenience and pays for it in precisely the silent-wrong-
  location failures this design exists to avoid.

A design that guesses here corrupts documents quietly, which is strictly worse than
one that refuses.

### 3.7 What every operation returns

**On success: the new `content_hash` and the resulting size. Not the document
body.**

Requested explicitly, and it matters: agents chain edits, and each follow-up write
needs a fresh token for its `expected_content_hash` (§5). Returning the full
document would spend exactly the tokens the feature exists to save, on the response
side, undoing the win.

**On conflict: the current `content_hash`, and still not the body.** The choice is
real, so it is stated rather than left to the implementation. Returning the body
would save the agent a `cerefox_get_document` round trip at exactly the moment it
wants to merge. It is still the wrong default: it makes the conflict path the most
expensive response in the API, and it pays that cost unconditionally, including for
the agents that will not merge at all — the ones that abandon the write, re-plan, or
decide the other writer's version is the correct one. Those agents pay full document
tokens for information they discard.

Conflicts are rare, and a deliberate re-read is the honest way to see what changed.
The agent that does want to merge spends one extra call; the agent that does not
spends nothing.

**A size flag, so cheap writes cannot quietly defeat a split policy.** The size in
the response is not decoration. An agent inserting repeatedly never assembles the
document, so it never sees it grow — and a workflow that made writes cheap could
walk a document past the point where it should have been split, one small insert at
a time, with every response reporting success. The maintainers' own decision-log
practice is exactly this: append until ~50,000 characters, then start a new part.

So when a document crosses a configured threshold, the response carries a flag
saying so. It does **not** refuse: a size policy is not a correctness rule, and
blocking a write on it would be a worse failure than the one it prevents. The flag
puts the fact in front of the only party who can decide, at the moment it becomes
true. (This implies a new config key for the threshold, dormant when unset.)

### 3.8 Deliberately excluded, and confirmed by usage

**Find/replace on arbitrary strings** and **diff/patch application**. Both fail in
the worst possible way: silently editing the wrong location.

This was a prediction in the previous draft. It now has direct support from the
session with the most to gain from it. Asked whether it wanted line-anchored editing
("insert after the line containing X"), having just spent a session doing line-level
edits by hand, the answer was no: *"I'd rather resend a section via
`replace_section` to change one line within it than have a line-anchored primitive
that guesses."* The stated sweet spot is section-scoped operations, with line-level
changes served by resending the enclosing section.

That is a user declining a feature that would have saved them effort, because the
failure mode is unrecoverable and invisible. It remains the strongest evidence in
this document.

## 4. Where it should live: not in an RPC

The natural instinct is a Postgres RPC — the document already lives there. That
does not work, for a specific reason worth recording.

**There is no text column to append to.** Document content is stored as *chunks*;
the full text is reconstructed by `cerefox_reconstruct_doc`. So an append is not
`UPDATE … SET content = content || $1`. It is: reconstruct → modify → **re-chunk**
→ **re-embed** → write. Re-chunking is the TypeScript markdown chunker, and
embedding requires an external HTTP call with an API key that has no business
living in the database.

So the composition belongs in the **shared MCP tool handlers**
(`_shared/mcp-tools/`), which both transports already import. The flow:

1. Handler reconstructs the current text (the agent supplies the
   `expected_content_hash` it last saw — §5)
2. Handler applies the operation in TypeScript (pure string work)
3. Handler chunks and embeds as the ingest path already does
4. Handler calls `cerefox_ingest_document` with the assembled result **and the
   agent's token**, so a concurrent write raises `CEREFOX_CONFLICT` rather than
   overwriting

**No new RPC is required**, and the single-implementation principle is preserved:
local stdio and remote Edge Function get identical behaviour from one handler.

Two changes to the existing RPC and schema are, though, both from §6.1: the
`operation` CHECK constraint gains the new values, and `cerefox_ingest_document`
needs to be *told* which one to record. It writes the audit entry itself — that
is deliberate, so the write and its trail are one transaction — and left alone it
would label every partial edit `update-content`, which is precisely the
distinction §6.1 exists to preserve. So it takes a nullable operation-label
parameter, and NULL keeps today's behaviour (`create` on insert,
`update-content` on update).

Nullable, not defaulted to a concrete value: a parameter that silently
substitutes its own default instead of deferring is how #183 happened, in this
same function.

Note what this preserves: the read still happens, but *inside the handler*, not in
the agent's context. The agent sends only the delta. Both the token win and the
transcription win survive intact.

Note that this does **not** narrow the concurrency window. The agent's token dates
from when it last read the document, so the race still spans an agent turn exactly
as it does today (`concurrency-control-design.md` §1). That is deliberate: the
window is what makes a concurrent write visible, and §5 explains why hiding it
would be the wrong trade.

## 5. Concurrency

**Every content-handling operation requires `expected_content_hash` and surfaces
conflicts to the caller. None of them auto-retries, and none may skip the token.**

Two earlier drafts got this wrong in successive ways, and both are recorded here
because the mistakes are attractive ones.

**First draft**: `append` is commutative, so it can skip the token. Wrong.
Commutativity describes an *abstract* append; this implementation is a
read-modify-write of the whole document (§4). Two concurrent appends therefore
lose one:

```
A reads X, computes X+a
B reads X, computes X+b
A writes X+a
B writes X+b        ← A's append is silently lost
```

The storage layer offers nothing to append onto — content lives in chunks, not a
concatenable column. That draft also contradicted itself, proposing a retry on
`CEREFOX_CONFLICT` while omitting the token that makes a conflict detectable.

**Second draft**: keep the token, but let the handler fetch it and auto-retry
`append` on conflict, since re-applying the same text to newer content still
yields the intended result. Mechanically true, and still wrong — for a reason
specific to what Cerefox is.

**A conflict is information the agent needs.** Cerefox is asynchronous shared
memory; agents coordinate *through* the document. If another session appended
while this one was composing, the agent may want to know before writing: its
entry might duplicate the other, contradict it, or push the document past a size
threshold that should have triggered a split instead of an append (§3.7 carries
that signal on the success path too). Auto-retry
lands the text and reports success, having concealed exactly the fact the agent
would have acted on.

Suppressing a concurrent write optimises for convenience over awareness, in the
one system where awareness is the product. And the asymmetry decides it: a
surfaced conflict is recoverable — re-read, reconsider, re-append — while a
hidden one is not.

So every operation behaves identically: token required, conflict raised,
`CEREFOX_CONFLICT` returned with the current hash, agent decides.

**Confirmed in practice (2026-08-08).** This is no longer only an argument. A
session hit a real conflict on an index document that had been edited from another
thread. Because the conflict surfaced, the agent re-read, saw links the other
writer had added, and merged. Under the auto-retry design of the second draft, the
same event would have re-applied the stale version, destroyed the other writer's
links, and returned success. The one behaviour that draft called a convenience
would have caused the exact data loss this design exists to prevent, in the first
week, on the first conflict.

### What the feature still buys

Requiring the token costs less than it appears, because it was never the main
prize:

| Benefit | Survives? |
|---|---|
| **Transcription safety** — never reproduce a document verbatim to edit part of it | ✅ untouched, and this was always the point (§1) |
| **Token cost** — send 3,000 characters instead of 24,000 | ✅ untouched |
| **Embedding cost** | ⏸ deferred either way (§7) |
| Skipping the read entirely | ❌ given up, deliberately |

Only the last one goes, and an agent that read the document in order to decide
what to append already holds a hash. If a future flow genuinely needs to append
without having read, the right answer is a cheap hash-only lookup, not a weaker
concurrency contract.

## 6. Audit and versioning

Both settled — recorded here as decisions, not options.

### 6.1 Audit: one operation value per command

**Decided: each partial-edit command gets its own `operation` value** — `insert`,
`replace-section` and `delete-section`. That is a change to the
`cerefox_audit_log_operation_check` constraint, the same shape as `relation-set` /
`relation-delete` in iteration 29.

Three values, matching the three tools (§3.2), **not one per position**. The
constraint should distinguish *added to* from *rewrote* from *removed*, which is
what a reader of the trail needs; whether an insert landed at `end_of_document` or
`end_of_section` is detail about the same intent, and belongs in the audit entry's
recorded arguments rather than in a constrained enum that would then need widening
every time a position is added.

The reasoning is worth stating because the implementation argues the other way.
These commands are built *on top of* the ingest primitive, so it is tempting to
log what actually ran: `update-content`. That would be the wrong record. The
audit trail exists to answer "what did someone do to this document", and *added
a paragraph* and *rewrote the document* are different answers even when they
compile to the same write. `append` and `update-content` are separate terms in
the contract between Cerefox and the agent or human on the other side of it; the
fact that one is implemented with the other is Cerefox's business, not the
reader's.

This matters most for the failure mode in §1. A trail that records every write as
`update-content` cannot distinguish an agent that appended from an agent that
re-sent the whole document and quietly dropped half of it. Distinguishing them is
much of the point.

### 6.2 Versioning: every partial edit snapshots, like any other write

**Decided: yes, every partial edit creates a version**, exactly as a full
re-ingest does today. A partial edit *is* the efficient equivalent of the agent
re-sending the whole document — the saving is in what crosses the wire and what
the agent has to reproduce, not in what the store keeps. So there is no case for
special-casing them: the same edit, expressed two ways, should leave the same
history behind. The alternatives (skip the snapshot because an append is
additive, or coalesce appends within a window) are both rejected — either would
mean the version history depends on which command an agent happened to use.

What does change is *frequency*. Partial edits make writes cheap to issue, so
they will make them more common: a decision log that took three appends a week
may take thirty. This is now reported rather than predicted — a session confirmed
it had been batching changes deliberately to avoid expensive re-ingests, and would
write each decision as it happened instead (§8 Q6). Version growth is a real consequence of this feature, but it is
a **retention-tuning** matter, governed by `version_retention_hours` and
`version_cleanup_enabled`, not something the write path should be clever about.

Two constraints for whoever implements this, both learned the hard way in #183:

- Retention is a **store-level policy**. Partial-edit handlers must pass those
  parameters as NULL and let the RPC resolve them from `cerefox_config`. Passing
  concrete values silently overrode the store's policy on every write for an
  entire release, and the failure was invisible: cleanup ran while the config
  said it should not. Any new write path inherits this trap.
- Cleanup runs **per document, on write**. A high-frequency append target is
  therefore also the document pruned most often — an active log both accumulates
  and sheds versions faster than anything else in the store. Worth knowing before
  someone reports that their busiest document has the shortest history.

## 7. Explicitly deferred

**A batched form: several operations, one transaction, one token.** The natural
answer to the atomicity cost in §3.2 — a restructure applies wholly or not at all,
against a single `expected_content_hash`, instead of as an interleavable sequence.
Deliberately not in v1: it is only worth building once real restructures show the
sequence actually breaking, and designing the batch semantics (ordering, anchor
resolution against a document being mutated mid-batch, partial-failure reporting)
is a larger problem than the operations themselves. Named here so the answer is on
record when the question arrives.


**Incremental chunking and embedding.** Version one should still re-chunk and
re-embed the whole document server-side. The agent-side win (tokens, transcription
safety) and the server-side win (embedding cost) are **separable**, and the second
is much harder: appending shifts chunk boundaries, and content format 2 guarantees
an exact gapless partition that must continue to hold. Ship the API shape first,
prove it, then optimise.

## 8. What real sessions have said

Answers below come from agents actually using Cerefox as memory, not from review.
Where a session contradicts an assumption in this document, the session wins.

**Mark each answer as observed or reasoned, and weight them differently.** "I did X
in a session" is data. "Someone might want Y" is reasoning, and it does not become
data by arriving in the same message as an observation — it faces the same
wait-for-a-session bar as a suggestion from anyone who has not used the feature.
This rule is here because it was needed: §3.4's rename parameter was a reasoned
aside inside otherwise-observed feedback, and it was promoted to a near-decision
before anyone checked whether its own author had ever done it. They had not. Session
feedback is not uniformly evidence, and the sessions providing it have been the
first to say so.

**Session 1** — the decision-log session that motivated the document.
**Session 2** — a strategy and registry knowledge base, 2026-08-08.

Session 2 also reviewed the revision its own feedback produced, which is where
§3.3's nesting boundary, §3.6's path disambiguation, §3.7's conflict and size
semantics, and §3.2's atomicity note come from. Every one of those is an edge the
design would otherwise have left for the implementation to guess — which §3.6 exists
to say we do not do. A fifth suggestion from the same review, a rename parameter on
`replace_section`, was reasoned rather than observed and did not survive the check
(§3.4).

More are being gathered, including from another contributor's agents. **Add rows
and answers here rather than rewriting the section**: the disagreement between
sessions is the finding, and flattening it into a single narrative would discard
the only thing that has actually moved this design. Two sessions already reversed
its scope; a third that agrees with either one is worth as much as one that does
not.

1. **What fraction of your writes are pure appends?**
   Session 1: 100%. Session 2: ~30%, with ~70% mid-document. This is what
   withdrew the "ship `append` alone" plan and reshaped the contract (§3).
   The split tracks document kind, not agent preference.

2. **When you edit mid-document, what are you addressing?**
   Heading-anchored sections, and about half the time a single line or bullet
   *within* one. Heading addressing covers roughly half the need directly; the
   rest is served by resending the enclosing section (§3.4).

3. **Would you accept an operation that does not return the document?**
   Yes, and it is preferred: return the new `content_hash` and size, not the body,
   because edits get chained and each follow-up needs a fresh token. Returning the
   body would spend the saved tokens on the response. Now §3.7.

4. **Has re-sending a full document ever produced an edit you did not intend?**
   No known instance, and the answer came with the reason that matters: *"that's
   precisely the point, I wouldn't necessarily know."* The reported exposure was
   reproducing a large table and contact list verbatim while changing unrelated
   lines, with nothing but care protecting the untouched 5,900 characters. Absence
   of detected corruption is not evidence of correctness when the failure is
   defined by being invisible.

5. **For deletion: is heading addressing enough?**
   No. The real deletions were line-level (a stale bullet, a removed gate), not
   whole sections. The accepted answer is still section-scoped: resend the
   enclosing section rather than build line-anchored deletion. Drove the `scope`
   parameter in §3.5.

6. **If writes were cheap, how much more often would you write?**
   Meaningfully more. Session 2 batched changes deliberately to avoid expensive,
   risky re-ingests, and would have written each decision as it happened. Confirms
   the frequency jump §6.2 predicts, and that retention tuning is where it lands.

### Still open

- **Is session 2 the norm or the exception?** Two sessions, opposite mixes. The
  hypothesis worth testing is that append-dominant is a property of logs and
  registries, and that stores drift toward section editing as they mature. Two
  data points cannot settle it, and the answer changes what gets built after the
  minimum set.
- **How common are duplicate headings in real stores?** §3.6 answers ambiguity with
  parent paths, which is the recoverable design, but it is untested against real
  documents. If collisions turn out to be pervasive, agents will spend a round trip
  on a large share of anchored writes and paths become the normal form rather than
  the fallback.
- **Does anyone reach for section rename?** Proposed as a `scope` parameter on
  `replace_section`, then **removed** (§3.4): it was reasoning, and the session that
  proposed it, asked to check, found no instance in its own edits. Watch for a real
  one before building. Until then, delete-then-insert covers it, with the
  no-such-section window that argued for the parameter in the first place — a known
  cost, deliberately accepted rather than designed away on speculation.
- **Does an error on an ambiguous anchor (§3.6) annoy more than it protects?** The
  design deliberately refuses rather than guesses. Real duplicate-heading
  documents will tell us whether the refusal lands as safety or as friction.

## 9. Needs register

Every need reported by a real session, whether or not v1 serves it. Two rules in
this document pull in opposite directions — *sessions outrank reasoning* (§8) prunes,
*serve the reported need* accumulates — and without somewhere to put the difference,
a need silently disappears the moment its justification fails the evidence bar. That
is how a spec ends up quietly narrower than the usage it claims to serve.

So pruning removes things from **§3, not from here**. A need that loses its
implementation still keeps its row.

Three statuses, and the middle one is the one that matters:

- **v1** — the contract in §3 serves it.
- **Open, not foreclosed** — not built, and the §3 contract is checked to make sure
  it *could* be added later without a breaking change. This is a claim the technical
  design must verify, not a hope.
- **Excluded by design** — deliberately refused, with the reason on record.

| # | Need | Status | Where |
|---|---|---|---|
| 1 | Add to end of document | **v1** | `insert` / `end_of_document` (§3.1) |
| 2 | Add to end of a section | **v1** | `insert` / `end_of_section` (§3.3) |
| 3 | Add lead-in text after a heading | **v1** | `insert` / `after_heading` |
| 4 | Add a new section before an existing one | **v1** | `insert` / `before_heading` |
| 5 | Add at end of a parent's own body, before its children | **v1** | `before_heading` on the first child (§3.3) |
| 6 | Replace a section's body | **v1** | `replace_section` (§3.4) |
| 7 | Delete a section, body only or with its heading | **v1** | `delete_section` + `scope` (§3.5) |
| 8 | Change one line inside a larger section | **v1**, indirectly | resend the enclosing section (§3.4) |
| 9 | Address a heading that appears more than once | **v1** | parent paths (§3.6) |
| 10 | Get a fresh token without paying for the document | **v1** | hash + size, no body (§3.7) |
| 11 | See a conflict rather than have it resolved silently | **v1** | §5 |
| 12 | Know when a document is growing past its split point | **v1** | size flag (§3.7) |
| 13 | Rename a section while replacing its content | Open, not foreclosed | §3.4 — reasoned, never observed; `scope` is addable |
| 14 | Restructure atomically across several operations | Open, not foreclosed | batched form (§7) |
| 15 | Insert or edit anchored to arbitrary text | **Excluded by design** | §3.8 — declined by the session that would have gained most |

**Rows 13 and 14 are the register's whole point.** Neither ships. Both were argued
for and both lost on evidence, and both would otherwise have vanished from the
document along with the arguments — leaving a future reader to rediscover the need
and a future implementer free to make a choice that precludes it. Row 15 is
different in kind: it is not waiting for evidence, it was refused with evidence.

**For the technical design that follows this spec**, this table is the checklist.
Every **v1** row needs a mechanism. Every *open, not foreclosed* row needs a
demonstration that adding it later is additive: a `scope` parameter defaulting to
today's behaviour (13), and a batch entry point wrapping the same handlers under one
token (14). If either turns out to require a breaking change, that is a finding
about §3 and belongs back here, not a footnote in the implementation.

## 10. Related

- `docs/specs/concurrency-control-design.md` — the read→embed→write race this
  narrows
- `docs/specs/chunk-reconstruction-design.md` — content formats and the gapless
  partition guarantee that constrains §7
- `CLAUDE.md` → Cerefox Decision Log — the "append, never compress" rule that
  motivates §1
