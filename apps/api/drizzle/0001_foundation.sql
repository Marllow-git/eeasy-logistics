-- reviewed: PLAT-5 item C, 2026-11-01; review fixes L-3 and M-3 the same day. Hand-written
-- (custom migration).
--
-- The frame every later table lives in (PLAT-5 plan 2.3; data §1.3, §3.1, §3.2, §4.2, §4.4;
-- ADR-0019, ADR-0025, proposed ADR-0031). Runs as elx_owner, which owns every object; the runtime
-- roles elx_app and elx_platform own nothing, so neither can alter a table or disable a trigger.
--
-- The tenancy setting convention (data §4.2, §4.3): the unit of work in packages/db runs
--   SELECT set_config('elx.account_id', '<account uuid>', true)
-- as the first statement of every tenant transaction. The `true` makes it transaction-local, so a
-- pooled connection never carries one request's account into the next. Policies read it as
--   NULLIF(current_setting('elx.account_id', true), '')::uuid
-- because after first use on a connection the unset value reads as '' rather than NULL; NULL then
-- matches no row, so a missing context reads nothing and writes nothing once RLS is enabled.

-- Extensions (ADR-0019). tools/postgres/init and the test harness create them as the superuser
-- first; postgis is not a trusted extension, so for elx_owner these are no-ops that only assert
-- the extensions are present.
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

-- Hardening (review L-3): nobody but the owner creates objects in public or temporary tables in
-- this database, and functions elx_owner creates are not executable by PUBLIC unless granted.
-- Every function below pins its search_path, so an object planted earlier on the path cannot
-- shadow what it calls.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
END $$;
--> statement-breakpoint
-- Without IN SCHEMA on purpose: the PUBLIC EXECUTE default is global, and a per-schema entry can
-- only add privileges, never take a global one away (PostgreSQL ALTER DEFAULT PRIVILEGES notes).
ALTER DEFAULT PRIVILEGES FOR ROLE elx_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint

-- UUIDv7 for SQL-side inserts (seeds, backfills); the API generates its own ids (data §1.3).
-- 48-bit Unix milliseconds over a random v4, with the version bits turned from 4 to 7.
CREATE FUNCTION core_uuidv7() RETURNS uuid LANGUAGE sql VOLATILE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
              PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
              FROM 1 FOR 6),
      52, 1), 53, 1),
    'hex')::uuid
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION core_uuidv7() TO elx_app, elx_platform;
--> statement-breakpoint

-- Append-only trigger function, as data §3.1 (body verbatim; the search_path line is review L-3).
CREATE FUNCTION core_reject_mutation() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  -- The per-account deletion tool (section 10) is the one exception.
  IF TG_OP = 'DELETE' AND current_user = 'elx_maintenance'
     AND current_setting('elx.purge_account', true) = OLD.account_id::text THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% on % is forbidden: append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'EL001';
END $$;
--> statement-breakpoint

-- Outbox envelope immutability, as data §3.1 (body verbatim; search_path per review L-3);
-- attached to core_outbox by PLAT-8.
CREATE FUNCTION core_outbox_envelope_immutable() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF (NEW.id, NEW.type, NEW.event_version, NEW.occurred_at, NEW.account_id,
      NEW.aggregate_type, NEW.aggregate_id, NEW.sequence, NEW.causation_id,
      NEW.correlation_id, NEW.payload, NEW.kind)
     IS DISTINCT FROM
     (OLD.id, OLD.type, OLD.event_version, OLD.occurred_at, OLD.account_id,
      OLD.aggregate_type, OLD.aggregate_id, OLD.sequence, OLD.causation_id,
      OLD.correlation_id, OLD.payload, OLD.kind) THEN
    RAISE EXCEPTION 'core_outbox envelope is immutable' USING ERRCODE = 'EL001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

-- The ledger and append-only grant script (data §3.1, §3.2; ADR-0031). Applied migrations are
-- immutable, so "later orders extend the list" means: a migration that creates an append-only
-- table calls, in that same migration,
--   SELECT core_make_append_only('<table>');
-- and adds the table to `appendOnlyTables` in apps/api/test/schema/exemptions.ts, which the schema
-- test checks (triggers present, no UPDATE, DELETE or TRUNCATE for the runtime roles).
-- Ledger tables today: none. Only elx_owner (the migration job) can run it.
CREATE FUNCTION core_make_append_only(target regclass) RETURNS void LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  name text := (SELECT relname FROM pg_class WHERE oid = target);
BEGIN
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s FROM elx_app, elx_platform', target);
  EXECUTE format('GRANT SELECT, INSERT ON %s TO elx_app, elx_platform', target);
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION core_reject_mutation()',
    name || '_append_only', target);
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION core_reject_mutation()',
    name || '_no_truncate', target);
END $$;
--> statement-breakpoint
-- Already not executable by PUBLIC through the default privileges above; stated for the reader.
REVOKE EXECUTE ON FUNCTION core_make_append_only(regclass) FROM PUBLIC;
--> statement-breakpoint

-- Role grants (data §3.2, §4.4). The runtime roles use the public schema and get DML on every
-- table elx_owner creates from here on; append-only tables lose UPDATE and DELETE through
-- core_make_append_only. No role but elx_owner gets TRUNCATE, REFERENCES or TRIGGER.
-- elx_maintenance gets its SELECT and DELETE with its tool (wave 1 data order), not here.
GRANT USAGE ON SCHEMA public TO elx_app, elx_platform;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE elx_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO elx_app, elx_platform;
--> statement-breakpoint

-- core_schema_meta (0000) predates the default privileges: the runtime roles read it, for /ready,
-- and only the migration job writes it.
GRANT SELECT ON core_schema_meta TO elx_app, elx_platform;
