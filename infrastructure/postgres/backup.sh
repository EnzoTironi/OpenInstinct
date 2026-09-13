#!/bin/sh
set -eu
umask 077
case "${1:-}" in full|diff|incr) ;; *) echo 'Expected full, diff or incr.' >&2; exit 2 ;; esac
if [ "${ZOEN_RECOVERY_ISOLATED:-}" = true ]; then
  echo 'An isolated recovery must never back up into production.' >&2
  exit 1
fi
if [ "$(id -u)" = 0 ]; then exec gosu postgres "$0" "$@"; fi
pgbackrest --stanza=zoen stanza-create
pgbackrest --stanza=zoen check
pgbackrest --stanza=zoen --type="$1" backup
date +%s > /data/backup-status/success.new
mv /data/backup-status/success.new /data/backup-status/success
echo 'PostgreSQL backup completed.'
