-- reviewed: PLAT-5 item D, 2026-11-01; search_path per review L-3. Hand-written (custom migration).
--
-- The RLS switch (PLAT-5 plan 2.6, data §4.5). Policies are created with every table from wave 0;
-- ALTER TABLE … ENABLE ROW LEVEL SECURITY runs only when the migration job runs with ELX_RLS=on
-- (read through packages/config). The job then calls this function after the migrations, on every
-- run, so a table added by a later migration is covered without that migration knowing the flag.
-- It enables RLS on every public table that has a tenant_isolation policy and returns how many it
-- touched. It never disables RLS: with ELX_RLS=off the job does not call it at all, and a database
-- once switched on stays on. ENABLE (not FORCE): elx_owner owns the tables and is not subject to
-- RLS, the runtime roles own nothing and are. The wave 1 exit migration replaces the flag with a
-- plain ENABLE for every operational table.
CREATE FUNCTION core_enable_tenant_rls() RETURNS integer LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  target regclass;
  enabled integer := 0;
BEGIN
  FOR target IN
    SELECT DISTINCT format('%I.%I', schemaname, tablename)::regclass
    FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'tenant_isolation'
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
    enabled := enabled + 1;
  END LOOP;
  RETURN enabled;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION core_enable_tenant_rls() FROM PUBLIC;
