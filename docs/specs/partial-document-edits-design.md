# Partial Document Edits

**Status**: Draft for feedback — not implemented. Seeking input from real agent
sessions before committing to semantics.
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

## 2. Design principle

> The agent sends **what changed**. The server owns **assembling the result**.

Everything below follows from that. The agent never holds the full document in
order to modify part of it.

## 3. Proposed operations

Ordered by value-to-risk. The recommendation is to ship (1) alone, gather usage,
and only then decide on (2).

### 3.1 `append` — ship this first

Add text to the end of a document.

```jsonc
{ "document_id": "…", "text": "\n## 2026-08-08 — …\n…" }
```

Covers the dominant real pattern: decision logs, activity logs, journals, running
notes, meeting records. In the session that motivated this document, **100% of the
writes were appends**.

**Requires `expected_content_hash`, like every other content write** (§5). The
agent supplies the hash it last saw — `cerefox_search`, `cerefox_metadata_search`
and `cerefox_get_document` all already return one, so an agent that read the
document in order to decide what to append is holding it already.

### 3.2 `replace_section` — second, if usage justifies it

Replace the content under a markdown heading, leaving the rest untouched.

```jsonc
{ "document_id": "…", "heading": "## Outcome", "text": "…" }
```

Markdown headings are unambiguous anchors, and the chunker is already
heading-aware, so this aligns with how documents are structured rather than
imposing a new addressing scheme.

Requires the concurrency token, like every other content write (§5).

Open questions: heading matched exactly or by normalised text? What if the heading
appears twice? What if it is absent — error, or append? A design that guesses here
will corrupt documents quietly, so these need answers before implementation, not
during.

### 3.3 `delete_section` — same family as replace

Remove the content under a heading. Shares every addressing question with
`replace_section`, and adds one of its own: does the heading itself go, or only
the body beneath it?

Deletion deserves particular care. It is the one operation where a wrong anchor
destroys content that the caller never saw and cannot diff, and where the agent's
intent ("remove the obsolete section") is indistinguishable from the failure
("removed the wrong section") in the response.

### 3.4 Deliberately excluded from v1

**Find/replace on arbitrary strings** and **diff/patch application**. Both fail in
the worst possible way: silently editing the wrong location. String matching breaks
on whitespace and on ambiguity when the target appears more than once, and
producing a correct unified diff is exactly the class of task a language model does
*almost* right. Neither should ship until the simpler operations have proven the
surface.

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

So all three operations behave identically: token required, conflict raised,
`CEREFOX_CONFLICT` returned with the current hash, agent decides.

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
`append`, and later `replace-section` and `delete-section`. That is a change to
the `cerefox_audit_log_operation_check` constraint, the same shape as
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
may take thirty. Version growth is a real consequence of this feature, but it is
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

## 8. Questions for real sessions

Feedback wanted from agents actually using Cerefox as memory, not from review:

1. **What fraction of your writes are pure appends?** If it is most of them, ship
   `append` alone and stop. This single answer decides whether §3.2 is worth its
   complexity.
2. When you do edit mid-document, what are you addressing — a heading, a known
   line, a semantic region ("the part about X")?
3. Would you accept an append that does not return the resulting document, to
   avoid the response cost? Or do you need the new `content_hash` back for a
   follow-up edit?
4. Has re-sending a full document ever produced an edit you did not intend?
5. For deletion: is addressing by heading enough, or do you need to remove
   something that is not a whole section?
6. If appends are cheap, how much more often would you write? Every one of them
   snapshots a version (§6.2), so this is what tells us whether the 120-hour
   retention default is still sensible once this ships.

## 9. Related

- `docs/specs/concurrency-control-design.md` — the read→embed→write race this
  narrows
- `docs/specs/chunk-reconstruction-design.md` — content formats and the gapless
  partition guarantee that constrains §7
- `CLAUDE.md` → Cerefox Decision Log — the "append, never compress" rule that
  motivates §1
