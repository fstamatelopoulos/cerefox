# Iteration 53: Edge Function deploys under Supabase CLI 3 (#363)

> Status: implemented (2026-11-11) on `fix/supabase-cli-consent`. Target:
> v1.23.2 (no schema change).

## Why

Supabase CLI 3.0 refuses to change a hosted project unless the run carries
consent (`--yes`, or `SUPABASE_YES` exported in the shell), and it cannot ask
when its output is not a terminal. `cerefox server deploy` captures the CLI's
output (to explain bundler failures) and never passed `--yes`, so every
Edge Function deploy failed: an agent's, as #363 reported, and also a person's
in their own terminal (found during the 1.23.1 rollout). The CLI was unpinned,
so this arrived with no Cerefox release.

## Changes

- `packages/memory/src/cli/util/supabase-cli.ts`: the pinned version (3.1.0),
  the npx arguments, `personAtTerminal()` and `consentRefusal()`.
- `server deploy`: `--yes` on Cerefox's command, or a person answering the
  deployment prompt with stdin and stdout on a terminal, is consent, and each
  function deploy gets the CLI's `--yes`. This follows Supabase's guidance
  (`--yes` for unattended runs; an agent asks the person, then passes `--yes`).
  A stricter variant (Cerefox's `--yes` not passed on, scripts export
  `SUPABASE_YES`) was considered and rejected by the maintainer: it blocked an
  agent even with the person's go-ahead and added a step to every CI job. On a
  refusal the deploy stops at the first function and says who must run what. `--remote=<ref>`
  replaces the deprecated `--project-ref` in the CLI call.
- `token generate`/`rotate`: pinned CLI and `--remote=`; their output is a
  terminal already, so the CLI asks the person itself.
- Docs: `cli.md` (server deploy), `RELEASING.md`, CHANGELOG.

## Verified

- Unit: `supabase-cli.test.ts` (the CLI's verbatim refusals, the terminal
  rule, a source scan that no command runs an unpinned `npx supabase`),
  `cli-deploy-server.test.ts`.
- Staging, from an agent: a piped `y` ends with the CLI's agent refusal at the
  first function, nothing deployed, and the advice to ask the person.
- To do by the maintainer: `cerefox server deploy --functions-only` in a
  terminal, answering the prompt (the production Edge Functions are still
  1.22.0 for this check).
