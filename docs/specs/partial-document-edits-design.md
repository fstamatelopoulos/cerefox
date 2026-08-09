# Partial Document Edits

**Status**: Draft — not implemented. Revised 2026-08-08 against feedback from a
second real session, which contradicted the scope this document originally
proposed (§3, §8). Still seeking sessions before committing to semantics.
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

## 3. Proposed operations

Two real sessions have now reported their write mix, and they disagree:

| session | pure appends | mid-document edits |
|---|---|---|
| the one that motivated this doc (decision log) | 100% | 0% |
| a strategy/registry knowledge base, 2026-08-08 | ~30% | ~70% |

That disagreement is the most useful thing we know, and it is not noise. The split
falls along **document kind**, not along agent or habit: registries and logs
accumulate at the end, while strategy documents, plans and indexes get edited in
place. A knowledge base that is mostly the first kind sees mostly appends; one that
is mostly the second sees mostly section edits. Both kinds are normal, and a store
tends to accumulate the second kind as it matures.

**The earlier recommendation is therefore withdrawn.** This document previously
proposed shipping `append` alone, gathering usage, and only then deciding on
anything else. Against the second session, `append` alone would have covered
roughly 30% of writes and left the other 70% doing exactly what §1 describes: full
re-ingests of 6,000 to 13,000 character documents to change a few lines, each one
reproducing tables and contact lists verbatim while editing something unrelated.

**Minimum viable set: `append`, `append_to_section`, `replace_section`.** The first
two share a safety profile and should ship together; the third is what makes
line-level edits tolerable without a line-level primitive (§3.8).

Every operation below requires `expected_content_hash` and surfaces conflicts
rather than retrying them (§5), and every one returns the new hash rather than the
document (§3.6).

### 3.1 `append` — add to the end of a document

```jsonc
{ "document_id": "…", "text": "\n## 2026-08-08 — …\n…" }
```

The dominant pattern for decision logs, activity logs, journals, running notes and
meeting records. Purely additive: it cannot destroy existing content, because it
never addresses any.

### 3.2 `append_to_section` — add to the end of a section

```jsonc
{ "document_id": "…", "anchor_heading": "## Active decisions", "text": "- …" }
```

**This is the highest-value operation in the set after `append`, and it was the gap
in the previous draft.** Requested directly by the second session, which reached
for it more than anything else: adding a bullet to a list under a heading, adding a
lesson under a subheading, adding a block inside an existing section.

It belongs next to `append` rather than next to `replace_section` because it shares
`append`'s safety profile rather than `replace_section`'s. It is *append, scoped to
a section*: purely additive, anchored to an unambiguous heading, and structurally
incapable of clobbering content. Everything that makes `append` safe to ship first
is equally true of it. The only new machinery is anchor resolution (§3.5), which
`replace_section` needs anyway.

Together, `append` and `append_to_section` would have covered roughly 70% of the
second session's writes with two operations that cannot silently lose anything.

### 3.3 `replace_section` — swap the body under a heading

```jsonc
{ "document_id": "…", "anchor_heading": "## Outcome", "text": "…" }
```

Not purely additive, so it carries real risk, but bounded: a wrong anchor damages
one section rather than a document.

It also carries a load the previous draft did not credit it with. Roughly half of
the second session's mid-document edits were to a **single line or bullet inside a
larger section**, not to a whole section. `replace_section` serves those by having
the agent resend the enclosing section, which is small, reviewable, and safe. That
is worse than surgical and much better than resending the document, and the
alternative (a line-anchored primitive) is the one thing the same session asked us
not to build. See §3.8.

### 3.4 `delete_section` — remove a section

```jsonc
{ "document_id": "…", "anchor_heading": "## Obsolete", "scope": "body_only" }
```

The previous draft left "does the heading itself go, or only the body?" open. It is
answered: **a `scope` parameter, defaulting to `body_only`**, because both are real
needs. Removing a subsection outright wants `heading_and_body`; clearing a section
in order to refill it wants `body_only`. Defaulting to `body_only` is the safer of
the two, since it preserves the structural anchor and leaves the document's outline
intact.

Deletion still deserves particular care: it is the one operation where a wrong
anchor destroys content the caller never saw and cannot diff, and where the agent's
intent ("remove the obsolete section") is indistinguishable in the response from
the failure ("removed the wrong one"). The mitigation is §3.5 plus returning enough
in the response (§3.6) to notice.

### 3.5 Anchor resolution: never guess

Every heading-anchored operation shares one failure mode, and it is the one that
corrupts documents quietly. The rules:

- **Absent anchor → error.** Never fall back to appending at the end. An agent that
  mistyped a heading and got a silent append has a document with content in the
  wrong place and a success response.
