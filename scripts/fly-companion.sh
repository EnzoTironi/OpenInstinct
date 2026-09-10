#!/usr/bin/env bash
# Companion Fly helpers (H01). Never prints secret values.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'USAGE'
Usage: scripts/fly-companion.sh <validate|status|deploy-dry|secrets-check>

  validate       fly config validate against fly.toml (no deploy)
  status         fly status for the configured app (read-only)
  deploy-dry     fly deploy --build-only (build image; do not replace machines)
  secrets-check  list Fly secret *names* only (fly secrets list)

Does not migrate live traffic, destroy Mac LaunchAgents, or rotate F01.
Postgres: Alchemy Docker (A/B) or Alchemy Fly.Machine unmanaged PG (C);
see docs/ops/hosted-fly.md + scripts/fly-alchemy-pg.sh — not Fly MPG.
USAGE
}

need_fly() {
  if ! command -v fly >/dev/null 2>&1 && ! command -v flyctl >/dev/null 2>&1; then
    echo "fly CLI not found on PATH" >&2
    exit 1
  fi
}

fly_bin() {
  if command -v fly >/dev/null 2>&1; then
    command -v fly
  else
    command -v flyctl
  fi
}

cmd="${1:-}"
case "$cmd" in
  validate)
    need_fly
    "$(fly_bin)" config validate -c "$ROOT/fly.toml"
    ;;
  status)
    need_fly
    "$(fly_bin)" status -a "$(awk -F'"' '/^app[[:space:]]*=/{print $2; exit}' "$ROOT/fly.toml")"
    ;;
  deploy-dry)
    need_fly
    # Build only — does not update running machines / live traffic.
    "$(fly_bin)" deploy -c "$ROOT/fly.toml" --build-only --remote-only
    ;;
  secrets-check)
    need_fly
    # Names only; fly secrets list does not print values.
    "$(fly_bin)" secrets list -a "$(awk -F'"' '/^app[[:space:]]*=/{print $2; exit}' "$ROOT/fly.toml")"
    ;;
  *)
    usage
    exit 1
    ;;
esac
