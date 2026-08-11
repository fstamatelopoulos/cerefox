# Iteration 35 — Partial-edit follow-ups and guard debt

**Status**: BUILD COMPLETE, staging-validated — 2026-08-10, branch
`feat/1.4.0-section-read`. Awaiting sub-agent review, then release.
**Target**: **v1.4.0** (additive: a new operation, a new read parameter).
**Predecessor**: [iteration 34](iteration-34-partial-edits.md) shipped v1.3.0.

Eight tickets. Two are the partial-edit feature completing itself under real
usage (#198, #197); three are defects found by using it (#196, #193, #189); three
are guard debt that predates it (#171, #194, #168) and that this iteration is the
right size to clear.

## Why this iteration exists

v1.3.0 shipped a destructive operation without the read that makes it safe, and a
warning that cannot see the case it was built for. Both were found within a day,
by agents doing real work, and neither is a design reversal — they are the parts
the design assumed someone would already have.

The guard debt is here because #171 in particular is what would have caught the
#166 divergence and the beta.1 bundling failure. It is the cheapest correctness
win available and it protects every later phase in this iteration, so it goes
first.

## Scope decisions taken before starting

**#197 — `rename_section`, not `scope` on `replace_section`.** The issue offers
both. `scope: "heading_and_body"` mirrors `delete_section` and adds no operation,
but it does not solve the reported problem: `replace_section` replaces the body,
so renaming through it means resending the whole section body — and the agent's
objection was precisely "risking the body to fix a date". A rename that carries
the body reintroduces the resend-what-you-did-not-change problem the feature
exists to remove. A narrow fourth operation that *cannot* touch a body is the
honest model.

**#198 — a parameter on `get_document`, not a new tool.** Same shape as
`outline: true`. The binding requirement is symmetry: the read must resolve
extent through the same `resolveAnchor` / `resolveSectionEnd` the write uses, take
the same `section_part`, and refuse on the same ambiguity. If what you read is not
exactly what you would replace, the feature is worse than its absence, because
absence at least announces itself.

**#155 (UI e2e, 8/13 failing) is explicitly OUT.** Unknown cause, unbounded size,
and it needs a human to confirm what the UI *should* render. Its own session.

## Phases

Each phase ends green (typecheck + `bun test`) and commits on its own. A phase
that turns out bigger than its ticket suggests gets cut back to a filed issue
rather than expanding the iteration.

### Phase 0 — logistics
- Confirm `feat/1.4.0-section-read` is current with `main`.
- Bring **staging** to the tip of this branch (`server deploy`), confirm
  `doctor` prints `[STAGING]` before anything writes.
- ✅ **#189 closed** — verified live over MCP stdio against staging: create
  returns `content_hash: b7bb647a… — pass it as expected_content_hash`.
  Surfaced that the **CLI** create path still omits it → folded into phase 6.

### Phase 1 — ✅ #171 typecheck coverage (first, deliberately)
`bun run typecheck` is `cd _shared && tsc --noEmit`. `packages/memory` — the CLI,
the ingestion pipeline, the web server — is unchecked, and 9 errors are sitting
there now. A missing import already reached runtime this way.
- Fix the 9 existing errors.
- Extend the root `typecheck` script to cover both projects.
- Wire into CI so it cannot regress.
- **This runs first so every later phase is type-checked as it lands.**

### Phase 2 — ✅ #194 static guard on contributor scripts
`scripts/backup_*.ts` re-implemented CLI logic and drifted for two releases while
reporting success. Both are shims now; this makes the class impossible.
- A test asserting `scripts/` does not import the modules that constitute
  business logic (the `_shared/backup`-shaped dependency), so a future script
  cannot grow its own copy.
- Keep it a *static* check — no network, no execution.

### Phase 3 — ✅ #198 section read
- `get_document(section: "## X", section_part?)` → that section's text,
  `content_hash`, size.
- Extent resolved by the **same** functions as the write path.
- Same anchor rules (literal heading first, then ` > ` path), same
  `AmbiguousAnchorError`, same refusal on a section with children.
- Property test over existing fixtures: for any document and anchor,
  `get_document(section: X, section_part: P)` returns exactly what
  `replace_section(anchor: X, section_part: P)` would overwrite. That equivalence
  is the whole feature.
- Read-only: no schema change, no RPC change.

### Phase 4 — ✅ #197 `rename_section`
- Fourth operation on `cerefox_edit`: `{op, anchor_heading, new_heading}`.
  Body and position untouched; heading text only.
- Level change is out of scope for v1 unless it falls out for free — a rename
  that silently re-parents a subtree is a different, larger operation.
- **Schema bump**: audit CHECK widened for the new operation value → migration
  0021, both version literals in lockstep (`schema.sql` marker +
  `cerefox_schema_version()`).
- Guide note: a rename changes the anchor, so a later op in the same batch
  targeting the old heading fails — correctly, and the error says so.

### Phase 5 — ✅ #196 shrink warning
The percentage threshold (>25%) structurally cannot see the case it was built
for, because the content lost is small *precisely because it was recently added*.
- Proposal: surface **any** net content loss with its magnitude, and reserve the
  loud warning for the large-ratio case. The 25% gate is what hides the small
  absolute loss; removing the gate rather than retuning it is the fix.
- Test the motivating sequence directly: `end_of_document` insert, then
  `replace_section` on the last heading, and assert the response says content was
  removed.

### Phase 6 — ✅ #193 CLI `--source` default
`cerefox document ingest` declares `--source` defaulting to `"cli"` and always
sends it, so re-ingesting without `--source` relabels provenance. #191 fixed the
RPC for callers that *omit* it; the CLI never omits.
- Send `source` only when the user passed it.
- Regression test at the CLI level, not just the RPC level — that is where the
  gap was.
- **Also here: the CLI create path prints no `content_hash`.** Found in phase 0
  while verifying #189, which fixed exactly this on the MCP path. Same defect,
  different surface: a CLI user who creates a document has no token for its
  first edit. Both are `document ingest`, so they land together.

### Phase 7 — ✅ #168 environment-labelled MCP server name
`configure-agent` registers under the fixed name `cerefox`, and agent configs are
global, so running it from staging silently repoints production agents.
- `CEREFOX_ENV_LABEL` set → derive the server name from it; unset → `cerefox`,
  unchanged.
- Update `docs/guides/staging-env.md`, which currently says "don't run this
  against staging yet", and `connect-agents.md` / `configuration.md`.

### Phase 8 — ✅ docs, release prep, and the things that are easy to forget
- **Agent-facing docs**: `AGENT_GUIDE.md` + `AGENT_QUICK_REFERENCE.md` gain
  `rename_section` and the section read, then **re-run `bun scripts/bundle_help.ts`**
  so `get_help` carries them. (Bundled content is generated — editing the
  markdown alone ships nothing.)
- **GPT Actions OpenAPI block** in `connect-agents.md`: sync + `info.version`
  bump if any EF request/response shape moved.
- **Compatibility matrix**: review `minSchema` in `_shared/compatibility/`.
  Raise it only if a client against an older server *misbehaves*, not merely
  because the schema moved.
- **CHANGELOG** `[Unreleased]`, anchored on the heading, which never moves.
- **Release notes must say: reconnect your MCP client.** Session 8 spent hours
  concluding the remote server was missing a tool when it was a stale
  client-side `tools/list` cache. Every 1.4.0 user meets this with
  `rename_section`. This belongs in the upgrade block, not a footnote.
- Spec + register updates for anything a phase changes.

### Phase 9 — ✅ staging validation
Staging is dedicated to this iteration and may be changed freely.
- `server deploy` from the branch; verify schema version and `[STAGING]`.
- Live CLI suite against staging, including the new paths.
- Adversarial round in the shape of `prod-round2.ts`: the equivalence property
  (#198), rename-then-target-old-anchor in one batch (#197), the
  insert-then-clobber sequence (#196), provenance preservation (#193).
- Restore anything toggled; report what was run.

### Phase 10 — ✅ report
Written for the sub-agent review that follows, not as a summary of effort: what
changed, what was verified and how, what was deliberately not done, and where the
risk sits.

## Then

Sub-agent review → decide release shape (**normal release preferred** — several
small fixes, no single risky change) → prod deploy → CLI validation by this
session, MCP validation by the user's agents over both local and remote.

## Guardrails

- Staging only until the review passes. Production is not touched by this
  iteration.
- Every phase green before the next starts; no phase left half-landed.
- A ticket that grows past its phase gets filed, not absorbed.
- Anchor scripted edits to line-start patterns and assert the match is unique
  (`plan.md`, 2026-08-09).
- Private detail from agent reports (documents, holdings, domains) does not enter
  the repo, the specs, or issues.


---

## Outcome

**All eight tickets closed. 10 commits, no ticket deferred, #155 out as planned.**

| Verification | Result |
|---|---|
| `bun run typecheck` (now both projects) | 0 errors |
| `_shared` unit tests | 495 pass, 0 fail |
| `packages/memory` suite (built bin) | 190 pass, 0 fail, 2 skip |
| Staging acceptance, local MCP stdio | 22 / 22 |
| Staging, remote `cerefox-mcp` Edge Function | section read served end-to-end |
| `doctor [STAGING]` after the run | all checks pass |

### What staging caught that the tests did not

Three things, all wording or behaviour visible only in a real response:

1. **`AmbiguousPositionError` said "No write was performed" on a read.** The
   reassurance exists to stop an agent retrying a half-applied batch; on a read
   it implies an attempt that could never have happened. Fixed in phase 3.
2. **The other two anchor errors still said it** — the fix above was applied in
   one place and looked complete. The first remote call with a mistyped anchor
   printed it. Fixed in phase 9, with a test across all three.
3. **The CLI create path printed no `content_hash`.** #189 fixed exactly this on
   the MCP path in v1.3.0 and the CLI was never checked. Found in phase 0 while
   verifying that ticket for closure.

### What phase ordering bought

Putting #171 first was worth it beyond closing the ticket. Every one of the six
type changes in the #193 work — widening `source` to `string | null` through the
pipeline, the four `IngestResult` return sites, and one coalesce that would have
turned an explicit null straight back into a relabel — was surfaced by the new
`packages/memory` coverage. On the old script all six were invisible.

### Deliberate non-changes

- **`minSchema` not raised** to 0.11.1. Migration 0021 only widens an audit
  CHECK; against a 0.11.0 server a rename fails loudly at the constraint rather
  than doing something wrong, and blocking `cerefox web` from starting over one
  operation would be the more harmful failure. Reasoning recorded beside the
  constant.
- **GPT Actions OpenAPI block untouched.** The primitive Edge Functions do not
  share the MCP tool handlers, so no shape in that spec moved.
- **`#197` built as `rename_section`, not `scope` on `replace_section`** — the
  smaller form does not solve the reported problem, since replacing carries the
  body.

### Risk, for the review to probe

- `rename_section` replaces the heading line directly rather than through
  `spliceBlock`. That is deliberate (blank-line normalisation is wrong for a
  single line), but it is the one place in the string layer that does its own
  splicing.
- `touchedTrailingSection` re-parses the pre-edit document to decide whether the
  loud warning fires. Correct, and a second parse per destructive edit.
- The CLI's `isUpdateIntent` heuristic labels a create as `cli` and an update as
  "preserve". `--update-if-exists` against a document that does not exist takes
  the preserve path and lands on the RPC's `agent` default.
