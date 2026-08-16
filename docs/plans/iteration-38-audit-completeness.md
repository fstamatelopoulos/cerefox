# Iteration 38 — Audit completeness, settings clarity, docs restoration (v1.9.0)

**Status: IN PROGRESS** (opened 2026-08-16). Branch: `feat/v1.9.0-audit-completeness`.
Target: **v1.9.0**, schema **0.13.0 → 0.14.0**, migration `0028`. No breaking changes.

## Why this iteration

Two questions from live operation exposed the same gap from different sides:
"does the audit log capture config changes?" (it does not) and "when was
`version_cleanup_enabled` set to false?" (unanswerable — `cerefox_config` has
no timestamps and no trail). An audit of every write path followed, and this
iteration closes what it found, plus a settings-UI terminology confusion and
a 22-finding documentation staleness sweep covering v1.4.0–v1.8.0.

## Audit coverage today (the map this iteration works from)

Audited **atomically in the RPC transaction**: document create / update /
partial-edit operations (one entry per operation) / delete / restore / purge /
set-metadata / title-FTS refresh.
Audited **client-side** (separate `cerefox_create_audit_entry` call):
document project memberships (all interfaces), version archive/unarchive
(CLI + web), review-status change (web).
**Not audited**: config changes; project create/edit/delete; relations
(dormant — excluded until its ship-or-remove decision); backup restore and
reindex (excluded deliberately: bulk mechanical writes would drown the trail,
and a restore is reproduction, not authorship).

## Steps

### 1. Config-change audit (schema 0.14.0, migration 0028) — the RPC side

- [ ] `cerefox_set_config` gains `p_author TEXT DEFAULT 'unknown'` and
      `p_author_type TEXT DEFAULT 'user'`; writes a `config-change` audit
      entry with `document_id = NULL` and description `key: 'old' → 'new'`
      (old value `(unset)` when the key is new). **DROP the old 2-arg
      signature explicitly** — the v1.7.0 PGRST203 lesson: `CREATE OR
      REPLACE` never removes a grown-out signature.
- [ ] Extend the `cerefox_audit_log.operation` CHECK allow-list with
      `config-change`, `project-create`, `project-edit`, `project-delete`
      (drop + re-add the constraint in schema and migration).
- [ ] Migration 0028 carries: the CHECK swap, the `DROP FUNCTION` of the old
      `cerefox_set_config(TEXT, TEXT)`, the new function body (repair-path
      closure, same rationale as 0027), and the dead-RPC drops (step 4).
- [ ] Bump schema version **in both literals, lockstep**: `-- @version:` in
      `schema.sql` and `cerefox_schema_version()` in `rpcs.sql` → `0.14.0`.
- [ ] `minSchema` review: stays 0.10.5 (nothing here makes an old server
      *misbehave* for a new client — config set against an old server fails
      loudly with a missing-function error, which `isMissingFunctionError`
      already maps).

### 2. Config-change audit — the callers

- [ ] CLI `config set`: pass `--author` / `CEREFOX_AUTHOR_NAME` (warn to
      `unknown` like the other write commands), `author_type` honoured as on
      other CLI writes.
- [ ] Web settings route: pass `author: "user"` (web UI writes always carry
      the `user` author, per convention).
- [ ] MCP: unchanged — config is deliberately not an MCP tool surface.
- [ ] Old-server tolerance: callers fall back to the 2-arg call shape when
      the 4-arg function is absent? **No** — keep it simple: the client ships
      with the schema that has it; `cerefox doctor` already tells a user with
      a version-skewed install to redeploy. Callers surface the
      missing-function error with the redeploy hint.

### 3. Project create/edit/delete audit — client-side, shared helper

Project CRUD is sanctioned "simple CRUD" (no business logic), so no new RPCs;
the audit entry is written client-side after the successful write, exactly
like the membership path (`_shared/mcp-tools/_projects.ts`).

- [ ] Shared helper (one implementation; CLI + web import it): operation
      `project-create` / `project-edit` / `project-delete`, `document_id`
      NULL, description carries the project name (+ what changed on edit).
- [ ] CLI `project create` / `project edit` / `project delete` wire it up
      (with the standard `--author` handling).
