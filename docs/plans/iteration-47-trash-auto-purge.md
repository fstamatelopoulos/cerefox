# Iteration 47 — Trash auto-purge (#251)

**Status:** merged (#306), releasing as v1.16.0.
Design: [`docs/specs/trash-auto-purge.md`](../specs/trash-auto-purge.md).

## Decisions

- **Trigger: the delete that adds to the trash also sweeps it** (maintainer, 2026-09-05;
  reaffirmed 2026-09-30). No scheduler: `pg_cron` ruled out for good, and a web-daemon
  timer would not run for Supabase-only users.
- `trash_retention_days` defaults to **60** (maintainer, 2026-09-30); both keys are
  editable from the CLI and the web Settings page; off by default.
- Minor release (new settings, schema 0.17.0), not a patch.

## Work

| Step | State |
|---|---|
| SQL: `cerefox_purge_expired_trash`, hook in `cerefox_delete_document` (`auto_purged`), allow-list, seeds, migration 0033 with grant lock-down; schema 0.17.0 | done |
| Catalog keys (high-impact, integer days 1–3650) | done |
| Settings confirmation shows how many trashed documents the next delete would purge (`GET /documents/trash?deleted_before=`) | done |
| `auto_purged` reported by `/api/v1`, MCP and CLI; agent-facing wording updated | done |
| `doctor` line | done |
| Docs: configuration, access-paths trust model, api.md, agent guides | done |
| Staging verification (see spec): all scenarios pass (off, bad values, preview = purged count, oldest-first, cap 100, concurrent 60 + 90, failure isolation, CLI/MCP output), Playwright 27/1 | done |
| Release v1.16.0 + Discord announcement (drafted, posted after go-ahead) | pending |
