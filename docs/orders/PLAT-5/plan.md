# PLAT-5 · Database, roles and migrations job

- **Status:** planned (starts after PLAT-4 merges; rebase this branch onto main then)
- **Date:** 2026-10-31
- **Wave:** 0 (roadmap §1.1). **Depends on:** PLAT-2 (merged, PR #25), PLAT-4 (config module).
- **Lead:** architecture lead. **Executor:** Opus, own worktree. **Adversary:** yes (roles, RLS policies, append-only triggers, tenancy schema test).
- **Local verification:** the native stack (`tools/native-stack.sh`, PostgreSQL 17 locally); the Compose `ci` profile (PostgreSQL 16) in CI once PLAT-3 lands.

## 0. Goal

The API can connect with the right role for its duty, migrate from zero with reviewed SQL, answer `/ready`, and prove in CI that every operational table is tenant-scoped, that ledgers are append-only, and that row-level-security policies exist from the first table, so that every later order adds tables inside a frame that is already enforced.

## 1. Binding rules and ADRs

- ADR-0019 (PostgreSQL 16 + PostGIS), ADR-0020 (Drizzle, SQL migrations), ADR-0025 (tenancy by `account_id`, structural), ADR-0031 proposed (four roles; ledger single writer in the application; no `SECURITY DEFINER` ledger writers), ADR-0026 (schema files per context).
- Data architecture §1 (principles, schema file layout under `apps/api/src/modules/<ctx>/schema/`, `packages/db` helpers, column conventions, UUIDv7), §2.4 (tenancy exemption list), §3.1 (append-only trigger function and `core_outbox` envelope trigger; `BEFORE TRUNCATE`), §3.2 (privileges per role), §4.1 (schema test rules), §4.2 (unit of work, `elx.account_id` transaction-local setting, repository base predicate, `unscoped()` only on platform repositories), §4.3 (RLS policy template, `NULLIF`), §4.4 (roles and pools), §4.5 (RLS stays off until wave 1 exit; one CI lane with `ELX_RLS=on`), §7 (sequences), §11 (migration workflow: expand and contract, one-shot job, seeds, clone per stack).
- Platform blueprint §5 (`/health`, `/ready`: database, Redis, storage reachable; migrations at expected version; one-shot migration job before the API starts; expand and contract; merge danger one-way door for any migration PR).
- Identity and tenancy §5 (request context in `AsyncLocalStorage`, `@CrossTenant()`, background jobs carry `account_id`).
- PLAT-4: all connection settings come from `packages/config` (`DATABASE_URL_*`, pool sizes); no other environment reads.
- Handbook 02 "Schema change": migrations are reviewed SQL; destructive steps in a separate PR; ledger triggers kept; merge danger one-way door.

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Driver and pools | `postgres` (porsager) through Drizzle's `drizzle-orm/postgres-js`; two pools in `packages/db`: `appPool` (`elx_app`) and `platformPool` (`elx_platform`); the migrate role uses `elx_owner` only inside the migration job; `elx_maintenance` has no pool in this order |
| 2.2 | Migrations | `drizzle-kit generate` produces SQL under `apps/api/drizzle/`; every generated file is reviewed and may be hand-edited; hand-written SQL (triggers, policies, roles grants, extensions) lives in numbered `.sql` files in the same folder with a `-- reviewed` header; `pnpm --filter api migrate` runs them in order with Drizzle's migrator under an advisory lock (`pg_advisory_lock(hashtext('elx_migrate'))`); the job is `api --role migrate` (extend `parseRole`), exit 0 on nothing to do |
| 2.3 | First migration set | extensions `postgis`, `citext`, `pgcrypto`; the shared trigger functions `core_reject_mutation()` and `core_outbox_envelope_immutable()` exactly as data §3.1; the `elx.account_id` setting convention documented in SQL comments; role grants: `elx_app` and `elx_platform` get `USAGE` on the schema and default privileges for `SELECT, INSERT, UPDATE, DELETE` on operational tables and `SELECT, INSERT` on ledger tables (ledger tables listed by name in a grant script that later orders extend); no table yet except `core_accounts` (minimal: `id`, `name`, `status`, `created_at`, `updated_at`) and `core_schema_meta` (expected migration version for `/ready`), so the tenancy test has one table to pass and one exemption to list; `core_accounts` gets its `tenant_isolation` and `platform_access` policies as the template for every later table, with RLS disabled |
| 2.4 | Tenancy schema test | `apps/api/test/schema/tenancy.test.ts` against the real database after migrations: every `core_`, `del_`, `wms_`, `rpt_` table not in `apps/api/test/schema/exemptions.ts` has `account_id uuid NOT NULL` with an FK to `core_accounts` and an index led by it; unique indexes include `account_id` unless listed as global; every operational table has a `tenant_isolation` policy; every append-only table (a list in the same file, empty except nothing yet) has both triggers; the test fails on any mismatch and prints the table |
| 2.5 | Unit of work and context | `packages/db`: `withUnitOfWork(ctx, fn)` opens a transaction on the right pool, runs `SELECT set_config('elx.account_id', $1, true)` first, exposes a Drizzle `tx`; `RequestContext` type (account id, membership id, user id, device id, acting cross-tenant flag) in `AsyncLocalStorage` with `getContext()`; a `ScopedRepository` base that adds the `account_id` predicate to reads and writes and sets it on inserts; `unscoped()` exists only on a `PlatformRepository` base and the ADR-0026 architecture test forbids importing it outside `modules/kernel/platform/` and worker system jobs; the NestJS guard that fills the context from a token is PLAT-6's: this order ships a test-only context setter |
| 2.6 | RLS switch | policies are created with every table from this order; `ALTER TABLE … ENABLE ROW LEVEL SECURITY` runs only when `ELX_RLS=on` at migration time (a flag read through `packages/config`, default `off`), so the `api-test-rls` lane enables it from the first table and the normal lane does not (data §4.5) |
| 2.7 | `/ready` | checks the app pool (`SELECT 1` as `elx_app`), Redis `PING`, storage `HeadBucket`, and that `core_schema_meta.version` equals the version the binary was built with; returns 503 with the failing check name, never a detail |
| 2.8 | Seeds and clones | `pnpm --filter api seed` writes deterministic fixtures (two accounts, nothing else yet) into the `ci` or native database; `elx_seed` template creation for `tools/stack.sh clone` is `pnpm --filter api seed --template` (creates `elx_seed` from a fresh migrate plus seed); the clone script from PLAT-2 then works |
| 2.9 | Integration test harness | Vitest `apps/api/test/integration/` with a `setup` that migrates a scratch database per run (`elx_test_<random>` created from `template1` on the native stack, or the `ci` database) and drops it after; `ELX_RLS` respected; `handbook 03`: never a mock database |
| 2.10 | Health of the migration job in Compose and native | `tools/native-stack.sh` gains `migrate` (runs the job against the native database); the Compose `api` image is PLAT-3's; CI runs `pnpm --filter api migrate` before the suites (PLAT-3 placeholder replaced) |

## 3. Build list

| Item | Delivers | Verify |
|---|---|---|
| A | `packages/db`: pools from config, `withUnitOfWork`, `RequestContext`, `ScopedRepository`, `PlatformRepository`, UUIDv7 helper | unit tests with the native database: setting is transaction-local (two sequential transactions on one connection do not leak), predicate added, insert sets `account_id` |
| B | Migration runner, `--role migrate`, advisory lock, `core_schema_meta` | two concurrent `migrate` runs: one waits, both exit 0; version recorded |
| C | First migration set per 2.3 (extensions, trigger functions, grants, `core_accounts` with policies) | `psql` shows extensions, functions, grants per role, policies present and RLS disabled |
| D | RLS switch per 2.6 and the `ELX_RLS=on` path | with the flag: RLS enabled; `elx_app` without context reads zero rows; with context reads its own rows; `elx_platform` reads all; the append-only trigger rejects `UPDATE`, `DELETE`, `TRUNCATE` on a scratch ledger table created in the test with SQLSTATE `EL001` |
| E | Tenancy schema test per 2.4 with exemptions file | red on a planted table without `account_id` (shown), green after |
| F | `/ready` per 2.7 | 200 with everything up; 503 naming the check when Redis is stopped |
| G | Seeds, `elx_seed` template, native `migrate`, integration harness per 2.8 and 2.9 | `tools/stack.sh clone a` works against the template; a sample integration test runs on a scratch database and cleans up |
| H | ADR-0031 cited in code comments; plan §8 with versions and skills consulted; README "Database" section | – |

## 4. Commit plan

One commit per item `PLAT-5: <item>`; the migration SQL files are in C and D with the `-- reviewed` header.

## 5. Exit criteria

- `pnpm --filter api migrate` from an empty database succeeds and is idempotent; concurrent runs serialise.
- The tenancy schema test, the trigger test, the RLS test (both flag states) and the unit-of-work tests are green on the native stack locally and in both CI lanes.
- `/ready` behaves per 2.7.
- No `process.env` read anywhere (PLAT-4 rules stay green); no connection string outside `packages/config`.
- The adversary pass finds no critical or high.

## 6. Not in this order

The request guard and token resolution (PLAT-6), audit log (PLAT-7), outbox tables (PLAT-8), any Delivery or WMS table, the maintenance role pool and the deletion tool (wave 1 data order), partitioning, backups, PostgreSQL 16 locally (ADR-0019 governs CI and production; local is 17 by the owner's no-Docker ruling).

## 7. Owner questions

1. Q-16 default applies: policies from wave 0, RLS enabled at wave 1 exit, one CI lane with RLS on. Confirm or change.
