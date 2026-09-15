#!/bin/bash
set -euo pipefail
umask 077
[[ ${ZOEN_VAULT_STOPPED:-false} == true ]] || { echo 'Use the supervisor backup signal to stop writes first.' >&2; exit 1; }
[[ ${ZOEN_RECOVERY_ISOLATED:-false} != true ]] || { echo 'An isolated recovery must not create production backups.' >&2; exit 1; }
mkdir -p /data/zoen-backup /data/backup-status
trap 'rm -f /data/zoen-backup/database.dump.new' EXIT
exec > /data/backup-status/private.log 2>&1
pg_dump --format=custom --no-owner --no-acl --file=/data/zoen-backup/database.dump.new
mv /data/zoen-backup/database.dump.new /data/zoen-backup/database.dump
printf '{"schema":1,"vaultwarden":"1.37.3","capturedAt":"%s","quiesced":true}\n' "$(date -u +%FT%TZ)" > /data/zoen-backup/manifest.json
if ! restic cat config > /dev/null 2>&1; then restic init; fi
restic backup /data --host zoen-vaultwarden --tag quiesced \
  --exclude /data/icon_cache --exclude /data/tmp --exclude /data/backup-status
restic forget --host zoen-vaultwarden --tag quiesced --keep-daily 14 --keep-weekly 4 --keep-monthly 3 --prune
date +%s > /data/backup-status/success.new
mv /data/backup-status/success.new /data/backup-status/success
rm -f /data/backup-status/failed
