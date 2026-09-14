#!/usr/bin/env bash
# External uptime probe for Companion prod (companion.tironi.xyz).
# Operator curl checklist alone is NOT enough — this script exits non-zero on
# failure and optionally pushes an alert (webhook / ntfy / macOS notification).
# Never prints secrets.
set -euo pipefail

BASE_URL="${COMPANION_UPTIME_BASE_URL:-https://zoen.tironi.xyz}"
ALERT=1
QUIET=0

usage() {
  cat <<'USAGE'
Usage: scripts/companion-uptime-probe.sh [--no-alert] [--quiet]

Probes:
  GET  $BASE_URL/welcome                     expect HTTP 200
  GET  $BASE_URL/eve/v1/health               expect HTTP 200
  POST $BASE_URL/api/channels/telegram       unsigned JSON → expect HTTP 401
  POST $BASE_URL/api/channels/kapso          unsigned JSON → expect HTTP 401

On failure (exit 1):
  1) POST COMPANION_UPTIME_ALERT_URL (if set) with text/plain body
  2) else POST https://ntfy.sh/$COMPANION_UPTIME_NTFY_TOPIC (if set)
  3) else macOS Notification Center (Darwin only)
  4) else stderr only (CI job failure / cron mail must carry the alert)

Env (names only — never commit values):
  COMPANION_UPTIME_BASE_URL     default https://companion.tironi.xyz
  COMPANION_UPTIME_ALERT_URL    optional generic webhook
  COMPANION_UPTIME_NTFY_TOPIC   optional ntfy.sh topic (no new paid SaaS)
  COMPANION_UPTIME_ALERT_TITLE  optional alert title

Flags:
  --no-alert   skip push sinks (still exit non-zero; use when the runner's
               failure notification is the alert, e.g. GitHub Actions)
  --quiet      less stdout on success
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --no-alert) ALERT=0; shift ;;
    --quiet) QUIET=1; shift ;;
    *) echo "unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

need_curl() {
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl not found on PATH" >&2
    exit 2
  fi
}

http_code() {
  # usage: http_code METHOD URL [curl args...]
  local method="$1" url="$2"
  shift 2
  curl -sS -o /dev/null -w '%{http_code}' --max-time 25 -X "$method" "$url" "$@" || true
}

failures=()

check_welcome() {
  local code
  code="$(http_code GET "${BASE_URL}/welcome")"
  if [[ "$code" != "200" ]]; then
    failures+=("GET /welcome → ${code} (expected 200)")
  elif [[ "$QUIET" -eq 0 ]]; then
    echo "ok welcome=${code}"
  fi
}

check_unsigned_channel() {
  local path="$1" label="$2" body="$3"
  local code
  code="$(http_code POST "${BASE_URL}${path}" \
    -H 'Content-Type: application/json' \
    --data "$body")"
  if [[ "$code" != "401" ]]; then
    failures+=("POST ${path} → ${code} (expected 401 unsigned)")
  elif [[ "$QUIET" -eq 0 ]]; then
    echo "ok ${label}=${code}"
  fi
}

push_alert() {
  local message="$1"
  local title="${COMPANION_UPTIME_ALERT_TITLE:-Companion uptime FAIL}"
  local sink=0

  if [[ -n "${COMPANION_UPTIME_ALERT_URL:-}" ]]; then
    curl -sS -o /dev/null --max-time 15 \
      -X POST "${COMPANION_UPTIME_ALERT_URL}" \
      -H 'Content-Type: text/plain; charset=utf-8' \
      --data "${title}"$'\n'"${message}" \
      || true
    sink=1
  fi

  if [[ -n "${COMPANION_UPTIME_NTFY_TOPIC:-}" ]]; then
    curl -sS -o /dev/null --max-time 15 \
      -H "Title: ${title}" \
      -H 'Priority: high' \
      -H 'Tags: warning,companion' \
      -d "${message}" \
      "https://ntfy.sh/${COMPANION_UPTIME_NTFY_TOPIC}" \
      || true
    sink=1
  fi

  if [[ "$sink" -eq 0 ]] && [[ "$(uname -s)" == "Darwin" ]] && command -v osascript >/dev/null 2>&1; then
    # Escape for AppleScript string literals.
    local as_title as_msg
    as_title="${title//\\/\\\\}"
    as_title="${as_title//\"/\\\"}"
    as_msg="${message//\\/\\\\}"
    as_msg="${as_msg//\"/\\\"}"
    osascript -e "display notification \"${as_msg}\" with title \"${as_title}\"" >/dev/null 2>&1 || true
    sink=1
  fi

  if [[ "$sink" -eq 0 ]]; then
    echo "alert: no COMPANION_UPTIME_ALERT_URL / NTFY_TOPIC / macOS notify; relying on exit status" >&2
  fi
}

need_curl
check_welcome
runtime_code="$(http_code GET "${BASE_URL}/eve/v1/health")"
if [[ "$runtime_code" != "200" ]]; then
  failures+=("GET /eve/v1/health → ${runtime_code} (expected 200)")
fi
check_unsigned_channel "/api/channels/telegram" "tg" '{"update_id":1}'
check_unsigned_channel "/api/channels/kapso" "kapso" '{}'

if [[ "${#failures[@]}" -gt 0 ]]; then
  msg="$(printf '%s\n' "${failures[@]}")"$'\n'"base=${BASE_URL}"$'\n'"when=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "FAIL companion uptime:" >&2
  echo "$msg" >&2
  if [[ "$ALERT" -eq 1 ]]; then
    push_alert "$msg"
  fi
  exit 1
fi

if [[ "$QUIET" -eq 0 ]]; then
  echo "ok companion uptime ${BASE_URL}"
fi
exit 0
