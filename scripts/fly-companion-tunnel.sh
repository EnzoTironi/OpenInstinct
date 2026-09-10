#!/usr/bin/env bash
# Always-on Cloudflare tunnel connector on Fly (companion.tironi.xyz).
# Never prints secret values.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$ROOT/infrastructure/ingress/fly-tunnel/fly.toml"
APP="$(awk -F'"' '/^app[[:space:]]*=/{print $2; exit}' "$CFG")"

usage() {
  cat <<'USAGE'
Usage: scripts/fly-companion-tunnel.sh <validate|status|secrets-check|deploy|set-token-from-file>

  validate              fly config validate (no deploy)
  status                fly status for companion-cf-tunnel
  secrets-check         list Fly secret *names* only
  deploy                fly deploy connector image (cloudflared)
  set-token-from-file   read TUNNEL_TOKEN from a mode-600 file via stdin shape:
                        TUNNEL_TOKEN_FILE=~/.cloudflared/openinstinct-companion.token \
                          scripts/fly-companion-tunnel.sh set-token-from-file

Does not unload Mac LaunchAgents; does not print token contents.
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
    "$(fly_bin)" config validate -c "$CFG"
    ;;
  status)
    need_fly
    "$(fly_bin)" status -a "$APP"
    ;;
  secrets-check)
    need_fly
    "$(fly_bin)" secrets list -a "$APP"
    ;;
  deploy)
    need_fly
    "$(fly_bin)" deploy -a "$APP" -c "$CFG" --ha=false
    ;;
  set-token-from-file)
    need_fly
    file="${TUNNEL_TOKEN_FILE:-}"
    if [[ -z "$file" || ! -f "$file" ]]; then
      echo "Set TUNNEL_TOKEN_FILE to a mode-600 token file path" >&2
      exit 1
    fi
    # Read via stdin so the value is not placed on the process argv as a literal.
    "$(fly_bin)" secrets set -a "$APP" TUNNEL_TOKEN=- <"$file"
    echo "TUNNEL_TOKEN staged/deployed for $APP (value not printed)"
    ;;
  *)
    usage
    exit 1
    ;;
esac
