#!/bin/bash
set -euo pipefail
: "${ZOEN_MEMORY_DATABASE_PASSWORD:?Memory database password is required}"
psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
\getenv memory_password ZOEN_MEMORY_DATABASE_PASSWORD
\getenv application_database POSTGRES_DB
SELECT 'CREATE ROLE zoen_memory LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zoen_memory') \gexec
SELECT format('ALTER ROLE zoen_memory LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 12 PASSWORD %L', :'memory_password') \gexec
SELECT 'CREATE DATABASE zoen_memory OWNER zoen_memory'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'zoen_memory') \gexec
REVOKE ALL ON DATABASE zoen_memory FROM PUBLIC;
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'application_database') \gexec
\connect zoen_memory
CREATE EXTENSION IF NOT EXISTS vector;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO zoen_memory;
SQL
