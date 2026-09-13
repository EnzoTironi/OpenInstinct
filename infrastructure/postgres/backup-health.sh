#!/bin/bash
set -euo pipefail
if [ "$(id -u)" = 0 ]; then exec gosu postgres "$0" "$@"; fi
# Inspect the repository itself rather than trusting a local success marker.
pgbackrest --stanza=zoen --output=json info | jq -e '
  .[0] as $stanza |
  ($stanza.backup // [] | map(.timestamp.stop) | max // 0) as $last |
  {ok: ($stanza.status.code == 0 and (now - $last) < 9000),
   last_backup_epoch: $last, backup_count: ($stanza.backup | length)} |
  if .ok then . else error("PostgreSQL backup missing or older than 150 minutes") end'
psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT json_build_object('archive_mode', current_setting('archive_mode'),
  'archived_count', archived_count,
  'archive_healthy', archived_count > 0 AND
    (last_failed_time IS NULL OR last_archived_time >= last_failed_time))
FROM pg_stat_archiver;
SELECT CASE WHEN current_setting('archive_mode') = 'on' AND archived_count > 0
  AND (last_failed_time IS NULL OR last_archived_time >= last_failed_time)
  THEN 1 ELSE 1 / (archived_count - archived_count) END FROM pg_stat_archiver;
SQL
