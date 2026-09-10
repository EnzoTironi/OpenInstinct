#!/bin/bash
set -euo pipefail
# Force Node 24 (repo engines) ahead of Hermes/other node installs.
export HOME="/Users/enzotironi"
export PATH="/Users/enzotironi/.local/share/mise/installs/node/24.21.0/bin:/Users/enzotironi/.local/bin:/Users/enzotironi/.orbstack/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd /Users/enzotironi/openinstinct-wt/companion-tironi-prod
# Prevent stale shell/launchd DATABASE_URL from overriding .env.prod via --env-file
unset DATABASE_URL DATABASE_URL_UNPOOLED POSTGRES_PASSWORD || true
for i in $(seq 1 20); do
  if docker inspect companionlocal-postgres-prod-t5an3j57kqed7cwt --format '{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; then
    break
  fi
  docker start companionlocal-postgres-prod-t5an3j57kqed7cwt >/dev/null 2>&1 || true
  sleep 2
done
exec pnpm start --port 3000 --hostname 127.0.0.1 --eve-port 4274
