# Cerefox all-in-one LOCAL image: Postgres+pgvector + PostgREST + cerefox-server in a
# single container, supervised by s6-overlay. Design: docs/research/local-cerefox-design.md §5.5.
#
# Build from the REPO ROOT:
#   docker build -f docker/local/Dockerfile -t cerefox-local:dev .
# Run (data persists in a named volume; OPENAI_API_KEY enables ingest/embeddings):
#   docker run -d --name cerefox -p 8000:8000 -v cerefox_pgdata:/var/lib/postgresql/data \
#     -e OPENAI_API_KEY=sk-... cerefox-local:dev   # → http://localhost:8000/app/
# (The shell-MVP entrypoint, docker/local/image-entrypoint.sh, is kept as a fallback
#  reference but is no longer used — s6-overlay supervises the processes now.)

# ── builder: build the frontend + bundle the package dist (incl. the /rest/v1 proxy) ──
FROM oven/bun:1 AS builder
WORKDIR /src
COPY . .
RUN bun install
RUN cd packages/memory && bun run prepublishOnly
# → /src/packages/memory/dist/{bin/cerefox.js, frontend/, docs/, server-assets/…}

# ── final: pgvector base + s6-overlay + PostgREST + bun runtime + the bundled app ──
FROM pgvector/pgvector:pg16

ARG S6_OVERLAY_VERSION=3.2.3.0
ARG TARGETARCH

# Tools + s6-overlay (multi-process supervisor; arch-correct under buildx).
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl xz-utils ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
    case "${TARGETARCH:-amd64}" in \
      amd64) S6_ARCH=x86_64 ;; \
      arm64) S6_ARCH=aarch64 ;; \
      *)     S6_ARCH=x86_64 ;; \
    esac; \
    base="https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}"; \
    curl -fsSL "${base}/s6-overlay-noarch.tar.xz"      -o /tmp/s6-noarch.tar.xz; \
    curl -fsSL "${base}/s6-overlay-${S6_ARCH}.tar.xz"  -o /tmp/s6-arch.tar.xz; \
    tar -C / -Jxpf /tmp/s6-noarch.tar.xz; \
    tar -C / -Jxpf /tmp/s6-arch.tar.xz; \
    rm -f /tmp/s6-*.tar.xz

# Pinned PostgREST (matched to postgrest-js — design §6-coupling) + bun runtime (glibc).
COPY --from=postgrest/postgrest:v14.12 /bin/postgrest /usr/local/bin/postgrest
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

# App = the self-contained bundled dist (bin + frontend + server-assets).
COPY --from=builder /src/packages/memory/dist /opt/cerefox/dist
# Bundled docs + agent guides — the /api/v1/docs (Help) resolver looks for these at
# <install>/docs/guides and <install>/AGENT_*.md (SIBLINGS of dist/, not inside it).
# bundle-docs (run by prepublishOnly in the builder) produces them at the package root.
COPY --from=builder /src/packages/memory/docs /opt/cerefox/docs
COPY --from=builder /src/packages/memory/AGENT_GUIDE.md /opt/cerefox/AGENT_GUIDE.md
COPY --from=builder /src/packages/memory/AGENT_QUICK_REFERENCE.md /opt/cerefox/AGENT_QUICK_REFERENCE.md
COPY docker/local/roles.sql /opt/cerefox/roles.sql
RUN printf '#!/bin/sh\nexec bun /opt/cerefox/dist/bin/cerefox.js "$@"\n' > /usr/local/bin/cerefox \
 && chmod +x /usr/local/bin/cerefox

# s6 service tree: db-init (oneshot) → postgres / postgrest / cerefox-server (longruns).
COPY docker/local/s6/s6-rc.d /etc/s6-overlay/s6-rc.d
COPY docker/local/s6/scripts /etc/s6-overlay/scripts
RUN chmod +x /etc/s6-overlay/scripts/* \
 && chmod +x /etc/s6-overlay/s6-rc.d/postgres/run /etc/s6-overlay/s6-rc.d/postgrest/run /etc/s6-overlay/s6-rc.d/cerefox-server/run

# Postgres first-boot init (base image reads these) + local wiring.
ENV POSTGRES_USER=cerefox \
    POSTGRES_PASSWORD=cerefox \
    POSTGRES_DB=cerefox \
    CEREFOX_DATABASE_URL=postgresql://cerefox:cerefox@127.0.0.1:5432/cerefox \
    CEREFOX_SUPABASE_URL=http://127.0.0.1:8000 \
    CEREFOX_POSTGREST_UPSTREAM=http://127.0.0.1:3000 \
    PGRST_DB_URI=postgresql://authenticator:authenticator@127.0.0.1:5432/cerefox \
    PGRST_DB_SCHEMAS=public \
    PGRST_DB_ANON_ROLE=anon \
    S6_KEEP_ENV=1 \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2

EXPOSE 8000
ENTRYPOINT ["/init"]