- [ ] Web project routes wire it up (`author: "user"`).
- [ ] Implicit creation (a project auto-created by `set-projects` /
      `ingest --project`) also logs `project-create`, author = the write's
      author. Creation is rare; this cannot flood.
- [ ] Audit-entry failure is a warning, not a rollback (the write itself
      succeeded; same posture as `_projects.ts` today).

### 4. Dead-RPC cleanup (rides migration 0028)

- [ ] Drop `cerefox_save_note` and `cerefox_context_expand`: Python-era V1
      leftovers, zero callers anywhere in the codebase, comments still
      pointing at "the Python ingestion pipeline" (removed at v1.0.0).
- [ ] Remove both from the `db-status` expected-RPCs list.

### 5. Settings-UI terminology (frontend only)

The confusion, verbatim from live use: a toggle showing "Off" directly above
the caption "default: true" reads as the system contradicting itself. Decision
(maintainer, 2026-08-16): **align the web UI with the CLI vocabulary** —
booleans display `true`/`false`, not On/Off.

- [ ] Switch label renders the value (`true`/`false`).
- [ ] Caption becomes `default if unset: <value>` (semantics now explicit).
- [ ] Gray badge `default` → `using default`.
- [ ] Playwright settings specs updated for the new strings.

### 6. Documentation restoration (22-finding sweep, v1.4.0 → v1.8.0)

Applied as the branch's first block (no code risk). Highest-impact clusters:
`solution-design.md` never got v1.8.0 (says archived chunks store embeddings;
pre-1.8.0 snapshot SQL; DDL missing `deleted_at`/`review_status`/metadata
CHECK) and misses `rename_section`; `requirements-and-specs.md` has no FR
numbers after v1.3 and describes versions as "plain text snapshots"
(never true), plus a retired env var presented as live;
`AGENT_QUICK_REFERENCE.md` opens with "19 MCP tools" (should be 15 core + 4
dormant); README + npm README cite retired `CEREFOX_VERSION_*` env vars /
lack v1.8.0 features and post-1.4 commands; `e2e-use-cases.md` lacks the
12-case acceptance harness as a layer and the v1.4/1.5/1.7/1.8 case rows;
`ops-scripts.md` inventory is pre-v1.0; `upgrading.md` misses the two
stricter-input transitions (v1.5.0 heading duplication, v1.7.0 trashed-doc
refusal); `staging-env.md` known-limits misses the v1.8.0 env-aware doctor
remediation note; `AGENT_GUIDE.md` gets a dormant-relations stub table.
The full 22-item list with file/line/fix lives in the PR description.

### 7. Issue housekeeping

- [ ] **#136**: not reproducible on main — swept all 19 production projects
      against a local web build; every one returns 200. Comment with the
      evidence, close.
- [ ] **#147**: this iteration ships bullet 1 (project-op audit entries) and
      the config-change extension of the same idea. Bullets 2 (audit FTS
      endpoint) and 3 (LLM knowledge processing) stay open; note that on the
      issue when 1.9.0 ships.
- [ ] **#150** (ops, maintainer action, zero code): flip **Disable legacy
      API keys** in the Supabase dashboard during the v1.9.0 release window,
      after confirming nothing outside Cerefox still uses the legacy JWTs.
      Immediately after the flip: `cerefox doctor` + acceptance suite to
      prove nothing regressed. Close #150 on success.

### 8. Release mechanics

- [ ] Tests: rpc-guard-invariants additions (set_config audits + old
      signature dropped; CHECK list extended; dead RPCs absent), CLI/web
      unit tests for the new audit calls, acceptance case for config-change
      audit (write → entry appears → filterable), Playwright updates (step 5).
- [ ] CHANGELOG `[Unreleased]`: Added (config/project audit), Changed
      (settings UI wording), Removed (dead RPCs), Fixed (docs restoration
      summary line).
- [ ] GPT Actions OpenAPI block: **no sync needed** — no EF request/response
      shape changes (config is not EF-exposed; audit-log EF query shape
      unchanged; new operation values flow through the existing `operation`
      string field).
- [ ] EF code: untouched → `EF_VERSION` bumps only via the release cut.
- [ ] Review rounds after the implementation batch, then RELEASING.md
      checklist; the maintainer cuts, stages, and we re-run the staging
      dress-rehearsal pattern (install released artifact on staging via the
      pinned staging CLI, battery, then prod).
