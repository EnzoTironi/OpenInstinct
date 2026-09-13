#!/bin/sh
set -eu
umask 077
if [ "${ZOEN_RECOVERY_ISOLATED:-}" != true ]; then
  echo 'Restore verification requires an isolated copy.' >&2
  exit 1
fi
# Never return rows or documents to CI. Structural corruption is a failed drill.
pg_amcheck --all --install-missing -U postgres > /tmp/zoen-amcheck.log 2>&1
psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "${POSTGRES_DB:-open_instinct_prod}" -At <<'SQL'
DO $verify$
BEGIN
  IF (SELECT count(*) FROM pg_database WHERE datname IN (current_database(), 'zoen_memory', 'zoen_matrix')) <> 3 THEN
    RAISE EXCEPTION 'Application, memory and Matrix databases must all be restored';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('zoen_app','zoen_migrator','zoen_memory','zoen_matrix')
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) <> 4
    OR pg_has_role('zoen_app','zoen_migrator','MEMBER')
    OR has_schema_privilege('zoen_app','public','CREATE')
    OR has_database_privilege('zoen_matrix',current_database(),'CONNECT')
    OR has_database_privilege('zoen_memory',current_database(),'CONNECT') THEN
    RAISE EXCEPTION 'Restored service role isolation failed';
  END IF;
END;
$verify$;
SELECT json_build_object(
  'ok', true,
  'postgres_version', current_setting('server_version'),
  'amcheck', 'passed',
  'service_databases', json_build_array(current_database(), 'zoen_memory', 'zoen_matrix'),
  'role_isolation', 'passed',
  'workspace_count', (SELECT count(*) FROM workspaces),
  'repository_count', (SELECT count(*) FROM workspace_repository),
  'revision_count', (SELECT count(*) FROM workspace_revision),
  'pending_memory_erasures', (SELECT count(*) FROM workspace_memory_erasure)
);
SQL
