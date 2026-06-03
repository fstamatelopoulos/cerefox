# Cerefox all-in-one LOCAL image (P1): Postgres+pgvector + PostgREST + cerefox-server
# in a single container. Design: docs/research/local-cerefox-design.md §5.5.
#
# MVP: a shell entrypoint orchestrates the three processes. Proper s6-overlay
# supervision is a documented follow-up (P1 hardening). Build from the REPO ROOT:
#   docker build -f docker/local/Dockerfile -t cerefox-local:dev .
# Run (data persists in a named volume; OPENAI_API_KEY enables ingest/embeddings):
#   docker run -d --name cerefox -p 8000:8000 -v cerefox_pgdata:/var/lib/postgresql/data \
#     -e OPENAI_API_KEY=sk-... cerefox-local:dev   # → http://localhost:8000/app/

# ── builder: build the frontend + bundle the package dist (incl. the /rest/v1 proxy) ──
FROM oven/bun:1 AS builder
WORKDIR /src
COPY . .
RUN bun install
RUN cd packages/memory && bun run prepublishOnly
# → /src/packages/memory/dist/{bin/cerefox.js, frontend/, docs/, server-assets/…}

# ── final: pgvector base + PostgREST + bun runtime + the bundled app ──
FROM pgvector/pgvector:pg16

# Pinned PostgREST (matched to postgrest-js — design §6-coupling) + bun runtime (glibc).
COPY --from=postgrest/postgrest:v14.12 /bin/postgrest /usr/local/bin/postgrest
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
# (psql client + the base tools come from the pgvector/postgres Debian base.)

# App = the self-contained bundled dist (bin + frontend + docs + server-assets).
COPY --from=builder /src/packages/memory/dist /opt/cerefox/dist
COPY docker/local/roles.sql /opt/cerefox/roles.sql
COPY docker/local/image-entrypoint.sh /usr/local/bin/cerefox-entrypoint
RUN chmod +x /usr/local/bin/cerefox-entrypoint \
 && printf '#!/bin/sh\nexec bun /opt/cerefox/dist/bin/cerefox.js "$@"\n' > /usr/local/bin/cerefox \
 && chmod +x /usr/local/bin/cerefox

# Postgres first-boot init (base image reads these) + local wiring.
ENV POSTGRES_USER=cerefox \
    POSTGRES_PASSWORD=cerefox \
    POSTGRES_DB=cerefox \
    CEREFOX_DATABASE_URL=postgresql://cerefox:cerefox@127.0.0.1:5432/cerefox \
    CEREFOX_SUPABASE_URL=http://127.0.0.1:8000 \
    CEREFOX_POSTGREST_UPSTREAM=http://127.0.0.1:3000 \
    PGRST_DB_URI=postgresql://authenticator:authenticator@127.0.0.1:5432/cerefox \
    PGRST_DB_SCHEMAS=public \
    PGRST_DB_ANON_ROLE=anon

EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/cerefox-entrypoint"]
