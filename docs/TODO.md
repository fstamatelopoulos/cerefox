# TODO — retired (v1.0.6, 2026-08-04)

**This file is no longer maintained. The backlog lives in [GitHub Issues](https://github.com/fstamatelopoulos/cerefox/issues).**

Why: a markdown backlog drifts silently — it has no state, no owner, no
notification, and nobody (contributors least of all) thinks to open it. Several
entries here described bugs that had already been fixed and files that no longer
existed. Issues are where the maintainer and contributors actually look.

## Where things went

- **Unscheduled ideas and enhancements** → migrated to issues #140–#149, grouped
  by area (data safety, search ranking, embedders, ingestion sources, writing-tool
  adapters, advanced retrieval, web UI, audit/governance, infrastructure,
  backup/sync + MCP integrations).
- **Active and planned work** → [`plan.md`](plan.md), whose `## Current Focus`
  block is the live status and the cross-session hand-off artifact.
- **Design rationale** → [`specs/`](specs/) and [`research/`](research/).
- **Release notes** → [`../CHANGELOG.md`](../CHANGELOG.md).

Entries dropped as obsolete during the migration: an ingestion-rollback bug
(ingestion became atomic when it moved into the `cerefox_ingest_document` RPC),
a `sync_docs.py` refactor (Python was removed at v1.0.0; the TS script already
uses the Edge Function path), multi-language FTS (live as #129), and two
tunables shipped in v1.0.6.

**Adding something new?** Open an issue. If it is work you are starting now,
record it in `plan.md` instead.
