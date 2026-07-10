# Releasing Cerefox

This is the maintainer checklist for cutting a Cerefox release. It documents
the **public release workflow** — the steps, the order, and the
post-release verification. Releases are gated to maintainers (npm trusted
publishing + the GitHub Actions release workflow); this file is the
playbook, not an invitation for arbitrary contributors to publish.

> Scope: this covers `@cerefox/memory` (the npm package) + the git tag +
> the GitHub Release. The server side (Supabase schema / RPCs / Edge
> Functions) deploys separately via `cerefox server deploy` and is **not**
> part of the npm release — but a release that changes the server surface
> must tell users to redeploy (see "Server-surface changes" below).

## Versioning model

Three version surfaces move independently:

| Surface | Where | Bumped by |
|---|---|---|
| **Client** (`PKG_VERSION`) | `packages/memory/src/meta.ts` + every `package.json` | `cut_release.ts`, every release |
| **Schema** (schema + RPCs) | `@version:` marker in `src/cerefox/db/schema.sql` **and** the `cerefox_schema_version()` literal in `rpcs.sql` (kept in lockstep) | by hand, when `schema.sql`/`rpcs.sql`/migrations change — **gated by `cut_release.ts`** |
| **Edge Functions** (`EF_VERSION`) | `_shared/ef-meta/index.ts` | `cut_release.ts`, only when EF source changed since the last tag |

The client carries a **compatibility matrix** (`_shared/compatibility/index.ts`,
`minSchema` / `minEdgeFunctions`). See CONTRIBUTING.md → "Client ↔ server
compatibility matrix" for the bump policy. **If this release raises either
minimum, say so loudly in the CHANGELOG + migration guide** — users must
redeploy their server.

## Pre-release checklist

1. **Working tree is clean** and you're on `main` with everything merged.
2. **CHANGELOG.md** has a populated `[Unreleased]` section describing the
   release. `cut_release.ts` promotes it to the new version heading.
3. **Compatibility matrix** (`_shared/compatibility/index.ts`) — if this
   release's client needs a newer server, raise `minSchema` /
   `minEdgeFunctions` and confirm the CHANGELOG calls out "redeploy
   required".
4. **Schema version** — if anything under `src/cerefox/db/` changed
   (`schema.sql`, `rpcs.sql`, or a migration), bump the schema version in
   **two** places, in lockstep: the `-- @version:` marker in `schema.sql`
   (the *bundled* value the client compares against) **and** the literal in
   `cerefox_schema_version()` at the bottom of `rpcs.sql` (the *deployed*
   value). Schema and RPCs deploy together via `cerefox server deploy`, so this
   one version is the single "redeploy required" signal — bumping it makes
   `doctor` / the web banner tell users to redeploy. **`cut_release.ts` fails
   the cut** if `db/` changed without a bump, or if the two literals disagree.
   (Raise `minSchema` in the compat matrix only if the client *hard-requires*
   the new surface; if it degrades gracefully, the version bump alone is the
   nudge.)
5. **GPT Actions OpenAPI block** (`docs/guides/connect-agents.md`) — if any
   Edge Function's request/response shape changed this cycle, update the
   OpenAPI block and bump its `info.version`. (See the CLAUDE.md rule;
   ideally this already happened in the EF-changing PR.)
6. **All tests green**: `cd _shared && bun test`,
   `cd packages/memory && bun run build && bun test`. Live/e2e suites
   auto-skip without credentials — run them against a real project when the
   release touches their surface.
7. **Docs current**: `docs/plan.md`, migration guide, and the npm
   `packages/memory/README.md` reflect what's shipping.
8. **supabase-js ↔ PostgREST pin** (local self-hosted backend): if this cycle
   bumped `@supabase/supabase-js` (→ `postgrest-js`), re-check the PostgREST
   version pinned in `docker/local/{compose.yml,Dockerfile}` against what the new
   `postgrest-js` targets, and run the **Version coupling** workflow (or
   `docker/local/smoke.sh` against the pinned stack). The cloud's managed PostgREST
   masks a too-old local pin, so this is the only guard. (Design §6-coupling.)

