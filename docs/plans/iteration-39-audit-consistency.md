# Iteration 39 — Audit consistency: the web save on shared cores (v1.10.0)

**Status: IN PROGRESS** (opened 2026-08-18). Branch: `feat/v1.10.0-audit-consistency`.
Target: **v1.10.0**, schema **0.14.1 → 0.15.0**, migration `0030` (revised in
review round 1 — see below; the plan originally claimed no schema change).

## Why

The maintainer, reading the audit log after v1.9.x made it worth reading,
found `Updated via web UI (title=false, metadata=true, projects=true)` — an
entry that (a) reads like nothing else in the trail and (b) records what the
HTTP request *carried*, not what changed (`metadata=true` fired on an
unchanged metadata blob the editor always sends). Analysis traced the styling
inconsistency to implementation multiplicity — the web document-save was the
last multi-facet write not built on shared cores — and surfaced two latent
functional bugs riding the same route since iter-24E:

1. **Web title renames silently degraded search**: the route raw-updated
   `title` without the `cerefox_update_chunk_fts` refresh title boosting
   requires (the CLI path had it).
2. **Web metadata saves bypassed the #212 guards**: raw table replace, no
   merge guard, no corrupt-value protection, no per-key audit report.

## Design decisions (maintainer-confirmed 2026-08-18)

- **Per-facet audit entries, not a combined one.** Iteration 33 precedent: a
  `cerefox_edit` batch writes one entry per operation so the trail
  distinguishes what happened. A combined entry would keep the same intent
  producing different records on different interfaces.
- **Consolidation lives at the orchestration layer.** New shared module
  `_shared/mcp-tools/_document-meta.ts`:
  - `changeDocumentTitle` — write + FTS refresh + `Title changed: 'a' → 'b'`
    entry (upgrading the CLI's bare "Edited title" too). Re-embedding stays
    deferred to the next content update/reindex, as documented.
  - `setDocumentProjectsByIds` — the id-based twin of the name-based replace
    (web speaks ids); validates every id BEFORE the destructive replace;
    identical audit text (`Set document projects to […]`).
  - `updateDocumentFacets` — sequencing wrapper for one-user-action saves;
    each facet diffs against the STORED value and is skipped when unchanged,
    so the trail never records non-events. No combined entry.
- Metadata routes through `cerefox_set_document_metadata` (replace mode),
  inheriting the guards and the per-key report.
- `AccessPath` widened to the documented domain (`webapp`, `edge-function`).

## Steps

- [x] Shared cores + orchestrator, unit-tested (8 cases: unchanged facets
      write nothing; FTS refresh present; validation precedes the replace;
      metadata via the guarded RPC).
- [x] Web save branch on the orchestrator; local membership helper and the
      boolean-flags entry deleted; response reports per-facet outcomes.
- [x] CLI `document edit` title facet on the shared core.
- [x] Review round 1 (10 findings, all applied). The one that changed the
      design: the title facet's three client-side steps could commit the
      rename and then fail the FTS refresh, with the retry early-returning
      on the already-renamed title — permanently stale search. Title renames
      moved into an atomic `cerefox_rename_document` RPC (row + FTS + audit
      in one transaction; schema 0.15.0, migration 0030, sandbox 10/10).
      Also: unified membership tail (both twins delegate; unchanged set =
      no-op everywhere, a deliberate behavior change for the MCP path);
      typed facet errors (404/400 mapping, CLI error classes, honest
      partial-application reporting); carried-`{}` clears metadata;
      replace-mode null normalization; frontend toasts show server detail.
- [ ] Suites + Playwright green; PR review round 2.
- [ ] Post-cut staging battery: exercise all facet combinations via web API
      + CLI, **deliberately leaving the test documents and audit entries in
      place** for joint inspection of the trail (maintainer request).

## Description style (the residual, for future writers)

Entries state facts that occurred, in the writer's voice:
`<what happened>: <object> (<specifics>)` — e.g. `create: TITLE (7 chunks,
22247 chars)`, `Title changed: 'a' → 'b'`, `Set document projects to [x]`,
`config: key: 'old' → 'new'`. Never record request shape, never record a
change that did not happen. New writers should reuse an existing core; a
writer that cannot must match this grammar.
