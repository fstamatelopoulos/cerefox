# Document links: capabilities and guardrails

Cerefox documents can link to each other with ordinary markdown links. This
guide covers how linking works, and the deterministic guardrails (v1.7.0+)
that protect links from the most common way they break: an AI agent
corrupting a long document id while rewriting content.

## How linking works

Write a normal markdown link whose target is the document's UUID:

```markdown
See the [Opportunity Index](c937b70f-77af-43d3-b9bc-9f31e0d2041d) for details.
```

The Cerefox web UI resolves these at click time — the stored markdown is
untouched, and the link keeps working if the target is renamed. Every search
result and every write response includes the document id, so an id is always
one lookup away.

Four link forms are accepted; one is recommended:

| Form | Example target | Use |
|---|---|---|
| **Document UUID** | `c937b70f-…` | **Always, for cross-references.** Stable, unambiguous, encoding-safe, validated (below). |
| Repo-relative path | `docs/guides/quickstart.md` | Repo-ingested files only (their markdown naturally uses paths). |
| Basename | `quickstart.md` | Best-effort fallback for the same. |
| `[[Wikilink]]` | `[[Future Doc Name]]` | A deliberate **dangling** reference — "this document should exist someday." Never validated. |

Agent-specific writing rules live in `AGENT_GUIDE.md` → "Writing linkable
content".

## Why links need a guardrail: LLMs and long ids

This is worth understanding, because it explains the design and it is not a
bug in any particular AI model — it is structural.

A language model editing a document does not copy text the way a program
does. It **regenerates** the text token by token from an internal
representation. Normal prose survives this well because language is
redundant — if a word drifts slightly, the surrounding context constrains it
back. A UUID has **zero redundancy**: 32 hex characters, each independent,
carrying no meaning that could catch a mistake. `508e4c21` regenerated as
`502041d8` looks equally plausible to the model, and to anyone reading past
it.

Now compound that. A document with a table of 25–30 links makes an agent
regenerate 25–30 UUIDs *every time it rewrites that table*. Even an
excellent per-character accuracy, multiplied across hundreds of characters
of pure entropy, several times per session, makes occasional corruption
**expected, not unlucky**. This happened repeatedly in real use — three
corrupted links in one afternoon — and each corrupted id silently becomes a
dead link that read-back review may or may not catch.

Two defenses exist, and they compose:

1. **Reduce how much gets regenerated**: the partial-edit tools
   (`cerefox_insert`, `cerefox_edit`) change only the targeted section, so
   untouched links are never retyped and literally cannot corrupt. Give
   link-heavy tables their own heading so appends never rewrite existing
   rows.
2. **Catch what still gets retyped**: the write-time validation below.

## The write-time guardrail (v1.7.0+)

Every write — create, full update, or partial edit, on every surface (MCP,
CLI, web, GPT Actions) — validates the `[Text](uuid)` links in the content
against the store, inside the same database transaction as the write:

- **A link to a document id that does not exist rejects the whole write**,
  and the error lists every unresolvable id. Nothing is stored; the
  corruption never lands. The check is deterministic and costs ~1–2ms.
- **The agent can self-correct in the same turn**: the error says to re-read
  the source each link was copied from, fix the id(s), and resend — and
  explicitly not to retry unchanged.
- **Examples escape via code formatting.** A link inside backticks or a
  fenced code block is an example, not a link, and is not validated — which
  is also just correct markdown, since a bare link-syntax example would
  render as a real link. There is deliberately **no bypass flag**.
- **A trashed target still resolves** (the id denotes a document; restoring
  decides its fate). **`[[Wikilinks]]` are never validated** — that is the
  sanctioned form for a forward reference.

### Updates validate only what the write introduces

On an update, only **newly-introduced** link ids are validated. A dead link
the document *already carried* — typically because its target was purged
after the link was written — does not block an unrelated edit or a file
re-sync. Without this, one purge could make every document that ever linked
the purged target permanently unwritable through automated paths.

The corollary: a link that was mangled *before* v1.7.0, or whose target was
purged later, sits undetected in the content. That is what the sweep is for.

## The dead-link sweep (v1.7.1+)

```bash
cerefox document dead-links          # human-readable report
cerefox document dead-links --json   # machine-readable
```

One server-side pass over the whole knowledge base, reporting every
`[Text](uuid)` link whose target no longer exists — with the linking
document and an occurrence count. Same scanning rules as the write guard
(the two share one implementation, so they cannot disagree). Trashed
*linker* documents are excluded until restored. Run it after a purge, or
periodically; it is a full content scan, so it is deliberately on demand
rather than part of `cerefox doctor`.

Fix each hit by editing the linking document: correct the id, remove the
link, or backtick it as an example.

## Design record

The full rationale — including the rejected bypass-flag design, why fence
handling splits on lines instead of pairing with a regex, and the
probability analysis of a mangled id colliding with a real document — is in
[`docs/specs/link-integrity-design.md`](../specs/link-integrity-design.md).