## Cutting the release

```bash
# Dry-run first — prints every file it would change + the tag it would create:
bun scripts/cut_release.ts <version> --dry-run

# Then for real (tag + GitHub Release; add --npm-publish to also publish):
bun scripts/cut_release.ts <version> --npm-publish
```

`cut_release.ts`:
- bumps `VERSION`, every `package.json`, and `PKG_VERSION`;
- bumps `EF_VERSION` only if Edge Function source changed since the last tag;
- promotes the CHANGELOG `[Unreleased]` section;
- commits, creates an annotated tag, pushes, and (with `--npm-publish`)
  triggers the release workflow that publishes to npm via trusted publishing.

### Pre-releases (betas / RCs)

A version with a pre-release suffix (`1.0.0-beta.1`, `1.0.0-rc.1`) is cut exactly the
same way — `cut_release.ts` accepts it. What differs is **automatic and safe**:

- **npm dist-tag**: the release workflow publishes a pre-release under its **channel tag**
  (`beta` / `rc`), not `latest`. So `latest` — and a plain `npm i -g @cerefox/memory` /
  `cerefox self-update` / `install.sh` with no `VERSION` — **stays on the newest stable
  release**. Only opt-in installs get the pre-release.
- **Docker `:latest`** is likewise skipped for pre-releases.

Install a pre-release to test the full user experience:

```bash
VERSION=beta sh install.sh            # newest beta (the `beta` dist-tag)
VERSION=1.0.0-beta.1 sh install.sh    # a specific pre-release
# or: npm i -g @cerefox/memory@beta
```

Breaking changes are allowed **between betas**; freeze them at `-rc`. Promote to the stable
`1.0.0` (which publishes under `latest`) once the RC has soaked. Do NOT skip the
`[Unreleased]` → versioned CHANGELOG promotion for a beta — each beta gets its own section.

**Consolidate the CHANGELOG when cutting the stable `X.0.0`.** Because each beta/rc holds only
*its* delta, the final stable section would otherwise contain just the delta since the last rc
— not the whole story since the previous stable. Before running `cut_release.ts X.0.0`, hand-
edit `[Unreleased]` so the `[X.0.0]` section aggregates **every** change across all the
`X.0.0-beta.N` / `-rc.N` sections since the last stable, deduped and organized by
Added / Changed / Fixed / Removed / Security. That consolidated section is the source for the
release announcement. Leave the individual pre-release sections beneath it as granular history.

## Post-release verification

1. The release workflow run is green (build + test, then publish).
2. `npm view @cerefox/memory version` shows the new version.
3. The GitHub Release exists and is marked "Latest".
4. Smoke the published artifact:
   ```bash
   npx --package=@cerefox/memory cerefox --version   # prints the new version
   ```
5. The npm package page shows the updated README.

## Server-surface changes (schema / RPCs / Edge Functions)

If the release changed the server side, the CHANGELOG **and** the migration
guide must include the redeploy step prominently (not buried). For end users
the single command covers everything:

```bash
cerefox server deploy   # fresh DB → deploy schema+RPCs+EFs;
                        # existing DB → apply pending migrations, refresh RPCs+EFs
```

`server deploy` is the catch-all: on an existing database it applies any
*pending* migrations and re-applies `rpcs.sql`, so a release that changes RPCs
or adds a migration is shipped just by re-running it. The low-level scripts
(`bun scripts/db_deploy.ts` for a fresh deploy, `bun scripts/db_migrate.ts` for
incremental migrations) remain for contributors working from a repo clone.

## If something is wrong after publish

Per the "force-move tags only on objective failure" rule (CONTRIBUTING.md):
a published tag **never moves**. Ship a new patch version instead. The only
exception is an objective failure of the release pipeline itself (CI failed
mid-release, half the artifacts didn't publish) — in that narrow case the
force-move-tag recovery is:

```bash
git tag -d v<version>
git push origin :refs/tags/v<version>
# fix the issue, re-tag at the correct commit, re-run the workflow,
# then un-draft the GitHub Release if it was demoted.
```
