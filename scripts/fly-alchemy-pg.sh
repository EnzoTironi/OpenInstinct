#!/usr/bin/env bash
# Alchemy unmanaged Postgres on Fly (H01 option C). Never prints secret values.
# NOT Fly Managed Postgres / alchemy Fly.Postgres MPG.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INFRA="$ROOT/infrastructure"
STACK_MAIN="alchemy.fly-postgres.run.ts"
cd "$ROOT"

usage() {
  cat <<'USAGE'
Usage: scripts/fly-alchemy-pg.sh <plan|deploy|status|url-shape|verify|destroy> [--stage <name>]

  plan       Alchemy plan for Fly App+Machine+volume Postgres (no apply)
  deploy     Alchemy deploy (creates/updates unmanaged PG on Fly private net)
  status     fly status for the stage PG app (read-only; names only)
  url-shape  Print DATABASE_URL *shape* with placeholders (no secrets)
  verify     Connectivity check via companion app → PG .internal (no secret print)
  destroy    Alchemy destroy for this stack/stage (prod retains per policy)

Options:
  --stage <name>   Alchemy stage (default: prod). Documented: local|dev|staging|prod

Env (names only; set in infrastructure/.env — never commit real values):
  COMPANION_POSTGRES_PASSWORD   required for plan/deploy
  FLY_API_TOKEN                 or alchemy login / fly auth
  COMPANION_FLY_PG_REGION       default gru (match companion-tironi)
  COMPANION_FLY_PG_VOLUME_GB    default 10
  COMPANION_FLY_PG_APP_NAME     default companion-pg-<stage>
  COMPANION_FLY_APP             compute app for verify (default from fly.toml)

This path is Alchemy Fly.Machine + volume (postgres:17-alpine), matching
CompanionStagePolicy database names. It is explicitly NOT MPG.
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

STAGE="prod"
CMD=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    plan|deploy|status|url-shape|verify|destroy)
      CMD="$1"
      shift
      ;;
    --stage)
      STAGE="${2:?--stage requires a value}"
      shift 2
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$CMD" ]]; then
  usage
  exit 1
fi

default_pg_app() {
  echo "companion-pg-${STAGE}"
}

pg_app_name() {
  if [[ -n "${COMPANION_FLY_PG_APP_NAME:-}" ]]; then
    echo "$COMPANION_FLY_PG_APP_NAME"
  else
    default_pg_app
  fi
}

companion_app_name() {
  if [[ -n "${COMPANION_FLY_APP:-}" ]]; then
    echo "$COMPANION_FLY_APP"
  else
    awk -F'"' '/^app[[:space:]]*=/{print $2; exit}' "$ROOT/fly.toml"
  fi
}

database_name() {
  # Mirror companion-stage.ts: open_instinct_<stage> with hyphens → underscores
  local stage_key
  stage_key="${STAGE//-/_}"
  echo "open_instinct_${stage_key}"
}

load_infra_env() {
  if [[ -f "$INFRA/.env" ]]; then
    # shellcheck disable=SC1091
    set -a
    # Export names only into this process; never echo values.
    source "$INFRA/.env"
    set +a
  fi
}

run_alchemy() {
  local alchemy_cmd="$1"
  load_infra_env
  if [[ -z "${COMPANION_POSTGRES_PASSWORD:-}" ]]; then
    echo "COMPANION_POSTGRES_PASSWORD is unset (set in infrastructure/.env)" >&2
    exit 1
  fi
  pnpm --dir "$INFRA" exec alchemy "$alchemy_cmd" "$STACK_MAIN" --stage "$STAGE" ${YES_FLAG:-}
}

case "$CMD" in
  plan)
    YES_FLAG=""
    run_alchemy plan
    ;;
  deploy)
    YES_FLAG="--yes"
    run_alchemy deploy
    echo
    echo "Deploy finished (secrets not printed)."
    echo "Next: set companion-tironi DATABASE_URL* to the url-shape host/db, then migrate."
    echo "  ./scripts/fly-alchemy-pg.sh url-shape --stage ${STAGE}"
    echo "  ./scripts/fly-alchemy-pg.sh verify --stage ${STAGE}"
    ;;
  destroy)
    YES_FLAG="--yes"
    echo "Destroying Alchemy Fly PG stack for stage=${STAGE} (prod retain policy applies)."
    run_alchemy destroy
    ;;
  status)
    need_fly
    APP="$(pg_app_name)"
    echo "Fly app (unmanaged PG, not MPG): ${APP}"
    "$(fly_bin)" status -a "$APP"
    echo
    "$(fly_bin)" volumes list -a "$APP" || true
    ;;
  url-shape)
    APP="$(pg_app_name)"
    DB="$(database_name)"
    HOST="${APP}.internal"
    echo "provider=fly-machine-unmanaged-postgres (NOT MPG)"
    echo "stage=${STAGE}"
    echo "appName=${APP}"
    echo "database=${DB}"
    echo "internalHost=${HOST}"
    echo "internalPort=5432"
    echo "DATABASE_URL=postgresql://postgres:<url-encoded-password>@${HOST}:5432/${DB}?sslmode=disable"
    echo "DATABASE_URL_UNPOOLED=postgresql://postgres:<url-encoded-password>@${HOST}:5432/${DB}?sslmode=disable"
    echo
    echo "Set on compute (names only; values from your secret store):"
    echo "  fly secrets set -a $(companion_app_name) DATABASE_URL='…' DATABASE_URL_UNPOOLED='…'"
    ;;
  verify)
    need_fly
    APP="$(pg_app_name)"
    COMPUTE="$(companion_app_name)"
    DB="$(database_name)"
    HOST="${APP}.internal"
    echo "Verifying 6PN reachability (no passwords printed)…"
    echo "  compute=${COMPUTE} → ${HOST}:5432 db=${DB}"
    # TCP-level check from compute Machine; does not print credentials.
    if ! "$(fly_bin)" status -a "$COMPUTE" >/dev/null 2>&1; then
      echo "Compute app ${COMPUTE} not reachable via fly status — deploy companion-tironi first, or set COMPANION_FLY_APP." >&2
      echo "Fallback: fly machine list -a ${APP} && fly ssh console -a ${APP} -C 'pg_isready -U postgres'" >&2
      exit 1
    fi
    "$(fly_bin)" ssh console -a "$COMPUTE" -C "node -e \"const n=require('net');const s=n.connect({host:'${HOST}',port:5432},()=>{console.log('tcp_ok host=${HOST} port=5432');s.end()});s.on('error',e=>{console.error('tcp_fail',e.code||e.message);process.exit(1)});setTimeout(()=>{console.error('tcp_timeout');process.exit(1)},8000)\""
    echo "Optional (on PG app, names only): fly ssh console -a ${APP} -C 'pg_isready -U postgres'"
    ;;
  *)
    usage
    exit 1
    ;;
esac
