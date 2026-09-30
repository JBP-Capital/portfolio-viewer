#!/bin/sh
# Roles and schema GoTrue (the login service) expects in a plain Postgres.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE anon NOLOGIN NOINHERIT;
  CREATE ROLE authenticated NOLOGIN NOINHERIT;
  CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  CREATE ROLE supabase_auth_admin LOGIN NOINHERIT CREATEROLE PASSWORD '$POSTGRES_PASSWORD';
  CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
  GRANT CREATE ON DATABASE "$POSTGRES_DB" TO supabase_auth_admin;
  ALTER ROLE supabase_auth_admin SET search_path = auth;
EOSQL