- **Ambiguous anchor → error, naming the collisions.** Duplicate headings are
  common in real documents (`### Notes` under three parents). Matching the first is
  a coin flip that writes to the wrong section half the time. The error should say
  what matched so the agent can disambiguate.
- **Matching is exact on the heading text**, after trimming whitespace. Normalised
  or fuzzy matching buys convenience and pays for it in exactly the silent-wrong-
  location failures this whole design exists to avoid.

A design that guesses here corrupts documents quietly, which is strictly worse than
one that refuses.

### 3.6 What every operation returns

**The new `content_hash` and the resulting size. Not the document body.**

Requested explicitly, and it matters: agents chain edits, and each follow-up write
needs a fresh token for its `expected_content_hash` (§5). Returning the full
document would spend exactly the tokens the feature exists to save, on the response
side, undoing the win.

### 3.7 Deferred: `insert_before` / `insert_after`

Inserting a new section *between* two existing ones, or lead-in text immediately
after a heading and before its body. Real needs, but a tier below the above: they
address the **seam** between sections rather than a section itself, so anchor
uniqueness matters more, and getting it wrong misplaces content rather than
misaddressing it. Ship the three-operation set first.

### 3.8 Deliberately excluded, and confirmed by usage

**Find/replace on arbitrary strings** and **diff/patch application**. Both fail in
the worst possible way: silently editing the wrong location.

This was a prediction in the previous draft. It now has direct support from the
session with the most to gain from it. Asked whether it wanted line-anchored
editing ("insert after the line containing X"), having just spent a session doing
line-level edits by hand, the answer was no: *"I'd rather resend a section via
`replace_section` to change one line within it than have a line-anchored primitive
that guesses."* The stated sweet spot is section-scoped operations, with line-level
changes served by resending the enclosing section.

That is a user declining a feature that would have saved them effort, because the
failure mode is unrecoverable and invisible. Worth recording as the strongest
evidence in this document.

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
threshold that should have triggered a split instead of an append. Auto-retry
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

**Decided: each partial-edit command gets its own `operation` value** —
`append`, `append-to-section`, `replace-section` and `delete-section`. That is a
change to the `cerefox_audit_log_operation_check` constraint, the same shape as
`relation-set` / `relation-delete` in iteration 29.

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

**Incremental chunking and embedding.** Version one should still re-chunk and
re-embed the whole document server-side. The agent-side win (tokens, transcription
safety) and the server-side win (embedding cost) are **separable**, and the second
is much harder: appending shifts chunk boundaries, and content format 2 guarantees
an exact gapless partition that must continue to hold. Ship the API shape first,
prove it, then optimise.

## 8. What real sessions have said

Answers below come from agents actually using Cerefox as memory, not from review.
Where a session contradicts an assumption in this document, the session wins.

**Session 1** — the decision-log session that motivated the document.
**Session 2** — a strategy and registry knowledge base, 2026-08-08.

More are being gathered, including from another contributor's agents. **Add rows
and answers here rather than rewriting the section**: the disagreement between
sessions is the finding, and flattening it into a single narrative would discard
the only thing that has actually moved this design. Two sessions already reversed
its scope; a third that agrees with either one is worth as much as one that does
not.

1. **What fraction of your writes are pure appends?**
   Session 1: 100%. Session 2: ~30%, with ~70% mid-document. This is what
   withdrew the "ship `append` alone" plan and added `append_to_section` (§3).
   The split tracks document kind, not agent preference.

2. **When you edit mid-document, what are you addressing?**
   Heading-anchored sections, and about half the time a single line or bullet
   *within* one. Heading addressing covers roughly half the need directly; the
   rest is served by resending the enclosing section (§3.3).

3. **Would you accept an operation that does not return the document?**
   Yes, and it is preferred: return the new `content_hash` and size, not the body,
   because edits get chained and each follow-up needs a fresh token. Returning the
   body would spend the saved tokens on the response. Now §3.6.

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
   parameter in §3.4.

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
- **`insert_before` / `insert_after` (§3.7)** — wanted, deferred. Does resending a
  section cover the need well enough that the seam operations never become
  worthwhile?
- **Does an error on an ambiguous anchor (§3.5) annoy more than it protects?** The
  design deliberately refuses rather than guesses. Real duplicate-heading
  documents will tell us whether the refusal lands as safety or as friction.

## 9. Related

- `docs/specs/concurrency-control-design.md` — the read→embed→write race this
  narrows
- `docs/specs/chunk-reconstruction-design.md` — content formats and the gapless
  partition guarantee that constrains §7
- `CLAUDE.md` → Cerefox Decision Log — the "append, never compress" rule that
  motivates §1
