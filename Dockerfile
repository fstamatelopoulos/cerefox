# Cerefox web UI container (TypeScript runtime).
#
# ⚠ UNTESTED end-to-end (tracked in docs/TODO.md). Treat this as a starting
# point, not a verified image — adapt as needed and please report back.
#
# Runs `cerefox web` from the @cerefox/memory npm package, which bundles the
# CLI, the local MCP server, the Hono web server, AND the pre-built React SPA.
# There is no Python in the runtime image anymore — the former FastAPI app
# (`cerefox.api.app`) was retired to a husk in v0.9; the web server is TypeScript.
#
# Configure via environment variables (see .env.example):
#   Required: CEREFOX_SUPABASE_URL, CEREFOX_SUPABASE_KEY, OPENAI_API_KEY
#   Optional: CEREFOX_EMBEDDER, CEREFOX_MAX_CHUNK_CHARS, CEREFOX_MAX_RESPONSE_BYTES
#
# Schema + RPCs + Edge Functions are deployed separately (once), not by this
# image: `cerefox server deploy` (or `bun scripts/db_deploy.ts` from a clone).

FROM node:20-slim

# Install the Cerefox runtime globally. Pin a version for reproducibility, e.g.
# `@cerefox/memory@0.9.3`; `@latest` (default) tracks the newest release.
RUN npm install -g @cerefox/memory

EXPOSE 8000

# Health check — the JSON API's version endpoint returns 200 when the server is up.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8000/api/v1/version', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["cerefox", "web", "--host", "0.0.0.0", "--port", "8000"]
