#!/bin/bash
set -euo pipefail
: "${ZOEN_MATRIX_DATABASE_PASSWORD:?Matrix database password is required}"
psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
\getenv matrix_password ZOEN_MATRIX_DATABASE_PASSWORD
SELECT 'CREATE ROLE zoen_matrix LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zoen_matrix') \gexec
SELECT format('ALTER ROLE zoen_matrix LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8 PASSWORD %L', :'matrix_password') \gexec
SELECT 'CREATE DATABASE zoen_matrix OWNER zoen_matrix ENCODING ''UTF8'' LC_COLLATE ''C'' LC_CTYPE ''C'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'zoen_matrix') \gexec
REVOKE ALL ON DATABASE zoen_matrix FROM PUBLIC;
\connect zoen_matrix
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO zoen_matrix;
SQL
