#!/usr/bin/env bash
# Compatibility entry point; all mutations use the unified Alchemy stack.
set -euo pipefail
infra_dir="$(cd "$(dirname "$0")/../infrastructure" && pwd)"
operation=${1:-help}
if [[ $# -gt 0 ]]; then shift; fi
stage=prod
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) stage=${2:?--stage requires a value}; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

case "$operation" in
  help|-h|--help)
    cat <<'USAGE'
Usage: scripts/fly-alchemy-pg.sh <plan|deploy|status|url-shape|verify> [--stage prod]

plan/deploy now operate the complete Zoen Alchemy stack, including web, memory,
database, backups and DNS. Configuration: infrastructure/.env.<stage>.
status, url-shape and verify inspect the pinned production installation.
See infrastructure/README.md for image pinning, recovery and local development.
USAGE
    ;;
  plan|deploy)
    cd "$infra_dir"
    arguments=("$operation" --stage "$stage" --env-file "$infra_dir/.env.$stage")
    if [[ $operation == deploy ]]; then arguments+=(--yes); fi
    exec pnpm exec alchemy "${arguments[@]}"
    ;;
  status|url-shape|verify)
    [[ $stage == prod ]] || { echo 'These diagnostics target production only.' >&2; exit 1; }
    cd "$infra_dir"
    if [[ $operation == verify ]]; then
      exec node --env-file="$infra_dir/.env.prod" operations.ts check
    fi
    pg_app=$(node --input-type=module -e 'import { production } from "./production.ts"; console.log(production.database.app)')
    if [[ $operation == status ]]; then
      exec fly status --app "$pg_app"
    fi
    printf 'postgresql://postgres:<url-encoded-password>@%s.internal:5432/open_instinct_prod\n' "$pg_app"
    ;;
  destroy)
    echo 'This alias no longer destroys resources. Review the complete Alchemy plan and recovery runbook first.' >&2
    exit 1
    ;;
  *) echo "Unknown operation: $operation. Use --help." >&2; exit 1 ;;
esac
