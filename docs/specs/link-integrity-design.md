# Referential integrity for UUID document links (#214)

**Ships in v1.7.0. Status: implemented alongside this spec.**

## Problem

Cerefox's convention for cross-document links inside content is
`[Text](document-uuid)` — UUIDs are the only fully reliable link form
(stable across renames, never ambiguous). But agents that regenerate content
containing UUIDs corrupt them at a structurally irreducible rate: a language
model reproduces text token by token from a fuzzy internal representation,
and a 32-hex-character random identifier has zero redundancy — nothing in the
surrounding context constrains a mis-generated character back toward correct.
An agent regenerating a table with ~30 UUID links several times per session
makes occasional corruption *expected*, not unlucky. The partial-edit tools
(iter-34) reduce exposure — untouched text is never retyped — but whatever
still gets retyped has no safety net, and a mangled id silently becomes a
dead link that read-back verification may or may not catch.

## Design

**A write-time referential-integrity check inside `cerefox_ingest_document`.**
One RPC site covers every surface (MCP ingest, the partial-edit tools — which
resend assembled content through this same RPC — the CLI, and the web app),
atomically with the write it guards.

1. **Scope: the `](uuid)` markdown-link form only.** Those links are always
   meant to resolve — that is why agents use them. `[[wikilinks]]` remain
   unvalidated: they are the sanctioned dangling/"file it later" form.
2. **Markdown-native escaping — no API flag.** Fenced code blocks
   (``` ``` ```) and inline code spans (`` ` ``) are stripped before
   scanning. A literal example of link syntax outside code would render as a
   real link anyway, so examples belong in code formatting — which is both
   correct markdown authoring and the escape mechanism. The originally
   considered `skip_link_validation` parameter is deliberately absent: flags
   weaken guards, and there is no legitimate case left for one.
3. **Resolution**: all distinct candidate ids resolve in one
   `WHERE id = ANY(...)` primary-key lookup. A **trashed** document counts as
   resolving — the check asks "does this id denote a document," not "is it
   currently visible."
4. **Failure is a hard reject** listing every offender:
   `CEREFOX_UNRESOLVED_LINKS: N linked document id(s) do not exist: <ids> …`
   under ERRCODE `22023` (deterministic; never a retryable SQLSTATE). The
   `CEREFOX_` prefix is machine-detectable per the established convention;
   transport handlers rephrase it agent-first so the agent self-corrects in
   the same turn — the same closed loop as the hash-conflict errors. The web
   edit route maps it to a 422 with human wording.

## Consequences accepted deliberately

- **Editing a document that already contains a dead link fails until the
  link is fixed.** Partial edits resend full content, so a link whose target
  was purged after linking surfaces on the *next* edit of the linking
  document — "silent dead link" becomes "flagged on next edit." The remedy
  is always cheap: correct the id, remove the link, or backtick it as an
  example.
- **No forward references by UUID — by construction, not by rule.** A UUID
  exists only after its document does, so an author cannot legitimately link
  a not-yet-created document by id. (`[[wikilinks]]` cover that need.)
  Consequently there is no bulk-import ordering problem: `backup_restore`
  bypasses the RPC entirely (direct inserts), and `ingest-dir` content links
  by repo paths, not UUIDs.
- **A mangled id that collides with a different real document passes.**
  With 122 random bits against a KB of thousands of documents, the collision
  probability is negligible; the practical catch rate is ~100%.

## Cost

One regex pass over the content (linear, in C) plus one indexed lookup for
all candidates together: **~1–2ms** per write, against an embedding call of
hundreds of milliseconds. Latency was evaluated and dismissed as a concern.

## Phase 2 (not in v1.7.0)

The write-time guard protects new writes only. A read-only whole-KB sweep —
`cerefox_find_dead_links()` + a `cerefox doctor` line or CLI verb — finds
dangling `](uuid)` links retroactively (e.g. targets purged after linking).
Tracked in #214.
