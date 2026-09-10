#!/usr/bin/env bash
# Point Telegram / Kapso provider webhooks at this Companion install.
#
# Reads secrets from the environment (e.g. `set -a; source .env.local; set +a`
# or `pnpm ingress:set-webhooks`). Never prints tokens, API keys, or webhook
# secrets — only channel name, hostname, path, and HTTP status.
#
# Usage:
#   pnpm ingress:set-webhooks -- --dry-run
#   pnpm ingress:set-webhooks -- --telegram
#   pnpm ingress:set-webhooks -- --kapso
#   pnpm ingress:set-webhooks

set -euo pipefail

# Load local env file when present. Values are never printed by this script.
if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

telegram_path="/api/channels/telegram"
kapso_path="/api/channels/kapso"
kapso_api_base="https://api.kapso.ai/platform/v1"

dry_run=0
want_telegram=0
want_kapso=0

for arg in "$@"; do
  case "$arg" in
    --) ;;
    --dry-run) dry_run=1 ;;
    --telegram) want_telegram=1 ;;
    --kapso) want_kapso=1 ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *)
      echo "[ingress:set-webhooks] error: unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ "$want_telegram" -eq 0 && "$want_kapso" -eq 0 ]]; then
  want_telegram=1
  want_kapso=1
fi

trim() {
  local value="${1-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

require_env() {
  local name="$1"
  local value
  value="$(trim "${!name-}")"
  if [[ -z "$value" ]]; then
    echo "[ingress:set-webhooks] error: Missing required environment variable name: $name" >&2
    exit 1
  fi
  printf '%s' "$value"
}

env_set() {
  local name="$1"
  local value
  value="$(trim "${!name-}")"
  [[ -n "$value" ]]
}

public_origin() {
  local raw hostname
  raw="$(trim "${COMPANION_PUBLIC_BASE_URL-}")"
  if [[ -z "$raw" ]]; then
    raw="$(trim "${BETTER_AUTH_URL-}")"
  fi
  if [[ -z "$raw" ]]; then
    echo "[ingress:set-webhooks] error: Set COMPANION_PUBLIC_BASE_URL (preferred) or BETTER_AUTH_URL to the public HTTPS origin." >&2
    exit 1
  fi
  case "$raw" in
    https://*) ;;
    *)
      echo "[ingress:set-webhooks] error: Public webhook base URL must use https:" >&2
      exit 1
      ;;
  esac
  if [[ "$raw" =~ ^https://[^/]+/+$ ]]; then
    raw="${raw%/}"
  elif [[ "$raw" =~ ^https://[^/]+/.+ ]]; then
    echo "[ingress:set-webhooks] error: Public base URL must be an origin only (no path)." >&2
    exit 1
  fi
  raw="${raw%/}"
  hostname="${raw#https://}"
  hostname="${hostname%%/*}"
  if [[ "$hostname" == *.trycloudflare.com && "${COMPANION_ALLOW_EPHEMERAL_WEBHOOK-}" != "1" ]]; then
    echo "[ingress:set-webhooks] error: Refusing *.trycloudflare.com (ephemeral). Use a named tunnel hostname, or set COMPANION_ALLOW_EPHEMERAL_WEBHOOK=1 for a deliberate temporary test." >&2
    exit 1
  fi
  printf '%s' "$raw"
}

log_status() {
  local channel="$1" phase="$2" hostname="$3" path="$4" status="$5" ok="$6"
  local mark="fail"
  [[ "$ok" == "1" ]] && mark="ok"
  echo "[ingress:set-webhooks] ${channel} ${phase} host=${hostname} path=${path} status=${status} ${mark}"
}

set_telegram() {
  local origin="$1"
  local url hostname token secret status body ok
  url="${origin}${telegram_path}"
  hostname="${origin#https://}"
  if [[ "$dry_run" -eq 1 ]]; then
    log_status telegram setWebhook "$hostname" "$telegram_path" dry-run 1
    return 0
  fi
  token="$(require_env TELEGRAM_BOT_TOKEN)"
  secret="$(require_env TELEGRAM_WEBHOOK_SECRET)"
  body="$(
    python3 -c 'import json,sys; print(json.dumps({"url":sys.argv[1],"secret_token":sys.argv[2],"drop_pending_updates":False,"allowed_updates":["message","callback_query","my_chat_member"]}))' \
      "$url" "$secret"
  )"
  status="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      -X POST "https://api.telegram.org/bot${token}/setWebhook" \
      -H 'content-type: application/json' \
      --data-binary "$body"
  )"
  ok=0
  [[ "$status" == "200" ]] && ok=1
  log_status telegram setWebhook "$hostname" "$telegram_path" "$status" "$ok"
  if [[ "$ok" -ne 1 ]]; then
    echo "[ingress:set-webhooks] error: Telegram setWebhook failed (see status; secrets not logged)." >&2
    exit 1
  fi
}

set_kapso() {
  local origin="$1"
  local url hostname phone api_key secret webhook_id status list_file existing_id ok
  url="${origin}${kapso_path}"
  hostname="${origin#https://}"
  webhook_id="$(trim "${KAPSO_WEBHOOK_ID-}")"
  if [[ "$dry_run" -eq 1 ]]; then
    if [[ -n "$webhook_id" ]]; then
      log_status kapso patch "$hostname" "$kapso_path" dry-run 1
    else
      log_status kapso upsert "$hostname" "$kapso_path" dry-run 1
    fi
    return 0
  fi
  phone="$(require_env KAPSO_PHONE_NUMBER_ID)"
  api_key="$(require_env KAPSO_API_KEY)"
  secret="$(require_env KAPSO_WEBHOOK_SECRET)"

  kapso_write() {
    local method="$1" endpoint="$2" phase="$3" payload
    if [[ "$phase" == "create" ]]; then
      payload="$(
        python3 -c 'import json,sys; print(json.dumps({"whatsapp_webhook":{"kind":"kapso","url":sys.argv[1],"secret_key":sys.argv[2],"active":True,"events":["whatsapp.message.received"]}}))' \
          "$url" "$secret"
      )"
    else
      payload="$(
        python3 -c 'import json,sys; print(json.dumps({"whatsapp_webhook":{"url":sys.argv[1],"secret_key":sys.argv[2],"active":True,"events":["whatsapp.message.received"]}}))' \
          "$url" "$secret"
      )"
    fi
    status="$(
      curl -sS -o /dev/null -w '%{http_code}' \
        -X "$method" "$endpoint" \
        -H "X-API-Key: ${api_key}" \
        -H 'content-type: application/json' \
        --data-binary "$payload"
    )"
    ok=0
    [[ "$status" =~ ^2[0-9][0-9]$ ]] && ok=1
    log_status kapso "$phase" "$hostname" "$kapso_path" "$status" "$ok"
    if [[ "$ok" -ne 1 ]]; then
      echo "[ingress:set-webhooks] error: Kapso webhook ${phase} failed (see status; secrets not logged)." >&2
      exit 1
    fi
  }

  if [[ -n "$webhook_id" ]]; then
    kapso_write PATCH \
      "${kapso_api_base}/whatsapp/phone_numbers/${phone}/webhooks/${webhook_id}" \
      patch
    return 0
  fi

  list_file="$(mktemp)"
  status="$(
    curl -sS -o "$list_file" -w '%{http_code}' \
      -H "X-API-Key: ${api_key}" \
      "${kapso_api_base}/whatsapp/phone_numbers/${phone}/webhooks?kind=kapso&per_page=50"
  )"
  if [[ ! "$status" =~ ^2[0-9][0-9]$ ]]; then
    rm -f "$list_file"
    log_status kapso list "$hostname" "$kapso_path" "$status" 0
    echo "[ingress:set-webhooks] error: Kapso webhook list failed (see status; secrets not logged)." >&2
    exit 1
  fi
  existing_id="$(
    python3 -c 'import json,sys
