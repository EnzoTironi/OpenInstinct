#!/bin/bash
set -euo pipefail
umask 077

if [[ ${ZOEN_RESTORE_PROOF:-0} == 1 ]]; then
  [[ ${ZOEN_RECOVERY_ISOLATED:-} == true ]] || { echo 'Recovery requires an isolated copy.' >&2; exit 1; }
  # Recovery must never publish WAL to the production repository.
  if [[ ${ZOEN_RESTORE_FROM_BACKUP:-0} == 1 ]]; then
    [[ ! -e $PGDATA/PG_VERSION ]] || { echo 'Restore destination must be empty.' >&2; exit 1; }
    mkdir -p "$PGDATA" /tmp/pgbackrest
    chown postgres:postgres "$PGDATA" /tmp/pgbackrest
    restore_args=(--stanza=zoen)
    if [[ -n ${ZOEN_RESTORE_TARGET:-} ]]; then
      restore_args+=(--type=time --target="$ZOEN_RESTORE_TARGET" --target-action=promote)
    fi
    gosu postgres pgbackrest "${restore_args[@]}" restore
  fi
  /usr/local/bin/docker-entrypoint.sh postgres -c archive_mode=off &
  database_pid=$!
  trap 'kill -TERM "$database_pid" 2>/dev/null || true; wait "$database_pid" || true' EXIT INT TERM
  recovery_complete=false
  for (( attempt=0; attempt<360; attempt++ )); do
    # pg_isready also accepts a read-only hot-standby during WAL replay. The
    # integrity proof installs amcheck, so wait until replay has finished.
    if [[ $(psql -X -U postgres -d postgres -Atc 'SELECT NOT pg_is_in_recovery()' 2>/dev/null) == t ]]; then
      recovery_complete=true
      break
    fi
    kill -0 "$database_pid" || exit 1
    sleep 1
  done
  [[ $recovery_complete == true ]] || { echo 'WAL recovery did not complete in time.' >&2; exit 1; }
  /usr/local/bin/verify-restore.sh > /tmp/zoen-restore-proof.json.new
  mv /tmp/zoen-restore-proof.json.new /tmp/zoen-restore-proof.json
  cat /tmp/zoen-restore-proof.json
  if [[ ${ZOEN_RECOVERY_HOLD:-0} == 1 ]]; then wait "$database_pid"; fi
  exit
fi

if [[ ${ZOEN_BACKUPS_ENABLED:-0} != 1 ]]; then
  exec /usr/local/bin/docker-entrypoint.sh "$@"
fi

: "${PGBACKREST_REPO1_S3_BUCKET:?Backup bucket is required}"
: "${PGBACKREST_REPO1_S3_KEY:?Backup credential is required}"
: "${PGBACKREST_REPO1_S3_KEY_SECRET:?Backup credential is required}"
: "${PGBACKREST_REPO1_CIPHER_PASS:?Backup encryption key is required}"
mkdir -p /tmp/pgbackrest /data/backup-status
chown postgres:postgres /tmp/pgbackrest /data/backup-status

/usr/local/bin/docker-entrypoint.sh "$@" \
  -c archive_mode=on \
  -c 'archive_command=pgbackrest --stanza=zoen archive-push %p' \
  -c archive_timeout=60s \
  -c wal_compression=on &
database_pid=$!
crond -f -l 8 &
scheduler_pid=$!
trap 'kill -TERM "$database_pid" "$scheduler_pid" 2>/dev/null || true; wait || true' EXIT INT TERM

# A failed initial backup leaves PG available. Cron retries; an external probe
# checks the actual repository and alerts on missing or stale backups.
(
  for (( attempt=0; attempt<120; attempt++ )); do
    if pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
      /usr/local/bin/backup.sh incr
      exit
    fi
    sleep 1
  done
  echo 'Initial backup could not reach PostgreSQL.' >&2
) &

# Both long-lived services must survive. A dead scheduler restarts the machine.
wait -n "$database_pid" "$scheduler_pid"
exit 1
