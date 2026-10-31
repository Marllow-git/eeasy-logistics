-- The four database roles of data architecture §4.4 (PLAT-2 decision 2.3; ADR-0019).
--
-- Runs once, as the superuser, when the container starts on an empty data
-- directory (docker-entrypoint-initdb.d, database elx). The passwords are
-- local-only and come from .env through the container environment; psql reads
-- them with \getenv so none is written here.
--
-- Grants on tables are the migrations' work (PLAT-5). The template database
-- elx_seed is PLAT-5's too (data §11.7); this order only reserves the name,
-- which tools/stack.sh clones from once it exists.

\getenv owner_password ELX_OWNER_PASSWORD
\getenv app_password ELX_APP_PASSWORD
\getenv platform_password ELX_PLATFORM_PASSWORD
\getenv maintenance_password ELX_MAINTENANCE_PASSWORD

-- Owns every object; used only by the migration and partition jobs.
CREATE ROLE elx_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
  PASSWORD :'owner_password';

-- API and worker pools for tenant work, subject to tenant_isolation.
CREATE ROLE elx_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
  PASSWORD :'app_password';

-- The cross-tenant pool. It sees every account through the platform_access
-- policy, not through BYPASSRLS.
CREATE ROLE elx_platform LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
  PASSWORD :'platform_password';

-- The per-account export and deletion tool only; in no API or worker pool.
CREATE ROLE elx_maintenance LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
  PASSWORD :'maintenance_password';

-- elx_owner owns the database; on PostgreSQL 16 the public schema belongs to
-- pg_database_owner, so it follows.
ALTER DATABASE elx OWNER TO elx_owner;
