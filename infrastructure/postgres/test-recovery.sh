#!/bin/bash
# Disposable, offline integration test for the actual production image.
set -euo pipefail
image=${1:-zoen-postgres-proof:pg17-backup}
prefix="zoen-recovery-ci-$$"
source_name="$prefix-source"
restore_name="$prefix-restore"
cleanup() {
  docker rm -f "$source_name" "$restore_name" >/dev/null 2>&1 || true
  docker volume rm "$prefix-source" "$prefix-repo" "$prefix-restore" >/dev/null
}
trap cleanup EXIT
common=(-e POSTGRES_PASSWORD=test-password -e POSTGRES_DB=open_instinct_prod
  -e ZOEN_MEMORY_DATABASE_PASSWORD=test-memory-password
  -e ZOEN_MATRIX_DATABASE_PASSWORD=test-matrix-password
  -e ZOEN_APPLICATION_DATABASE_PASSWORD=test-app-password
  -e ZOEN_MIGRATION_DATABASE_PASSWORD=test-migrator-password
  -e PGBACKREST_REPO1_TYPE=posix -e PGBACKREST_REPO1_PATH=/backup
  -e PGBACKREST_REPO1_CIPHER_PASS=test-only-encryption-key)
docker volume create "$prefix-source" >/dev/null
docker volume create "$prefix-repo" >/dev/null
docker volume create "$prefix-restore" >/dev/null
docker run --rm -v "$prefix-repo:/backup" --entrypoint chown "$image" postgres:postgres /backup
docker run -d --name "$source_name" "${common[@]}" \
  -e ZOEN_BACKUPS_ENABLED=1 -e PGBACKREST_REPO1_S3_BUCKET=unused \
  -e PGBACKREST_REPO1_S3_KEY=unused -e PGBACKREST_REPO1_S3_KEY_SECRET=unused \
  -v "$prefix-source:/data" -v "$prefix-repo:/backup" "$image" >/dev/null
ready=false
for _ in {1..120}; do
  if docker exec "$source_name" test -s /data/backup-status/success; then ready=true; break; fi
  sleep 1
done
if [[ $ready != true ]]; then docker logs "$source_name"; exit 1; fi
docker exec "$source_name" /usr/local/bin/bootstrap-application.sh
docker exec "$source_name" /usr/local/bin/bootstrap-memory.sh
docker exec "$source_name" /usr/local/bin/bootstrap-memory.sh
docker exec "$source_name" /usr/local/bin/bootstrap-matrix.sh
docker exec "$source_name" /usr/local/bin/bootstrap-matrix.sh
allowed=$(docker exec "$source_name" psql -X -U postgres -d postgres -At -v ON_ERROR_STOP=1 \
  -c "SELECT has_database_privilege('zoen_memory', 'open_instinct_prod', 'CONNECT');")
[[ $allowed == f ]] || { echo 'Memory role can enter the application database.' >&2; exit 1; }
docker exec -e PGPASSWORD=test-memory-password "$source_name" psql -X -h 127.0.0.1 -U zoen_memory -d zoen_memory -v ON_ERROR_STOP=1 \
  -c "CREATE TABLE memory_probe (id int PRIMARY KEY, value vector(3)); INSERT INTO memory_probe VALUES (1, '[1,2,3]');"
docker exec -e PGPASSWORD=test-matrix-password "$source_name" psql -X -h 127.0.0.1 -U zoen_matrix -d zoen_matrix -v ON_ERROR_STOP=1 \
  -c "CREATE TABLE matrix_probe (id int PRIMARY KEY); INSERT INTO matrix_probe VALUES (1);"
docker exec -i "$source_name" psql -X -U postgres -d open_instinct_prod -v ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION vector;
CREATE TABLE workspaces(id int PRIMARY KEY);
CREATE TABLE workspace_repository(id int PRIMARY KEY);
CREATE TABLE workspace_revision(id int PRIMARY KEY);
CREATE TABLE workspace_memory_erasure(id int PRIMARY KEY);
CREATE TABLE recovery_vectors(id int PRIMARY KEY, value vector(3));
INSERT INTO workspaces VALUES (1);
INSERT INTO recovery_vectors VALUES (1, '[1,2,3]');
SQL
docker exec "$source_name" /usr/local/bin/bootstrap-application.sh
docker exec "$source_name" /usr/local/bin/bootstrap-application.sh
docker exec "$source_name" /usr/local/bin/backup.sh full
# This row exists only in archived WAL, after the full backup completed.
docker exec "$source_name" psql -X -U postgres -d open_instinct_prod -v ON_ERROR_STOP=1 \
  -c "INSERT INTO recovery_vectors VALUES (2, '[4,5,6]'); SELECT pg_switch_wal();"
docker exec "$source_name" gosu postgres pgbackrest --stanza=zoen check
docker exec "$source_name" /usr/local/bin/backup-health.sh
docker stop "$source_name" >/dev/null
docker run -d --name "$restore_name" "${common[@]}" \
  -e ZOEN_RESTORE_PROOF=1 -e ZOEN_RESTORE_FROM_BACKUP=1 \
  -e ZOEN_RECOVERY_ISOLATED=true -e ZOEN_RECOVERY_HOLD=1 \
  -v "$prefix-restore:/data" -v "$prefix-repo:/backup:ro" "$image" >/dev/null
ready=false
for _ in {1..120}; do
  if docker exec "$restore_name" test -s /tmp/zoen-restore-proof.json; then ready=true; break; fi
  sleep 1
done
if [[ $ready != true ]]; then docker logs "$restore_name"; exit 1; fi
actual=$(docker exec "$restore_name" psql -X -U postgres -d open_instinct_prod -At -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) = 2 AND max(value <-> '[4,5,6]'::vector) > 0 FROM recovery_vectors;")
[[ $actual == t ]] || { echo 'WAL recovery lost a committed vector.' >&2; exit 1; }
actual=$(docker exec -e PGPASSWORD=test-memory-password "$restore_name" psql -X -h 127.0.0.1 -U zoen_memory -d zoen_memory -At -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) = 1 FROM memory_probe WHERE value = '[1,2,3]'::vector;")
[[ $actual == t ]] || { echo 'Restored memory database or credentials failed.' >&2; exit 1; }
actual=$(docker exec -e PGPASSWORD=test-matrix-password "$restore_name" psql -X -h 127.0.0.1 -U zoen_matrix -d zoen_matrix -At -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) = 1 FROM matrix_probe;")
[[ $actual == t ]] || { echo 'Restored Matrix database or credentials failed.' >&2; exit 1; }
actual=$(docker exec -e PGPASSWORD=test-app-password "$restore_name" psql -X -h 127.0.0.1 -U zoen_app -d open_instinct_prod -At -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) = 1 AND NOT has_schema_privilege('zoen_app', 'public', 'CREATE') AND NOT pg_has_role('zoen_app', 'zoen_migrator', 'MEMBER') FROM workspaces;")
[[ $actual == t ]] || { echo 'Restored runtime role isolation failed.' >&2; exit 1; }
docker exec "$restore_name" cat /tmp/zoen-restore-proof.json
if docker exec "$restore_name" /usr/local/bin/backup.sh full; then
  echo 'An isolated restore must not write backups.' >&2
  exit 1
fi
echo 'Encrypted backup, WAL replay, memory, Matrix and runtime role recovery passed.'
