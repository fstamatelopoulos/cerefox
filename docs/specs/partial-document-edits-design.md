# Partial Document Edits

**Status**: Draft — not implemented. Shaped by four real sessions (§8). Session 2
reversed the original scope and found five under-specified edges in the result;
session 3 supplied the first *observed* transcription corruption (§1) and reversed
the `end_of_section` default (§3.3); session 4 exposed a second corruption mode —
scope confusion (§1) — promoted the batched form into the contract
(`cerefox_edit`, §3.4), and surfaced a prerequisite fix: create must return
`content_hash` (§3.8).
Every need any session has reported, built or not, is tracked in the §9 register,
which is the checklist for the technical design that follows this spec. Still
gathering sessions before committing to semantics — **if you are an agent using
Cerefox as memory, §8 is what we want from you**, and
[issue #186](https://github.com/fstamatelopoulos/cerefox/issues/186) is where to
put it.
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

A third session (2026-08-08) closed that gap by corrupting a document and noticing.
Re-ingesting a ~10,000 character guide to change one link, it mistyped a document ID
in the *untouched* body (`80f6` became `80`), mangled the same ID differently while
fixing it, and left a stray `FIXME` token behind — three writes to repair one
intended change. It caught the damage only because it happened to fall inside a link
it was already looking at.

That is the failure mode of §1 occurring in practice, and it sharpens Q4's answer
rather than merely confirming it: the corruption an agent reports is the corruption
that lands where it was already looking. Everything else is, by construction,
unreportable. Two sessions have now said "I would not necessarily know"; one of them
then demonstrated it.

A fourth session hit a different corruption mode, arguably the likelier one for
agents: **scope confusion**. Updating a daily log, it sent *only the new day's
section* — thinking "append" while calling a tool whose contract is replace — and
the write succeeded, destroying the previous days' entries. It noticed only because
it had read the document moments earlier and saw the size drop in the response.
Nothing malfunctioned: the tool did what its contract says; the agent meant
something else, and nothing in the call could express the difference. Transcription
drift is a failure of attention. This is a failure of *intent*, and intent failures
do not diminish with care — which is why an additive primitive matters structurally
(§3.3), not just economically.

## 2. Design principle

> The agent sends **what changed**. The server owns **assembling the result**.

Everything below follows from that. The agent never holds the full document in
order to modify part of it.

## 3. The contract

Two real sessions have reported their write mix, and they disagree:

| session | pure appends | mid-document edits |
|---|---|---|
| 1 — the one that motivated this doc (decision log) | 100% | 0% |
| 2 — a strategy/registry knowledge base, 2026-08-08 | ~30% | ~70% |
| 3 — an opportunity index, guides and status docs, 2026-08-08 | almost none | overwhelmingly |
| 4 — daily logs with derived running totals, 2026-08-08 | low | dominant, and mostly coordinated |

That disagreement is the most useful thing we know, and it is not noise. The split
falls along **document kind**, not along agent or habit: registries and logs
accumulate at the end, while strategy documents, plans and indexes get edited in
place. A store tends to accumulate the second kind as it matures.

Session 3 lands with session 2 and independently proposed the same explanation,
having never seen it: logs append, status-bearing documents get edited in place, and
the mix follows what a store is *made of*. Its prediction, offered as reasoning
rather than observation: session 2's mix is the norm for any store that outlives its
first month. Two of three sessions is not a settled question, but the hypothesis now
has agreement from sessions that did not compare notes.

Session 4 then sharpened the hypothesis from inside it. Its daily logs *look* like
the append-dominant kind and were not, because every appended row also changed a
derived total under another heading. The operative property is not log-versus-
strategy; it is whether a document carries **derived or cross-referencing
content**. A document that does turns even its appends into coordinated
multi-location edits — which is what moved the batch into the contract (§3.2,
§3.4).

**Session 1's 100% should be discounted further than it first appeared.** It was
writing the Cerefox Decision Log, which carries an explicit *"append, never
compress"* rule. That figure therefore measures a **policy that mandates appending**
rather than a natural distribution of intent. The document it was writing to had
already decided the answer. Session 2, editing ordinary strategy documents under no
such rule, is the better evidence about what agents reach for, and this document is
now weighted accordingly.

Appending is still real and still the right primitive for logs. It is just not the
*shape* of the feature, which is what the previous draft got wrong.

**The whole contract, in one view:**

| | `cerefox_insert` | `cerefox_edit` |
|---|---|---|
| what | one additive operation | one to many operations, atomic |
| operations | insert only | `insert`, `replace_section`, `delete_section` |
| can destroy content | no — structurally | yes |
| annotation | non-destructive | destructive |
| token | `expected_content_hash`, required | `expected_content_hash`, required, one per call |
| returns | new hash + size, no body | new hash + size, no body |

Two supporting changes ride alongside, neither of them a new tool: `get_document`
gains an **outline mode** (§3.7) so anchors can be learned without paying for the
body, and create gains the **`content_hash`** it should always have returned
(§3.8, [#189](https://github.com/fstamatelopoulos/cerefox/issues/189)) so a
document is born holding its concurrency token.

Everything else in this section is the precise semantics of those two rows:
positions (§3.1), the operations (§3.3–§3.6), anchor rules (§3.7), responses
(§3.8), and the one class of operation refused outright (§3.9).

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

### 3.2 Two tools: the annotation boundary held, the atomicity boundary moved

The obvious shape is one `edit` tool taking an operation and a position:
orthogonal, minimal, elegant. The constraint is in the MCP specification: **tool
annotations are declared per tool, in the `tools/list` response**, with no per-call
variant, so a tool's `destructiveHint` must describe its worst case. A single
`edit` tool would declare itself destructive, every additive insert would prompt as
though it might delete a section, and the documented response to a tool that always
warns is to blanket-approve it — the exact failure the v1.2.0 annotations removed.

An earlier revision answered with **three** tools — `insert`, `replace_section`,
`delete_section` — split along the safety boundary. Two sessions then bent that
shape from opposite ends, both observed:

- **Session 3**: in a status-bearing store, most edits touch content that already
  exists, so the destructive surface is the *common* case and the freely-grantable
  additive tool is the one reached for least. The split's ergonomic pitch — grant
  `insert` freely, gate the rest — served the minority.
- **Session 4**: coordinated multi-location edits were the **majority** of its
  writes, not a restructure tail. A typical daily-log update touched three places
  at once — a meal row into the intake table, the day's totals, a "remaining to
  target" line under another heading — mutually referential and *actively
  misleading* if half-applied. Under three per-call tools that work is an
  interleavable sequence, and the interim rule this section then carried ("do
  coordinated work as one big `replace_section` or a full re-ingest") would have
  routed the feature's most common use *away from the feature*.

So the contract is **two tools**. The annotation boundary stays, because it is
about honesty and it held. The destructive surface stops pretending its calls are
independent:

- **`cerefox_insert`** — one additive operation (§3.3). Cannot destroy content,
  because it never addresses any. Annotated **non-destructive**.
- **`cerefox_edit`** — one call carrying one or many operations, applied
  **atomically** (§3.4). Annotated destructive.

`replace_section` and `delete_section` are **operations of `cerefox_edit`**, not
tools of their own. Their semantics are unchanged (§3.5, §3.6); what changed is
that they arrive in a transaction. The interim rule is gone — atomicity is now the
contract, not guidance.

What this costs, named: batch semantics must be fully specified (§3.4 is that
specification), and granting `cerefox_edit` grants replace *and* delete together.
Accepted deliberately — no session has asked to hold replace while denying delete,
and the boundary clients actually surface, additive versus destructive, is intact.
If even two tools prove to be friction, collapsing to one destructive `edit`
remains the escape valve. Re-splitting the destructive operations into separate
tools would need a session that wants per-operation granting, and none has.

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

**Why the additive tool must exist at all — rather than insert being just another
operation of `edit` — is what session 4 demonstrated** (§1). Meaning to append, it
sent only the new content to a tool whose contract is replace, and destroyed the
document's earlier entries with a success response. `cerefox_insert` makes that
failure *inexpressible*: whatever the agent believes it is calling, an additive
contract cannot remove anything. This is also why `end_of_document` is a
first-class position rather than a degenerate case — the plain append is the write
agents make on autopilot, and autopilot is where scope confusion lives.

`before_heading` and `after_heading` address the **seam** between sections rather
than a section's interior, so anchor uniqueness matters more for them (§3.7). They
are still additive: a mis-anchored insert puts text in the wrong place, which is
visible and fixable, not lost.

**Where `end_of_section` ends, when sections nest.** If `## Active decisions`
contains `### Monday` and `### NOT doing`, "the end of the section" has two
defensible readings: the end of the whole subtree, or the end of the parent's *own*
body, before its first child heading. They are different places, and something will
pick one whether or not this document says which.

A previous revision specified the subtree end, on the grounds that it is what "the
section" colloquially means. **That has been withdrawn.** Session 3 supplied the
case it fails on: a status section whose body is a checklist, followed by many
subsections. Anchoring `end_of_section` there to add a checklist item puts the
bullet after the last subsection, pages from the list it belongs to, with a success
response. The agent's intent ("the end of this list I am looking at") and the
colloquial reading diverge precisely when a section has both a body and children.

The earlier answer also leaned on an escape hatch — *end of the parent's own body*
is `before_heading` on the first child — which requires the agent to already know
the section has children. Discovering that means re-reading the structure, which is
the cost this feature exists to remove.

**Specified, applying §3.7's rule to positions as well as anchors:**

- **A leaf section** (no child headings) is unambiguous. `end_of_section` inserts at
  the end of its body. This is the common case and needs nothing extra.
- **A section with both its own body and child headings is ambiguous, so the write
  errors** rather than choosing, and returns both concrete insertion points.
- The agent resolves it with `section_part`: `"own_body"` (end of the section's own
  content, before the first child) or `"subtree"` (after everything nested under it).
  Passing it up front skips the error.

```jsonc
// error: "## Status" has body content and 4 child sections
{ "code": "CEREFOX_AMBIGUOUS_POSITION",
  "candidates": [
    { "section_part": "own_body", "before_heading": "### Applications" },
    { "section_part": "subtree",  "before_heading": "## Next steps" }
  ] }
```

Two sessions read this differently, which is the argument for refusing rather than
defaulting: a silent choice is wrong for one of them every time, and wrong
invisibly, since the insert succeeds and the text is simply somewhere else. The
error costs a round trip on nested sections only, and it costs it in exchange for
the agent not having to know the document's shape in advance.

The seam positions stay in scope regardless (§3.1) — `before_heading` remains how an
agent expresses a deliberate placement once it knows the structure.

**A known limit of the vocabulary: structure *inside* a section.** Session 4's most
common insert was a row at the end of a markdown table that sits mid-section with
prose after it. `end_of_section` lands after the prose; `before_heading` wants a
heading that does not exist. The position vocabulary is heading-anchored, and table
rows, list items and other intra-section structure are not addressable in it.
Recorded (register row 22) rather than solved, and deliberately so, for a second
reason beyond the §3.9 slope: an element anchor would **tie the contract to one
block syntax**. "The table" is a markdown-table concept; the moment the vocabulary
knows what a table row is, it has opinions about pipe syntax, and documents using
list-based logs, code blocks or any future block format get nothing. Heading
anchors are format-blind — a heading is a heading whatever sits under it.

**The serve that needs no contract at all: structure.** A table that gets appended
to regularly deserves its own heading. Under one, `end_of_section` *is* the
row-append — additive, anchored, and format-blind, because the contract still only
knows about headings. This is the same lesson as §3.5's granularity guidance:
under partial edits, how a document is sectioned is a cost-and-capability
characteristic, and "give your append-heavy table a heading" belongs in the
agent-facing guide next to "prefer smaller sections". The fallback for a table
that cannot get its own heading remains a `replace_section` of the section holding
it.

### 3.4 `cerefox_edit` — one write, one or many operations

```jsonc
{ "document_id": "…",
  "expected_content_hash": "…",
  "operations": [
    { "op": "insert", "position": "end_of_section",
      "anchor_heading": "## Intake", "text": "| 14:20 | … |" },
    { "op": "replace_section", "anchor_heading": "## Totals", "text": "…" },
    { "op": "delete_section", "anchor_heading": "## Superseded",
      "scope": "heading_and_body" }
  ] }
```

Semantics, each load-bearing:

- **In order, against the evolving document.** Operation N sees the result of
  N−1. Anchors resolve per operation, under §3.7's rules.
- **All or nothing.** The first failing operation aborts the call: nothing is
  written, and the error names the failing index and reason. A partially applied
  state — the thing that made a sequence of separate calls dangerous — cannot
  occur.
- **One token, one version, one response.** The call carries one
  `expected_content_hash`, snapshots one version (§6.2), and returns one hash and
  size (§3.8). The audit trail records one entry per operation (§6.1).
- **A single-operation call is the normal case, not a degenerate one.** "Replace
  one section" is `cerefox_edit` with one operation. There is no penalty and no
  ceremony for using the batch shape for one thing.

Session 4's daily-log write is the motivating shape: three locations, mutually
referential, wrong if half-applied. Under the previous draft that was an interim
rule telling agents *not* to use this feature for its own most common case. Here
it is one call, coherent by construction.

`insert` appears both standalone (§3.3) and as an operation here. The duplication
is deliberate: the standalone tool is the freely-grantable additive surface for
the write agents make constantly; inside a batch, it composes with destructive
operations under one token.

### 3.5 `replace_section` — swap a section's body

An operation carried by `cerefox_edit` (§3.4), shown as it appears in the
`operations` array:

```jsonc
{ "op": "replace_section", "anchor_heading": "## Outcome", "text": "…" }
```

Not additive, so it carries real risk, but bounded: a wrong anchor damages one
section rather than a document.

**Body-only by design. The heading always survives; there is no `scope` parameter
here**, unlike `delete_section` (§3.6).

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
weight of the observations it travelled with. Rename is now §8 "Still open" and row
13 of the §9 register, which obliges the technical design to keep it addable as a
non-breaking change rather than merely noting it. If a real session reaches for it,
it can be added then; delete-then-insert serves it meanwhile, window and all.

It also carries a load the previous draft did not credit it with. Roughly half of
session 2's mid-document edits were to a **single line or bullet inside a larger
section**, and session 3 reported the same shape as its dominant one — toggling a
checklist item, changing a status word, fixing a link. `replace_section` serves those
by having the agent resend the enclosing section: worse than surgical, far better
than resending the document, and deliberately preferred over the line-anchored
alternative (§3.9). Session 3 measured its enclosing sections at 500 to 2,000
characters against documents of 10,000 to 38,000 — a 90%+ reduction with no
line-anchor guessing anywhere. Session 4, on smaller documents (2,000–7,000
characters, sections of 500–3,000), measured 60–80%: same direction, thinner
prize. The saving scales with document size, and small documents get
proportionally less from this feature.

**A consequence worth telling users about: how finely a document is sectioned is now
a performance characteristic, not only a readability one.** The same one-line edit
costs a 500-character write in a document with many small headings and a
12,000-character one in a document with few large ones. That is new — under full
re-ingest, structure had no bearing on write cost, so nobody had a reason to think
about it. It belongs in the agent-facing guide and in whatever advice we give humans
structuring knowledge bases: more, smaller headings make edits cheaper, and a
document that is one enormous section gets almost none of this feature's benefit.

### 3.6 `delete_section` — remove a section

An operation carried by `cerefox_edit` (§3.4):

```jsonc
{ "op": "delete_section", "anchor_heading": "## Obsolete", "scope": "body_only" }
```

The previous draft left "does the heading itself go, or only the body?" open. It is
answered: **a `scope` parameter defaulting to `body_only`**, because both are real.
Removing a subsection outright wants `heading_and_body`; clearing a section to
refill it wants `body_only`. The default preserves the structural anchor and the
document's outline.

This parameter stays where the near-identical one on `replace_section` was removed
(§3.5), and the difference is the point: here a session reported wanting **both**
variants, having done both. There it was a case someone might want. Same shape of
parameter, opposite evidence, opposite outcome.

Deletion deserves particular care: it is the one operation where a wrong anchor
destroys content the caller never saw and cannot diff, and where the agent's intent
("remove the obsolete section") is indistinguishable in the response from the
failure ("removed the wrong one"). Mitigations are §3.7 and §3.8.

### 3.7 Anchor resolution: never guess

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
  inserted above. That is the same fragility §3.9 rejects line-anchoring for, and it
  would be inconsistent to reject it there and adopt it here. A path is stable under
  reordering and breaks loudly under renaming, which is the correct direction to
  fail. A path that is still ambiguous is still an error.
- **Matching is exact on heading text**, after trimming whitespace. Normalised or
  fuzzy matching buys convenience and pays for it in precisely the silent-wrong-
  location failures this design exists to avoid.

A design that guesses here corrupts documents quietly, which is strictly worse than
one that refuses.

**How an agent learns the anchors in the first place.** Anchored edits presuppose
known headings, and an agent that has not read the document this session would
otherwise pay a full `get_document` — the cost this feature exists to remove — just
to discover them. Two answers, and deliberately neither is a new tool:

- The refusal errors above **teach structure lazily**, returning real candidates at
  exactly the moment they are needed. An agent that guesses a heading and misses is
  one round trip from the right one.
- For the up-front case, an **outline mode on the existing `get_document`** —
  **committed for v1** (register row 23; promoted 2026-08-08). A parameter on a
  read that already exists, not a fourth command:

  ```jsonc
  // cerefox_get_document { "document_id": "…", "outline": true }
  { "content_hash": "…",
    "total_chars": 38412,
    "outline": [
      { "path": "## Intake",             "level": 2, "chars": 2140 },
      { "path": "## Intake > ### Notes", "level": 3, "chars": 480 },
      { "path": "## Totals",             "level": 2, "chars": 610 }
    ] }
  ```

  Each entry carries the **path in exactly the form the anchor vocabulary
  accepts** (§3.7), so an outline entry can be pasted into an `anchor_heading`
  verbatim — the read and the write share one addressing language. Per-section
  sizes let an agent pick the cheapest enclosing section for a `replace_section`
  (§3.5) and see how close the document is to its split threshold (§3.8), and the
  `content_hash` is the concurrency token — the cheap hash-only lookup §5
  gestures at, absorbed here rather than built separately.

Session 4 proposed this as a new `cerefox_get_outline` tool. The need is real —
without it, anchored editing quietly assumes the agent has recently read the
document — but it earns its place as a mode of the read that already exists, not a
new name in the tool list.

### 3.8 What every operation returns

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

**Creation must return the hash too — a defect in today's API that this feature
would inherit.** `cerefox_ingest` creating a document returns id, chunk count and
size, but **no `content_hash`**. Session 4's next update therefore faced a choice
between re-reading a document it had just written and knew verbatim, or passing
`last_write_wins: true` — and it passed `last_write_wins`, repeatedly, as the path
of least resistance. That bypasses §5 entirely, on the first edit of every new
document, which is when a concurrent writer is least expected and a silent
overwrite least suspected. §5's assumption that "an agent that read the document
holds a hash" has a hole for the one agent that never needed to read it: the
author. Returning the hash on create closes it — a response-shape change, not new
computation, since the RPC already stores the hash. **Filed as
[#189](https://github.com/fstamatelopoulos/cerefox/issues/189) and worth fixing
ahead of this feature**: the defect stands on its own today, and this feature
cannot function without it (every operation requires the token, so a document must
be born holding one).

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

The measurement already exists — writes report byte counts today, and session 4
watched its documents grow through them. What is missing is the *policy*: a
configured threshold to compare against. The flag is a comparison on data already
returned, not new instrumentation.

**The flag rides the conflict response too, not only success.** An agent merging
after a conflict is an agent about to add content to a document that is both
contended and, often, already large — the exact moment the size matters most, and
the one where a success-only flag stays silent.

### 3.9 Deliberately excluded, and confirmed by usage

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
threshold that should have triggered a split instead of an append (§3.8 carries
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

Session 3 supplied the case that shows what this buys. Its three writes to repair
one mistyped link (§1) would, under a single `update-content` value, appear in the
trail as three content changes indistinguishable from three real edits. Distinct
terms let a reader tell *fixed a typo* from *rewrote the section*, which is most of
what an audit trail is for.

Three values, matching the three operations, **not one per position** and not one
per tool: a `cerefox_edit` call writes **one audit entry per operation it
contains**, each under its own value. The trail records what was done to the
document, and a batch does several things in one write. The
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

A `cerefox_edit` call snapshots **one** version, however many operations it
carries: it is one write, and its full-re-ingest equivalent would have produced
one version too. Operations within a call do not multiply history.

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

**A batched form — no longer deferred.** Two revisions kept it here as the
eventual answer to §3.2's atomicity cost, gated on evidence that sequences
actually break. Session 4 supplied it — coordinated edits are the *common case*
for documents with derived content, not a restructure tail — and the batch was
promoted into the contract as `cerefox_edit` (§3.4). Left as a note because it is
the register's first promotion (§9): a need parked as *open, not foreclosed* was
buildable when its evidence arrived, because the contract had been checked for
exactly that.

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
This rule is here because it was needed: §3.5's rename parameter was a reasoned
aside inside otherwise-observed feedback, and it was promoted to a near-decision
before anyone checked whether its own author had ever done it. They had not. Session
feedback is not uniformly evidence, and the sessions providing it have been the
first to say so.

**Losing the argument does not lose the need.** A suggestion that fails this bar is
removed from §3 and kept in the §9 register, where the technical design still has to
show it is not foreclosed. The evidence rule decides what gets *built*; it does not
decide what gets *heard*.

**Session 1** — the decision-log session that motivated the document.
**Session 2** — a strategy and registry knowledge base, 2026-08-08.
**Session 3** — an opportunity index, guides and status documents, 2026-08-08.
**Session 4** — daily logs with derived running totals, 2026-08-08.

Session 2 also reviewed the revision its own feedback produced, which is where
§3.3's nesting boundary, §3.7's path disambiguation, §3.8's conflict and size
semantics, and §3.2's atomicity note come from. Every one of those is an edge the
design would otherwise have left for the implementation to guess — which §3.7 exists
to say we do not do. A fifth suggestion from the same review, a rename parameter on
`replace_section`, was reasoned rather than observed and did not survive the check
(§3.5).

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
   rest is served by resending the enclosing section (§3.5).

3. **Would you accept an operation that does not return the document?**
   Yes, and it is preferred: return the new `content_hash` and size, not the body,
   because edits get chained and each follow-up needs a fresh token. Returning the
   body would spend the saved tokens on the response. Now §3.8.

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
   parameter in §3.6.

6. **If writes were cheap, how much more often would you write?**
   Meaningfully more. Session 2 batched changes deliberately to avoid expensive,
   risky re-ingests, and would have written each decision as it happened. Confirms
   the frequency jump §6.2 predicts, and that retention tuning is where it lands.

### Session 3, marked observed or reasoned

Recorded in the format §8 asks for, because it is the first set to arrive after the
rule existed.

**Observed:**

- **Write mix: almost no pure appends; overwhelmingly mid-document**, and dominated
  by single-line changes inside large sections (a checklist toggle, a status word, a
  link). Second independent session to land here.
- **Caused and caught a transcription corruption** while re-ingesting to change one
  link: a document ID mistyped in untouched body text, mangled again during the fix,
  a stray `FIXME` left behind, three writes to repair one intended change (§1).
- **Enclosing sections were 500–2,000 characters against 10,000–38,000 character
  documents**, which is the size of the prize for `replace_section` and the basis
  for the granularity guidance in §3.5.
- **A coordinated four-location restructure** whose parts referenced each other, done
  as one re-ingest because a half-applied version would be incoherent. Drove the
  then-interim rule in §3.2, since superseded: `cerefox_edit` (§3.4) makes the
  coordination atomic instead of advisory.
- **`end_of_section` would have surprised it**: a status section whose body is a
  checklist, followed by many subsections. Reversed the §3.3 decision.
- **Documents already near the split threshold** (~30,000 and ~38,000 characters)
  with no visibility into total size while editing. Supports §3.8's flag.

**Reasoned (weighted as such, per the rule above):**

- Session 2's mix is the norm for any store that outlives its first month.
- The three-tool split's ergonomic benefit is inverted for status-bearing stores
  (§3.2), since the freely-grantable additive tool is the least used.
- `end_of_section`'s parent's-own-body reading would win more often than the subtree
  reading. §3.3 refuses to guess rather than adopting either, since sessions 2 and 3
  read it in opposite directions.

### Session 4, marked observed or reasoned

**Observed:**

- **Write mix lands with sessions 2 and 3** — and even its daily logs were not
  append-dominant, because every appended row also updated a derived total under
  another heading. Third consecutive session where mid-document edits dominate.
- **Destroyed data through scope confusion** (§1): sent only the new day's section
  while meaning "append" against a replace-shaped call; caught it only through the
  size drop in the response.
- **Coordinated multi-location edits were the majority of its writes**, not an
  occasional restructure. The finding that promoted the batch into the contract
  (§3.2, §3.4).
- **Most common insert target was a table row mid-section**, which the heading
  vocabulary cannot address (§3.3, register row 22).
- **Bypassed concurrency control on every new document**: create returns no
  `content_hash`, so `last_write_wins` was the path of least resistance,
  repeatedly (§3.8).
- **Sections of 500–3,000 characters against documents of 2,000–7,000**:
  `replace_section` saves 60–80% there, not session 3's 90%+ (§3.5).

**Reasoned (weighted as such):**

- Scope confusion is likelier for agents than transcription drift, because it
  comes from intent rather than attention.
- A cheap structure read should exist. Proposed as a new `cerefox_get_outline`
  tool; taken up as an outline mode on the existing `get_document` instead (§3.7,
  register row 23).
- The size flag is policy over data already returned, not new measurement —
  recorded in §3.8.

### Still open

- **Is the mid-document mix the norm?** Three of four sessions say yes, and the
  fourth was writing under a policy that mandates appending (§3). Treated as the
  working assumption now; what would reopen it is a store where append-dominant
  survives maturity, not another opinion.
- **How common are duplicate headings in real stores?** §3.7 answers ambiguity with
  parent paths, which is the recoverable design, but it is untested against real
  documents. If collisions turn out to be pervasive, agents will spend a round trip
  on a large share of anchored writes and paths become the normal form rather than
  the fallback.
- **Does anyone reach for section rename?** Proposed as a `scope` parameter on
  `replace_section`, then **removed** (§3.5): it was reasoning, and the session that
  proposed it, asked to check, found no instance in its own edits. Watch for a real
  one before building. Until then, delete-then-insert covers it, with the
  no-such-section window that argued for the parameter in the first place — a known
  cost, deliberately accepted rather than designed away on speculation.
- **Does an error on an ambiguous anchor (§3.7) annoy more than it protects?** The
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
| 6 | Replace a section's body | **v1** | `replace_section` (§3.5) |
| 7 | Delete a section, body only or with its heading | **v1** | `delete_section` + `scope` (§3.6) |
| 8 | Change one line inside a larger section | **v1**, indirectly | resend the enclosing section (§3.5) |
| 9 | Address a heading that appears more than once | **v1** | parent paths (§3.7) |
| 10 | Get a fresh token without paying for the document | **v1** | hash + size, no body (§3.8) |
| 11 | See a conflict rather than have it resolved silently | **v1** | §5 |
| 12 | Know when a document is growing past its split point | **v1** | size flag (§3.8) |
| 13 | Rename a section while replacing its content | Open, not foreclosed | §3.5 — reasoned, never observed; `scope` is addable |
| 14 | Restructure atomically across several operations | **v1** | `cerefox_edit` (§3.4) — promoted from *open* when session 4 arrived |
| 15 | Insert or edit anchored to arbitrary text | **Excluded by design** | §3.9 — declined by the session that would have gained most |
| 16 | Add to a nested section without knowing its shape in advance | **v1** | `end_of_section` errors with both candidates (§3.3) |
| 17 | Apply a coordinated multi-location edit safely | **v1** | one `cerefox_edit` call (§3.4) |
| 18 | Know a document is nearing its split point while merging | **v1** | size flag on the conflict path too (§3.8) |
| 19 | Understand why one document edits cheaper than another | **v1**, as guidance | sectioning granularity is now a cost characteristic (§3.5) |
| 20 | Hold a concurrency token for a document you just *created* | **v1**, prerequisite | create returns `content_hash` (§3.8) — today-bug, filed as #189 |
| 21 | Express additive intent so a replace-shaped call cannot destroy | **v1** | `cerefox_insert` is its own contract (§3.3, §1) |
| 22 | Append a row to a table sitting mid-section | Open, not foreclosed | served without contract by structure — an append-heavy table gets its own heading, then `end_of_section` is the row-append (§3.3) |
| 23 | Learn a document's structure without paying for its body | **v1** | outline mode on `get_document` — a parameter, not a new tool (§3.7) |

**Row 14 is the register doing its job.** It was parked as *open, not foreclosed*
in one revision and promoted to **v1** in the next, when session 4 showed the need
was the common case rather than the tail — and the promotion was cheap precisely
because the contract had been checked for it in advance. Row 23 followed the same
path a revision later, promoted on maintainer decision. Rows 13 and 22 now hold
the open status, waiting on evidence. Row 15 is different in
kind: it is not waiting for evidence, it was refused with evidence.

**For the technical design that follows this spec**, this table is the checklist.
Every **v1** row needs a mechanism. Every *open, not foreclosed* row needs a
demonstration that adding it later is additive: a `scope` parameter defaulting to
today's behaviour (13), and an intra-section anchor form that does not open
arbitrary-text matching or bind the contract to one block syntax (22). If either
turns out to require a breaking change, that is a finding about §3 and belongs
back here, not a footnote in the implementation.

## 10. Related

- `docs/specs/concurrency-control-design.md` — the read→embed→write race this
  narrows
- `docs/specs/chunk-reconstruction-design.md` — content formats and the gapless
  partition guarantee that constrains §7
- `CLAUDE.md` → Cerefox Decision Log — the "append, never compress" rule that
  motivates §1
