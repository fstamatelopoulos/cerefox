# Trash auto-purge (#251)

Status: **agreed, being built** (iteration 47). Decision history:
`docs/plans/iteration-45-empty-trash.md` (the options table), confirmed by the
maintainer on 2026-09-05 and again on 2026-09-30, when `pg_cron` was ruled out
for good.

## The ask

An opt-in setting, **off by default**: documents that have been in the trash
longer than N days are purged permanently. N is `trash_retention_days`,
**default 60**, editable from `cerefox config set` and the web Settings page
like every other runtime setting. For stores where agents write and delete a
lot, the trash otherwise grows without bound and "Empty trash" is a chore.

## The trigger: the delete that adds to the trash also sweeps it

Cerefox has no scheduler, and this feature does not add one:

- **No `pg_cron`.** An extension to enable per Supabase project, to install and
  preload in the Local image, and to explain to anyone on plain Postgres.
- **No web-daemon timer.** It would never run for a Supabase-only user who
  does not keep `cerefox web` up.

Every soft delete, whatever the transport (web, CLI, local or remote MCP,
`/api/v1`), goes through one RPC, `cerefox_delete_document`. After it has
moved a document to the trash, it calls `cerefox_purge_expired_trash`, which
purges documents trashed more than N days ago.

This is exact rather than approximate: **the trash only grows through
deletes**, so sweeping on delete keeps it bounded. What it gives up is timing.
A document becomes *eligible* N days after it was trashed and is removed by
the **next delete after that**. A store where nothing is deleted keeps
expired documents, and it also accumulates nothing new. The docs say
"eligible after N days, removed by the next delete", never "deleted after
exactly N days".

## Safeguards

1. **A sweep can never fail a delete.** The call sits in its own
   `BEGIN … EXCEPTION` block inside `cerefox_delete_document`: a failure rolls
   back the sweep's savepoint only, raises a `WARNING`, and the delete commits
   as if auto-purge were off.
2. **Bounded cost.** At most 100 documents per sweep, oldest first, through the
   existing partial index on `deleted_at`. A large first backlog drains over
   the next few deletes instead of holding one request.
3. **No contention.** Candidates are locked `FOR UPDATE SKIP LOCKED`: two
   concurrent deletes sweep disjoint rows instead of waiting on each other.
4. **Never on a nonsense value.** Only the exact string `true` enables it;
   `trash_retention_days` must parse as an integer ≥ 1, or the sweep does
   nothing (the catalog also refuses such values at write time).
5. **Visible.** One audit entry per purged document: operation `delete`,
   author `trash-retention`, author type `user` (the authority is the
   operator's setting, not the agent whose delete triggered it), and a
   description naming the retention in force and the day the document was
   trashed. `cerefox_delete_document` returns `auto_purged: N`, so the caller
   is told, and `doctor` prints one line with the setting.
6. **Confirmed.** Both keys are high-impact in the catalog. Before either
   takes effect, Settings states how many documents already in the trash the
   next delete would purge.

## The trust model, stated precisely

`access-paths.md` guards one property: **no MCP, Edge Function or CLI path to
permanent purge**, because a human reviews the trash. (Explicit purge exists on the
web UI and on its backend, `/api/v1`, which any client that can reach the web server
can call; that exposure predates this feature and is unchanged by it.) With auto-purge on, an agent's delete
triggers a purge. That is compatible with the property only because:

- a **human** turned the policy on and chose N, which is the length of the
  review window;
- the sweep removes only documents **older than N days**, never the one being
  deleted, and never anything an agent chooses;
- it adds **no new way to purge**. `cerefox_purge_expired_trash` is not exposed
  over MCP or the Edge Functions, has no CLI verb, and is reachable over the
  Data API only with the service-role key, like every RPC.

`access-paths.md` is updated to say this.

## Surfaces

| Surface | Change |
|---|---|
| `cerefox_config` | `trash_auto_purge_enabled` (`false`), `trash_retention_days` (`60`, integer 1–3650). Seed rows in `schema.sql`; `v_allowed` in `cerefox_set_config`. |
| RPCs | New `cerefox_purge_expired_trash(p_max INT DEFAULT 100) RETURNS INT`; `cerefox_delete_document` calls it and returns `auto_purged`. Migration 0033; schema **0.17.0** (new behaviour on the delete path). `minSchema` unchanged: an older server simply never sweeps. |
| Config catalog | Both keys, group Retention, high-impact with notes; integer validation for the days. |
| Web Settings | High-impact confirmation shows the count the next delete would purge (`GET /api/v1/documents/trash?deleted_before=…` → `X-Total-Count`). |
| `/api/v1`, MCP, CLI | `DELETE /documents/{id}` returns `auto_purged`; the MCP delete tool and `cerefox document delete` mention it when non-zero. |
| `doctor` | `trash auto-purge  off` / `on — purges trash older than 60 days on the next delete`. |
| Docs | `configuration.md`, `access-paths.md` (trust model), `api.md`, CHANGELOG. |

## Verification (staging)

Enable it with a short retention, backdate a few trashed `[E2E` documents'
`deleted_at` directly in SQL, delete one document and check:

- exactly the expired ones are gone, oldest first;
- the just-deleted document and newer trash remain;
- one audit entry per purge;
- `auto_purged` is reported on every surface.

Then:

- cap: more than 100 expired → 100 purged, the rest on the next delete;
- failure isolation: with a probe that makes the sweep raise, the delete still
  succeeds;
- off: nothing is purged.

Restore the config afterwards and clean up the fixtures.
