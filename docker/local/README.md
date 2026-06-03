# Local Cerefox — P0 spike runbook

Proves the **D1** architecture (see `docs/research/local-cerefox-design.md` and
`docs/plan.md` Iteration 30): the existing **CLI / MCP / web run UNCHANGED** against a
local **PostgREST** Data API + **Postgres+pgvector** — only the `.env` URL+key differ.

**✅ Validated 2026-06-02** end-to-end: project create/list, document ingest (768-dim
OpenAI embeddings), hybrid search (pgvector), FTS search, and the web UI — all with
zero code changes. See "Findings" at the bottom.

This stack is **isolated and dev-only**: a dedicated compose project, **non-default
host ports** (Postgres `55432`, PostgREST `33000`, gateway `33001`), its own volume,
dev creds. It does **not** touch `~/.cerefox/.env` or any running `cerefox web`.
It folds into the single all-in-one image in P1.

> ⚠ **Localhost-bound + dev creds only.** The JWT secret here is committed/dev-only.
> The real product generates a per-install secret. Never expose these ports on a LAN
> with this secret.

## Components

- **postgres** (pgvector) — the DB; schema + RPCs deployed into it.
- **postgrest** (pinned `v14.12`, matched to our `postgrest-js`) — the Data API.
- **gateway** (Caddy) — presents `/rest/v1/*` (what supabase-js calls) → PostgREST.
  *In the shipped product this folds into cerefox-server (Hono); see design §5.*

## Prerequisites

- A Docker daemon (Colima: `colima start`). Use the **`docker-compose`** binary
  (the `docker compose` plugin may not be wired into the `docker` CLI).
- `bun`; `OPENAI_API_KEY` available (cloud embeddings) for ingest/hybrid search.

## Steps

```sh
# 0. From the repo root.

# 1. Bring up Postgres + PostgREST + gateway.
docker-compose -f docker/local/compose.yml up -d

# 2. Deploy schema + RPCs into the local DB (direct pg connection; the owner role).
CEREFOX_DATABASE_URL=postgresql://cerefox:cerefox@localhost:55432/cerefox \
  bun scripts/db_deploy.ts

# 3. Create the PostgREST roles + grants (AFTER step 2), then restart PostgREST so it
#    reconnects as the now-existing `authenticator` role.
docker exec -i cfx-spike-postgres psql -U cerefox -d cerefox < docker/local/roles.sql
docker restart cfx-spike-postgrest

# 4. Mint a service_role JWT signed with the compose's PGRST_JWT_SECRET. supabase-js
#    always sends `Authorization: Bearer <key>`, so the key MUST be a valid JWT.
SECRET="cerefox-local-dev-secret-change-me-please-0123456789"   # = PGRST_JWT_SECRET in compose.yml
JWT=$(SECRET="$SECRET" bun -e 'const c=require("node:crypto");const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");const h=b({alg:"HS256",typ:"JWT"});const p=b({role:"service_role"});const s=c.createHmac("sha256",process.env.SECRET).update(h+"."+p).digest("base64url");process.stdout.write(h+"."+p+"."+s)')

# 5. Point a CLIENT at the local Data API via the gateway — WITHOUT touching
#    ~/.cerefox/.env (inline env wins; env.ts never overwrites process.env).
export SPIKE="CEREFOX_SUPABASE_URL=http://localhost:33001 CEREFOX_SUPABASE_KEY=$JWT OPENAI_API_KEY=$OPENAI_API_KEY"

bun=(bun packages/memory/src/bin/cerefox.ts)
env $SPIKE "${bun[@]}" project create "spike-test"
echo "# Local spike" > /tmp/cfx-spike.md
env $SPIKE "${bun[@]}" document ingest /tmp/cfx-spike.md --title "Local Spike Doc" --project-name spike-test
env $SPIKE "${bun[@]}" search "local"
env $SPIKE "${bun[@]}" document list

# 6. Web UI on an ALT port (don't disturb any running daemon):
env $SPIKE "${bun[@]}" web --port 8011    # → http://localhost:8011/app/
```

## Acceptance criteria (P0 — all ✅ on 2026-06-02)

- [x] `document ingest` (chunks + 768-dim embeddings via the RPC).
- [x] `search` hybrid (pgvector) returns the doc; FTS mode works.
- [x] `project`/`document list` round-trip (`.from` + `.rpc`, read + write).
- [x] Web UI `/app/` + `/api/v1/{projects,dashboard,schema-version}` against local.
- [x] **All with no code changes** — only `CEREFOX_SUPABASE_URL`/key differ.

## Teardown

```sh
docker-compose -f docker/local/compose.yml down      # stop (keep data)
docker-compose -f docker/local/compose.yml down -v   # stop + WIPE the spike volume
```

## Findings → fold into P1 (design §5)

1. **Gateway required.** supabase-js calls `/rest/v1/*`; PostgREST serves at root.
   ✅ **Implemented + validated in cerefox-server** (`registerPostgrestProxy`, gated by
   `CEREFOX_POSTGREST_UPSTREAM`; inert in cloud). To use it instead of Caddy: run the
   server with `CEREFOX_POSTGREST_UPSTREAM=http://localhost:33000` + `CEREFOX_SUPABASE_URL`
   pointed at the server itself, then point clients at the server. The Caddy service
   here is now just a convenience for CLI-only testing without running the server.
2. **JWT always required.** supabase-js sends `Authorization: Bearer`, so a
   `PGRST_JWT_SECRET` + a `service_role` JWT are needed even on localhost. The
   **installer generates a per-install secret + mints the JWT into the clients' env**
   (`CEREFOX_SUPABASE_KEY`) — mirrors the cloud (service key = a service_role JWT).
3. **Role ordering.** PostgREST exits if `authenticator` is missing at boot →
   the all-in-one entrypoint must create roles **before** starting PostgREST (or set
   `restart: on-failure`).
