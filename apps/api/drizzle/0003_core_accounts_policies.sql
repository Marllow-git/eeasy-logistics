-- reviewed: PLAT-5 item C, 2026-11-01. Hand-written (custom migration).
--
-- The RLS policy template of data §4.3 (ADR-0025, proposed ADR-0031), on core_accounts first so
-- every later table copies it. core_accounts is the tenant itself, so its key is `id`; every
-- operational table uses `account_id` in the same expressions:
--
--   CREATE POLICY tenant_isolation ON <table> TO elx_app
--     USING (account_id = NULLIF(current_setting('elx.account_id', true), '')::uuid)
--     WITH CHECK (account_id = NULLIF(current_setting('elx.account_id', true), '')::uuid);
--   CREATE POLICY platform_access ON <table> TO elx_platform USING (true) WITH CHECK (true);
--
-- Row-level security itself stays DISABLED here (data §4.5). It is enabled only when the migration
-- job runs with ELX_RLS=on (core_enable_tenant_rls, 0004), as the api-test-rls CI lane does, and
-- for every environment by one migration at wave 1 exit. Until then the policies exist and the
-- schema test requires them, but they do not filter.
CREATE POLICY tenant_isolation ON core_accounts TO elx_app
  USING (id = NULLIF(current_setting('elx.account_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('elx.account_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY platform_access ON core_accounts TO elx_platform USING (true) WITH CHECK (true);
