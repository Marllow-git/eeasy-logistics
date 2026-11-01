-- reviewed: PLAT-5 item C, 2026-11-01; review fix M-3 the same day. Hand-written (custom migration).
--
-- The RLS policy template of data §4.3 (ADR-0025, proposed ADR-0031). Every operational table
-- (one with account_id) gets the all-commands pair below in the migration that creates it:
--
--   CREATE POLICY tenant_isolation ON <table> TO elx_app
--     USING (account_id = NULLIF(current_setting('elx.account_id', true), '')::uuid)
--     WITH CHECK (account_id = NULLIF(current_setting('elx.account_id', true), '')::uuid);
--   CREATE POLICY platform_access ON <table> TO elx_platform USING (true) WITH CHECK (true);
--
-- core_accounts differs on purpose (review M-3). It is the tenant itself and a platform table:
-- tenant code may read its own account (key `id`, not account_id) but never insert, change or
-- delete an account; provisioning and suspension are platform work on elx_platform. So elx_app
-- loses INSERT, UPDATE and DELETE (the default privileges of 0001 gave them) and its policy is
-- FOR SELECT only. The schema test requires that no platform table grants elx_app a write.
--
-- Row-level security itself stays DISABLED here (data §4.5). It is enabled only when the migration
-- job runs with ELX_RLS=on (core_enable_tenant_rls, 0004), as the api-test-rls CI lane does, and
-- for every environment by one migration at wave 1 exit. Until then the policies exist and the
-- schema test requires them, but they do not filter.
REVOKE INSERT, UPDATE, DELETE ON core_accounts FROM elx_app;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON core_accounts FOR SELECT TO elx_app
  USING (id = NULLIF(current_setting('elx.account_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY platform_access ON core_accounts TO elx_platform USING (true) WITH CHECK (true);
