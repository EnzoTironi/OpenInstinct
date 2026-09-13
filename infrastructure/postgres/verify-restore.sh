#!/bin/sh
set -eu
umask 077
if [ "${ZOEN_RECOVERY_ISOLATED:-}" != true ]; then
  echo 'Restore verification requires an isolated copy.' >&2
  exit 1
fi
# Never return rows or documents to CI. Structural corruption is a failed drill.
pg_amcheck --all --install-missing -U postgres > /tmp/zoen-amcheck.log 2>&1
psql -X -v ON_ERROR_STOP=1 -U postgres -d "${POSTGRES_DB:-open_instinct_prod}" -At <<'SQL'
SELECT json_build_object(
  'ok', true,
  'postgres_version', current_setting('server_version'),
  'amcheck', 'passed',
  'workspace_count', (SELECT count(*) FROM workspaces),
  'repository_count', (SELECT count(*) FROM workspace_repository),
  'revision_count', (SELECT count(*) FROM workspace_revision),
  'pending_memory_erasures', (SELECT count(*) FROM workspace_memory_erasure)
);
SQL
