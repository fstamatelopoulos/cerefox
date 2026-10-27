#!/bin/sh
# Entrypoint for the Cerefox web container (#346).
#
# This image exists to be reached from other machines, and inside a container
# every caller looks remote (Docker rewrites the source address of published
# traffic), so the loopback exemption cannot apply. Without a key, anyone who
# can reach the port could read, change and delete the whole store through the
# server's Supabase secret key. So the key is required, and the gate covers
# every caller.
set -eu

if [ -z "${CEREFOX_API_KEY:-}" ]; then
  if [ "${CEREFOX_WEB_NO_KEY:-}" = "1" ]; then
    echo "cerefox-web: CEREFOX_WEB_NO_KEY=1: starting WITHOUT an API key. Anyone who can" >&2
    echo "  reach this port can read and change the store. Only do this when something" >&2
    echo "  in front of it (Cloud Run IAM, an authenticating proxy) already controls access." >&2
  else
    echo "cerefox-web: refusing to start without CEREFOX_API_KEY." >&2
    echo "  Set CEREFOX_API_KEY to a long random value (for example" >&2
    echo "  cfx_lak_\$(openssl rand -hex 32)); the web UI asks for it once per browser." >&2
    echo "  If access is already controlled in front of this container, set" >&2
    echo "  CEREFOX_WEB_NO_KEY=1 instead. See docs/guides/setup-lan.md." >&2
    exit 64
  fi
else
  export CEREFOX_API_REQUIRE_KEY="${CEREFOX_API_REQUIRE_KEY:-1}"
fi

exec "$@"
