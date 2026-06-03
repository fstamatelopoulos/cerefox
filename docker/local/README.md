# Local Cerefox — P0 spike runbook

Proves the **D1** architecture (see `docs/research/local-cerefox-design.md` and
`docs/plan.md` Iteration 30): the existing **CLI / MCP / web run UNCHANGED** against a
local **PostgREST** Data API + **Postgres+pgvector** — only the `.env` URL+key differ.

This stack is **isolated and dev-only**: a dedicated compose project, **non-default
host ports** (Postgres `55432`, PostgREST `33000`), its own volume, dev creds. It does
**not** touch `~/.cerefox/.env` or any running `cerefox web`. It folds into the
single all-in-one image in P1.

> ⚠ **Localhost-bound only.** `PGRST_DB_ANON_ROLE=service_role` means *anonymous =
> full access*. Fine for `127.0.0.1`; never expose these ports on a LAN without
> switching PostgREST to JWT auth (see "LAN / production" below).

## Prerequisites

- A Docker daemon (Colima: `colima start`).
- `bun` (for `db_deploy.ts`).
- `OPENAI_API_KEY` exported in your shell (cloud embeddings).

## Steps

```sh
# 0. From the repo root.

# 1. Bring up Postgres + PostgREST.
docker compose -f docker/local/compose.yml up -d

# 2. Deploy schema + RPCs to the local DB (direct pg connection; the owner role).
CEREFOX_DATABASE_URL=postgresql://cerefox:cerefox@localhost:55432/cerefox \
  bun scripts/db_deploy.ts

# 3. Create the PostgREST roles + grants (AFTER step 2 so functions/tables exist).
docker exec -i cfx-spike-postgres psql -U cerefox -d cerefox < docker/local/roles.sql

# 4. Point a CLIENT at the local Data API — WITHOUT touching ~/.cerefox/.env.
#    Inline env vars win over the .env file (env.ts never overwrites process.env).
#    The key value is ignored locally (anon=service_role), so any string works.
export SPIKE="CEREFOX_SUPABASE_URL=http://localhost:33000 CEREFOX_SUPABASE_KEY=local-dev OPENAI_API_KEY=$OPENAI_API_KEY"

# 5. Exercise it (zero code change — same bins as cloud):
echo "# Hello local Cerefox" > /tmp/cfx-spike.md
env $SPIKE bun packages/memory/src/bin/cerefox.ts document ingest /tmp/cfx-spike.md --title "Spike doc"
env $SPIKE bun packages/memory/src/bin/cerefox.ts search "hello local"
env $SPIKE bun packages/memory/src/bin/cerefox.ts document list

# 6. Web UI on an ALT port (don't disturb any running daemon):
env $SPIKE bun packages/memory/src/bin/cerefox.ts web --port 8011
#    → http://localhost:8011/app/  (ingest / search / open a doc / view versions)
```

> Alternative to inline env (step 4): `export CEREFOX_CONFIG_DIR=/tmp/cfx-spike` and put
> a throwaway `.env` there — also never touches `~/.cerefox/.env`.

## Acceptance criteria (P0 "it works")

- [ ] `document ingest` succeeds (chunks + 768-dim embeddings written via the RPC).
- [ ] `search` (hybrid) returns the ingested doc.
- [ ] `document list` + version list/view work.
- [ ] Web UI at `:8011` loads, lists the doc, and search works.
- [ ] **All of the above with no code changes** — only `CEREFOX_SUPABASE_URL`/key differ.

## Teardown

```sh
docker compose -f docker/local/compose.yml down      # stop (keep data)
docker compose -f docker/local/compose.yml down -v   # stop + WIPE the spike volume
```

## LAN / production (NOT the spike)

For anything beyond localhost: in `compose.yml` set `PGRST_DB_ANON_ROLE=anon` and add
`PGRST_JWT_SECRET=<secret>`, then use a long-lived `{"role":"service_role"}` JWT
(signed with that secret) as `CEREFOX_SUPABASE_KEY`. This mirrors the cloud exactly
(the service key *is* a service_role JWT).

## Notes / follow-ups (P1+)

- The PostgREST image tag in `compose.yml` is **pinned** — keep it matched to the
  shipped `postgrest-js` (design §6-coupling); a CI suite must run the read/write/MCP
  tests against this pinned PostgREST.
- The repo-root `docker-compose.yml` `cerefox-web` service is **superseded** by this
  approach (it predates the TS runtime's PostgREST usage) — P1 reconciles/retires it.
- P1 bundles Postgres + PostgREST + cerefox-server into one image (s6-overlay,
  mounted PGDATA volume, first-boot deploy + this `roles.sql`).
