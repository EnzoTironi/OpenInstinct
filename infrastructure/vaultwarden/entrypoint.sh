#!/bin/bash
set -euo pipefail
umask 077
: "${PGHOST:?Vault database host is required}"
: "${PGPASSWORD:?Vault database password is required}"
export PGUSER=zoen_vaultwarden PGDATABASE=zoen_vaultwarden PGPORT=5432
DATABASE_URL=$(python3 -c 'import os,urllib.parse; print("postgresql://zoen_vaultwarden:"+urllib.parse.quote(os.environ["PGPASSWORD"],safe="")+"@"+os.environ["PGHOST"]+":5432/zoen_vaultwarden")')
export DATABASE_URL
mkdir -p /data/backup-status
if [[ ${ZOEN_VAULT_BACKUPS_ENABLED:-false} != true ]]; then
  exec /start.sh
fi
: "${RESTIC_REPOSITORY:?Backup repository is required}"
: "${RESTIC_PASSWORD:?Backup encryption key is required}"
: "${AWS_ACCESS_KEY_ID:?Backup access key is required}"
: "${AWS_SECRET_ACCESS_KEY:?Backup secret is required}"
if [[ ! -s /data/backup-status/success ]]; then
  ZOEN_VAULT_STOPPED=true timeout 180s /usr/local/bin/backup.sh
fi
echo $$ > /run/zoen-vault-supervisor.pid
crond -f -l 8 &
scheduler_pid=$!
vault_pid=
backup_requested=0
trap 'backup_requested=1; [[ -z $vault_pid ]] || kill -TERM "$vault_pid" 2>/dev/null || true' USR1
trap '[[ -z $vault_pid ]] || kill -TERM "$vault_pid" 2>/dev/null || true; kill -TERM "$scheduler_pid" 2>/dev/null || true; exit 0' TERM INT
# Stop the only writer before capturing its DB and files. A failed backup must
# bring the service back, while its failed receipt remains visible to monitoring.
while true; do
  /start.sh &
  vault_pid=$!
  wait -n "$vault_pid" "$scheduler_pid" || true
  if [[ $backup_requested != 1 ]]; then
    kill -TERM "$vault_pid" "$scheduler_pid" 2>/dev/null || true
    exit 1
  fi
  wait "$vault_pid" 2>/dev/null || true
  vault_pid=
  backup_requested=0
  if ZOEN_VAULT_STOPPED=true timeout 180s /usr/local/bin/backup.sh; then
    echo 'Vault backup completed; reopening the service.'
  else
    date +%s > /data/backup-status/failed
    echo 'Vault backup failed; reopening the service. Inspect the private backup log.' >&2
  fi
done
