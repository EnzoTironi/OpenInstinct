#!/bin/bash
set -euo pipefail
: "${POSTGRES_DB:?Application database is required}"
: "${ZOEN_APPLICATION_DATABASE_PASSWORD:?Runtime password is required}"
: "${ZOEN_MIGRATION_DATABASE_PASSWORD:?Migration password is required}"
psql -X -U postgres -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<'SQL'
\getenv application_database POSTGRES_DB
\getenv application_password ZOEN_APPLICATION_DATABASE_PASSWORD
\getenv migration_password ZOEN_MIGRATION_DATABASE_PASSWORD
BEGIN;
SELECT pg_advisory_xact_lock(1836019566, 1);
SELECT 'CREATE ROLE zoen_app LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zoen_app') \gexec
SELECT 'CREATE ROLE zoen_migrator LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zoen_migrator') \gexec
SELECT format('ALTER ROLE zoen_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40 PASSWORD %L', :'application_password') \gexec
SELECT format('ALTER ROLE zoen_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4 PASSWORD %L', :'migration_password') \gexec
SELECT format('ALTER DATABASE %I OWNER TO zoen_migrator', :'application_database') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'application_database') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO zoen_app', :'application_database') \gexec
DO $ownership$
DECLARE item record;
BEGIN
  FOR item IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public','drizzle','workflow','workflow_drizzle','graphile_worker','pgboss') LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO zoen_migrator', item.nspname);
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', item.nspname);
  END LOOP;
  FOR item IN SELECT c.relkind,n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','drizzle','workflow','workflow_drizzle','graphile_worker','pgboss')
      AND c.relkind IN ('r','p','S','v','m') AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
      AND NOT (c.relkind='S' AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.refclassid='pg_class'::regclass AND d.deptype IN ('a','i')))
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e') LOOP
    EXECUTE format('ALTER %s %I.%I OWNER TO zoen_migrator', CASE item.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END, item.nspname,item.relname);
  END LOOP;
  FOR item IN SELECT n.nspname,t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='public' AND t.typtype IN ('e','d') AND t.typowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') LOOP
    EXECUTE format('ALTER TYPE %I.%I OWNER TO zoen_migrator',item.nspname,item.typname);
  END LOOP;
  FOR item IN SELECT p.oid,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','workflow','graphile_worker','pgboss') AND p.prokind='f'
      AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') LOOP
    EXECUTE format('ALTER FUNCTION %I.%I(%s) OWNER TO zoen_migrator',item.nspname,item.proname,item.args);
  END LOOP;
END;
$ownership$;
DO $grants$
DECLARE item record;
BEGIN
  FOR item IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public','workflow','graphile_worker','pgboss') LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO zoen_app',item.nspname);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO zoen_app',item.nspname);
    EXECUTE format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA %I TO zoen_app',item.nspname);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO zoen_app',item.nspname);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE zoen_migrator IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zoen_app',item.nspname);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE zoen_migrator IN SCHEMA %I GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO zoen_app',item.nspname);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE zoen_migrator IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO zoen_app',item.nspname);
  END LOOP;
END;
$grants$;
-- Graphile protects its internal queue with RLS even after table grants. Scope
-- the worker policy to this schema; the application still cannot alter policies,
-- own tables, assume the migration role, or bypass RLS anywhere else.
DO $queue_policies$
DECLARE item record;
BEGIN
  FOR item IN SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='graphile_worker' AND c.relkind='r' AND c.relrowsecurity LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=item.oid AND p.polname='zoen_runtime_worker') THEN
      EXECUTE format('CREATE POLICY zoen_runtime_worker ON graphile_worker.%I TO zoen_app USING (true) WITH CHECK (true)', item.relname);
    END IF;
  END LOOP;
END;
$queue_policies$;
COMMIT;
SQL