data=json.load(open(sys.argv[1])).get("data") or []
active=next((row for row in data if row.get("kind")=="kapso" and row.get("active")), None)
row=active or next((row for row in data if row.get("kind")=="kapso"), None)
print(row["id"] if row else "")' "$list_file"
  )"
  rm -f "$list_file"

  if [[ -n "$existing_id" ]]; then
    kapso_write PATCH \
      "${kapso_api_base}/whatsapp/phone_numbers/${phone}/webhooks/${existing_id}" \
      patch
    return 0
  fi

  kapso_write POST \
    "${kapso_api_base}/whatsapp/phone_numbers/${phone}/webhooks" \
    create
}

origin="$(public_origin)"
hostname="${origin#https://}"
channels=""
[[ "$want_telegram" -eq 1 ]] && channels="telegram"
if [[ "$want_kapso" -eq 1 ]]; then
  if [[ -n "$channels" ]]; then
    channels="${channels},kapso"
  else
    channels="kapso"
  fi
fi
dry_label="no"
[[ "$dry_run" -eq 1 ]] && dry_label="yes"
echo "[ingress:set-webhooks] base_host=${hostname} dry_run=${dry_label} channels=${channels}"

if [[ "$want_telegram" -eq 1 ]]; then
  if env_set TELEGRAM_BOT_TOKEN || env_set TELEGRAM_WEBHOOK_SECRET; then
    set_telegram "$origin"
  else
    echo "[ingress:set-webhooks] telegram skip (TELEGRAM_* env names unset)"
  fi
fi

if [[ "$want_kapso" -eq 1 ]]; then
  if env_set KAPSO_PHONE_NUMBER_ID || env_set KAPSO_API_KEY || env_set KAPSO_WEBHOOK_SECRET; then
    set_kapso "$origin"
  else
    echo "[ingress:set-webhooks] kapso skip (KAPSO_* env names unset)"
  fi
fi
