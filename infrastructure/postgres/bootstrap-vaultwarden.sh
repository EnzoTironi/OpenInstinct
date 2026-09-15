#!/bin/bash
set -euo pipefail
: "${ZOEN_VAULTWARDEN_DATABASE_PASSWORD:?Vault database password is required}"
psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
\getenv vault_password ZOEN_VAULTWARDEN_DATABASE_PASSWORD
SELECT 'CREATE ROLE zoen_vaultwarden LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zoen_vaultwarden') \gexec
SELECT format('ALTER ROLE zoen_vaultwarden LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 12 PASSWORD %L', :'vault_password') \gexec
SELECT 'CREATE DATABASE zoen_vaultwarden OWNER zoen_vaultwarden'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'zoen_vaultwarden') \gexec
REVOKE ALL ON DATABASE zoen_vaultwarden FROM PUBLIC;
\connect zoen_vaultwarden
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO zoen_vaultwarden;
SQL
