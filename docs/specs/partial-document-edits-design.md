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

**The agent does not supply `expected_content_hash`** — but the write still uses
one. The handler obtains it during its own read (§4) and passes it through. The
agent is spared the read-before-write round trip; the database is not spared the
concurrency check.

*Earlier drafts of this document claimed append is commutative and could skip the
token entirely. That is wrong, and the correction matters — see §5.*

### 3.2 `replace_section` — second, if usage justifies it

Replace the content under a markdown heading, leaving the rest untouched.

```jsonc
{ "document_id": "…", "heading": "## Outcome", "text": "…" }
```

Markdown headings are unambiguous anchors, and the chunker is already
heading-aware, so this aligns with how documents are structured rather than
imposing a new addressing scheme.

Requires the concurrency token like every other operation (§5); the difference
from `append` is that a conflict must surface rather than auto-retry.

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

1. Handler calls `cerefox_get_document` → current text **and** `content_hash`
2. Handler applies the operation in TypeScript (pure string work)
3. Handler chunks and embeds as the ingest path already does
4. Handler calls `cerefox_ingest_document` with the assembled result

**No new RPC is strictly required**, and the single-implementation principle is
preserved: local stdio and remote Edge Function get identical behaviour from one
handler. The only schema change needed is §6.

Note what this preserves: the read still happens, but *inside the handler*, not in
the agent's context. The agent sends only the delta. Both the token win and the
transcription win survive intact.

It also **shrinks the concurrency window dramatically**. Today the read→embed→write
race spans an entire agent turn (see `concurrency-control-design.md` §1). Here it
spans one handler invocation, so the exposure drops from minutes to the embedding
latency alone.

## 5. Concurrency

**Every operation keeps optimistic locking. None of them may skip it.**

An earlier draft argued that `append` is commutative — two agents appending both
survive, so the token could be dropped. That reasoning describes an *abstract*
append. It does not describe this implementation, which is a **read-modify-write
of the whole document**: reconstruct, apply, re-chunk, re-embed, write everything
back (§4). Concurrently:

```
A reads X, computes X+a
B reads X, computes X+b
A writes X+a
B writes X+b        ← A's append is silently lost
```

Last-write-wins, which is exactly the failure that motivated
`concurrency-control-design.md` in the first place. The operation would only be
commutative if the storage layer supported a true atomic append, and it does not:
content lives in chunks, not in a column you can concatenate onto.

The earlier draft also contradicted itself — it proposed retrying on
`CEREFOX_CONFLICT` while omitting the very token that makes a conflict
detectable.

| Operation | Token supplied by | Behaviour on conflict |
|---|---|---|
| `append` | Handler (from its own read) | Retry automatically: re-read, re-apply, re-write |
| `replace_section` | Handler, or the agent if it held one | Surface to the caller |
| `delete_section` | Handler, or the agent if it held one | Surface to the caller |

The distinction that survives is narrower than commutativity, and still useful:
for `append`, an automatic retry is **safe**, because re-applying the same text to
newer content yields the intended result. For a replace or a delete it is not —
the concurrent change may be exactly what the agent was editing around, so only
the agent can decide.

The real win is therefore ergonomic rather than semantic: the agent never holds
the document or the token, and the read→write window shrinks from an entire agent
turn to one handler invocation.

## 6. Audit and versioning

**Audit.** `cerefox_audit_log.operation` is `CHECK`-constrained, so a distinct
`append` (and later `replace-section`) value is a schema change, the same shape as
`relation-set` in iteration 29. Worth doing rather than logging these as
`update-content`: the audit trail should distinguish *added to* from *rewrote*,
especially given the compression risk in §1.

**Versioning — needs a decision, not a default.** Every content write currently
snapshots a version. An append-heavy log would multiply versions quickly. Options:

- snapshot every append (simple, honest, noisy)
- do not snapshot appends (append is additive; the previous state is a prefix)
- coalesce appends within a window

Retention is now configurable and defaults to 120 hours, which softens this, but it
is a deliberate choice either way.

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
5. For deletion: is addressing by heading enough, or do you need to remove
   something that is not a whole section?
4. Has re-sending a full document ever produced an edit you did not intend?

## 9. Related

- `docs/specs/concurrency-control-design.md` — the read→embed→write race this
  narrows
- `docs/specs/chunk-reconstruction-design.md` — content formats and the gapless
  partition guarantee that constrains §7
- `CLAUDE.md` → Cerefox Decision Log — the "append, never compress" rule that
  motivates §1
