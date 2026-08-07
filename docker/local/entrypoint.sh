#!/usr/bin/env sh
# All-in-one image: first-boot DB init. Intended as an s6-overlay *oneshot* that
# runs BEFORE PostgREST starts — design §5.6: PostgREST exits if the
# `authenticator` role is missing at boot. Idempotent; safe to run every boot.
#
# ⚠ SCAFFOLDING for the P1 image build (the Dockerfile + s6 wiring are NOT done yet
#   — next session). The steps mirror the manually-validated P0 sequence (db_deploy
#   + roles.sql), so the logic is sound; it just hasn't run inside an image.
set -eu

: "${CEREFOX_DATABASE_URL:?CEREFOX_DATABASE_URL must be set (local Postgres)}"
APP_DIR="${CEREFOX_APP_DIR:-/opt/cerefox}"
ROLES_SQL="${CEREFOX_ROLES_SQL:-$APP_DIR/docker/local/roles.sql}"

echo "[db-init] waiting for Postgres…"
i=0
until pg_isready -d "$CEREFOX_DATABASE_URL" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -gt 60 ] && { echo "[db-init] Postgres not ready after 60s"; exit 1; }
  sleep 1
done

echo "[db-init] deploying schema + RPCs (idempotent)…"
# Source-built image → the validated contributor path. For an npm-bundled image,
# swap to the bundled end-user path `cerefox server deploy --schema-only` (verify
# its behavior against a local-only, non-Supabase DB first).
( cd "$APP_DIR" && bun scripts/db_deploy.ts )

# Cerefox Local runs the ONNX nomic embedder, whose cosine scores sit lower than
# OpenAI's — unrelated text lands around 0.4–0.55, so the OpenAI-calibrated 0.5
# floor lets weak matches through. This used to travel as CEREFOX_MIN_SEARCH_SCORE
# in the container environment, but retrieval tuning is a property of the STORE
# (v1.1.0): one value in cerefox_config governs the CLI, the web UI and every
# agent alike, instead of depending on which client asked.
#
# ON CONFLICT DO NOTHING so an operator who has tuned this keeps their value
# across container restarts and upgrades.
echo "[db-init] seeding local-embedder retrieval defaults (idempotent)…"
psql "$CEREFOX_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "INSERT INTO cerefox_config (key, value) VALUES ('min_search_score', '0.6') ON CONFLICT (key) DO NOTHING;"

echo "[db-init] applying PostgREST roles + grants (idempotent)…"
psql "$CEREFOX_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROLES_SQL"

echo "[db-init] done — PostgREST + cerefox-server may start."
