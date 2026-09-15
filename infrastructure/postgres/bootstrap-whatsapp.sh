#!/bin/bash
set -euo pipefail
: "${ZOEN_WHATSAPP_DATABASE_PASSWORD:?WhatsApp database password is required}"
psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
\getenv whatsapp_password ZOEN_WHATSAPP_DATABASE_PASSWORD
SELECT 'CREATE ROLE zoen_whatsapp LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zoen_whatsapp') \gexec
SELECT format('ALTER ROLE zoen_whatsapp LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8 PASSWORD %L', :'whatsapp_password') \gexec
SELECT 'CREATE DATABASE zoen_whatsapp OWNER zoen_whatsapp'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'zoen_whatsapp') \gexec
REVOKE ALL ON DATABASE zoen_whatsapp FROM PUBLIC;
\connect zoen_whatsapp
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO zoen_whatsapp;
SQL
