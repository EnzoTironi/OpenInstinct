#!/bin/sh
# Fly Machine entrypoint: materialize Codex/ChatGPT auth from secrets, then start.
# Secret names: CHATGPT_AUTH_JSON → /root/.eve/auth/chatgpt.json
#               CODEX_AUTH_JSON   → /root/.codex/auth.json
# Never logs or echoes secret values.
set -eu

# Operon snapshots use the same durable Postgres unless a separate DB is set.
export OPERON_DATABASE_URL="${OPERON_DATABASE_URL:-${DATABASE_URL:?DATABASE_URL is required}}"

if [ -n "${CHATGPT_AUTH_JSON:-}" ]; then
  mkdir -p /root/.eve/auth
  printf %s "$CHATGPT_AUTH_JSON" > /root/.eve/auth/chatgpt.json
  chmod 600 /root/.eve/auth/chatgpt.json
fi

if [ -n "${CODEX_AUTH_JSON:-}" ]; then
  mkdir -p /root/.codex
  printf %s "$CODEX_AUTH_JSON" > /root/.codex/auth.json
  chmod 600 /root/.codex/auth.json
fi

# Same args as historical Dockerfile CMD (Fly IPv6 health + Eve rewrite port).
exec pnpm start --port 3000 --hostname :: --eve-port 4274
