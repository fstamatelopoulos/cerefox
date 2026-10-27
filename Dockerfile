# Cerefox web container: `cerefox web` (server + web UI) against a Supabase
# backend, for running on a LAN host or a cloud service (#346). Design:
# docs/specs/lan-web-access.md. The all-in-one image with its own database is
# docker/local/Dockerfile instead.
#
# Build from the REPO ROOT:
#   docker build -t cerefox-web:dev .
# Run (the API key is REQUIRED; see docs/guides/setup-lan.md):
#   docker run -d --name cerefox-web -p 8000:8000 \
#     -e CEREFOX_SUPABASE_URL=https://YOUR-REF.supabase.co \
#     -e CEREFOX_SUPABASE_KEY=YOUR-SECRET-KEY \
#     -e OPENAI_API_KEY=YOUR-OPENAI-KEY \
#     -e CEREFOX_API_KEY=cfx_lak_YOUR-KEY \
#     cerefox-web:dev                                   # → http://<host>:8000/app/
#
# Schema + RPCs + Edge Functions are deployed separately (once), not by this
# image: `cerefox server deploy`.

# ── builder: the same bundled dist the npm package ships, built from this tree ──
FROM oven/bun:1 AS builder
WORKDIR /src
COPY . .
RUN bun install
RUN cd packages/memory && bun run prepublishOnly

# ── final: Node + the bundled app ──
FROM node:24-slim

# Refuse a Node below the October 2026 security release (24.22.1: the Brotli
# decoder fix, CVE-2026-111497, which fetch() reaches on any `br` response).
ARG MIN_NODE=24.22.1
RUN node -e "const a=process.versions.node.split('.').map(Number),b='${MIN_NODE}'.split('.').map(Number);for(let i=0;i<3;i++){if(a[i]!==b[i]){if(a[i]<b[i]){console.error('node '+process.versions.node+' < ${MIN_NODE}: pull a newer node:24-slim');process.exit(1)}break}}"

# The Help page resolves docs at <install>/docs/guides and <install>/AGENT_*.md,
# siblings of dist/. The local ONNX embedder is not included: it runs only in
# Cerefox Local.
COPY --from=builder /src/packages/memory/dist /opt/cerefox/dist
COPY --from=builder /src/packages/memory/docs /opt/cerefox/docs
COPY --from=builder /src/packages/memory/AGENT_GUIDE.md /opt/cerefox/AGENT_GUIDE.md
COPY --from=builder /src/packages/memory/AGENT_QUICK_REFERENCE.md /opt/cerefox/AGENT_QUICK_REFERENCE.md
COPY docker/web/entrypoint.sh /usr/local/bin/cerefox-web-entrypoint
RUN chmod 755 /usr/local/bin/cerefox-web-entrypoint \
 && printf '#!/bin/sh\nexec node /opt/cerefox/dist/bin/cerefox.js "$@"\n' > /usr/local/bin/cerefox \
 && chmod 755 /usr/local/bin/cerefox

# The node user (uid 1000) ships with the base image. `cerefox web` keeps its UI
# preferences under $HOME/.cerefox.
USER node
ENV HOME=/home/node NODE_ENV=production
EXPOSE 8000

# Under the gate an unauthenticated probe is always a 401, so the check sends
# the container's own key (the first one, if several are configured).
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "const k=(process.env.CEREFOX_API_KEY||'').split(',')[0].trim();require('http').get({host:'127.0.0.1',port:8000,path:'/api/v1/version',headers:k?{Authorization:'Bearer '+k}:{}},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["cerefox-web-entrypoint"]
CMD ["cerefox", "web", "--host", "0.0.0.0", "--port", "8000"]
