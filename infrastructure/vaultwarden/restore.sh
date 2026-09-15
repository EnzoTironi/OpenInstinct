#!/bin/bash
set -euo pipefail
umask 077
[[ ${ZOEN_RECOVERY_ISOLATED:-false} == true ]] || { echo 'Recovery requires an isolated copy.' >&2; exit 1; }
[[ ${PGDATABASE:-} == zoen_vaultwarden_restore ]] || { echo 'Recovery requires the dedicated restore database.' >&2; exit 1; }
[[ -n ${1:-} ]] || { echo 'Choose an immutable backup snapshot ID.' >&2; exit 2; }
[[ $1 =~ ^[a-f0-9]{64}$ ]] || { echo 'Use the full snapshot ID, not latest.' >&2; exit 2; }
[[ ! -e /restore/data ]] || { echo 'Recovery destination must be empty.' >&2; exit 1; }
restic check --read-data > /tmp/zoen-vault-restore-check.log 2>&1
restic restore "$1" --target /restore --verify > /tmp/zoen-vault-restore.log 2>&1
pg_restore --exit-on-error --no-owner --no-acl --dbname="$PGDATABASE" /restore/data/zoen-backup/database.dump > /tmp/zoen-vault-pg-restore.log 2>&1
echo 'Encrypted snapshot and vault database restored into the isolated destination.'
