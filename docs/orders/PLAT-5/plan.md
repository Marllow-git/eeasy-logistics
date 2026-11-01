# PLAT-5 · Database, roles and migrations job

- **Status:** built 2026-11-01 on main at 05ed302 (PLAT-3 and PLAT-4 merged); awaiting adversary review and owner merge
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

Partitions (review M-4): the default privileges, `core_enable_tenant_rls()` and the tenancy schema test cover ordinary tables in `public` and skip partitions (`NOT relispartition`). PLAT-7, which creates the monthly `core_audit_log` partitions, must revoke the runtime roles' grants on every partition (so no one writes a partition directly, around the parent's triggers and policies) and extend the schema test to partitions.

## 7. Owner questions

1. Q-16 default applies: policies from wave 0, RLS enabled at wave 1 exit, one CI lane with RLS on. Confirm or change.

## 8. Executor notes (filled by the executor)

### 8.0 Progress

Native stack: PostgreSQL 17.9 with PostGIS 3.7 on the owner's Mac (CI uses 16), scratch databases created by the local superuser and dropped afterwards; MinIO from a scratch directory on 9000 and Redis on 6390 for the `/ready` checks, both stopped. Commit ids are on `feat/PLAT-5-database-roles-migrations` after the rebase onto `ab02b06`.

| Item | Commit | Tests (counts) and checks | Interpretation |
|---|---|---|---|
| A packages/db pools, unit of work, repository bases | `614156a` | db unit 11/11 against `elx_app` (setting read back inside; `''` in the next transaction, in autocommit and after rollback; insert takes the context account; cross-account read, update, delete return nothing); architecture red on a planted `/platform` + `/testing` import, green after | 8.2.8 (database tests later moved to the api integration suite) |
| B migration runner, `--role migrate`, `core_schema_meta` | `1a29be7` | two concurrent `node dist/main.js --role migrate` on an empty database: one waits on the lock then "Nothing to migrate", the other "Applied 1"; both exit 0. Edited applied file: exit 1 "was edited after it ran". api unit +1 (`--role migrate`) | 8.2.1, 8.2.4, 8.2.10 |
| C first migration set | `86dc745` | migrate from empty: 4 applied; `psql`: extensions citext 1.6, pgcrypto 1.3, postgis 3.7.0; functions owned by `elx_owner`; grants per role, default ACL, both policies, RLS off | 8.2.1, 8.2.2, 8.2.5, 8.2.6 |
| D RLS switch, harness, RLS and append-only tests | `19d2eec` | integration 23/23 with `ELX_RLS=off` and `on`; `psql` after a migrate with `on`: `elx_app` 0 rows without context, 1 with, `elx_platform` 2 | 8.2.3, 8.2.7, 8.2.9 |
| E tenancy schema test | `68418b9` | schema 7/7; red on a planted `del_planted` (no `account_id`, unique index without it): 3 tests fail printing 4 problems; green after removal | 8.2.2, 8.2.5 |
| F `/ready` | `84568fc` | api unit 9/9, integration 33/33; by hand: 200, Redis stopped 503 `["redis"]`, stale version 503 `["migrations"]`, no database variables 503 all four with `/health` 200 | 8.2.11 |
| G seeds, template, native migrate, sample test | `71bea32` | integration 36/36 both flags; `native-stack.sh migrate` twice: "Applied 5", then nothing; seed twice: 2 then 0; `seed --template` then the `stack.sh` clone SQL: `elx_stack_a` at `0004_rls_switch` with 2 accounts | 8.2.12 |
| H README, plan §8, ADR citations | `53c18ed` | root `typecheck lint test` 23/23, `format:check` clean | – |
| fix H-1 bracketed caller condition | `7f5a527` | unit-of-work 8 tests: new `OR true` test red (1 failed, rows from the other account returned), green after the fix | – |
| fix H-2 credentials per role | `e1328a7` | config 79/79 (per-role requirement and refusal tests) | 8.2.14 |
| fix M-3, L-3 platform-table writes, hardening | `012994f` | integration 39/39 both flags; `psql`: `elx_app` EXECUTE false on new functions, true on `core_uuidv7`; trigger fires for `elx_app` without EXECUTE; temp table and `CREATE` in public denied | 8.2.5, 8.2.16 |
| fix L-2 RLS before version, one transaction | `4416ec4` | migrate + RLS tests 11/11 with `ELX_RLS=on` | – |
| fix M-6, L-1, readiness order | `f3d8703` | api unit 12/12 (single-flight, version order); integration 40/40 both flags (app URL as `elx_platform` gives 503 `["database"]`); by hand: Redis stopped 503, restarted 200 without restarting the API | 8.2.17 |
| fix M-2 database driver only in packages/db | `3441a61` | architecture red on planted `postgres` and `drizzle-orm/postgres-js` imports (2 errors), green after | – |
| fix M-5, M-1 lint rules | `a528b74` | lint red on planted files (4 errors in `planted.ts`, 2 in `orders.repository.ts` where `tx` is allowed), green after | 8.2.15 |
| fix L-4 seed out of the image | `c08ea61` | not built locally (no Docker) | 8.2.18 |
| fix M-4 partition gap recorded | `8684c8a` | – (plan §6) | – |
| final | this commit | root `typecheck lint test` 23/23 (api unit 12, db 4, config 79, i18n 8, driver 3), `format:check` clean, integration 40/40 with `ELX_RLS=off` and 40/40 with `on`, two concurrent migrate runs on an empty database (one waits, both exit 0, RLS enabled on 1 table) | – |

### 8.1 Versions and documents consulted

- npm registry, 2026-11-01. Pinned exactly: `drizzle-orm` 0.45.4 and `drizzle-kit` 0.31.11 (latest stable; already in the lockfile from PLAT-1), `postgres` 3.4.9, `ioredis` 6.0.0, `@aws-sdk/client-s3` 3.1161.0. `postgres` 4.0.0 was published 2026-10-29; it was not taken because `drizzle-orm/postgres-js` 0.45.4 is built and tested against 3.x (peer range `>=3` only), and a two-day-old major under the migration job is a risk with no gain. Revisit with the next Drizzle release.
- Context7: `/drizzle-team/drizzle-orm/0.45.4` (postgres-js `migrate()` with `max: 1`, `migrationsFolder`, `migrationsTable`, `migrationsSchema`); `/drizzle-team/drizzle-orm-docs` (`drizzle-kit generate --custom --name`, `drizzle.config.ts`); `/porsager/postgres` (connection options, `sql.begin`, `sql.end({ timeout })`); `/nestjs/docs.nestjs.com` (dynamic modules with `forRoot`, `OnApplicationShutdown`, `enableShutdownHooks`).
- Read in the installed sources rather than taken from the docs: `drizzle-orm/migrator.js` (`readMigrationFiles` hashes each file with SHA-256; the journal `when` is the ordering key) and `pg-core/dialect.js` `migrate()` (all pending files in one transaction, compared only by `created_at`, applied hashes never re-checked). The runner's history check (8.2.4) closes that gap.
- Skills: none specific to NestJS, Drizzle or PostgreSQL exist in this environment. Serena was not used: the files were new or small, and plain edits sufficed.

### 8.2 Interpretations the lead should check

1. **Migration order.** B ships `0000_core_schema_meta` (generated). C ships `0001_foundation` (extensions, `core_uuidv7()`, the two trigger functions verbatim from data §3.1, `core_make_append_only()`, schema usage and default privileges), `0002_core_accounts` (generated) and `0003_core_accounts_policies`. D ships `0004_rls_switch`. `core_schema_meta` predates the default privileges, so 0001 grants it `SELECT` only.
2. **"A grant script that later orders extend."** Applied migrations are immutable (the runner refuses an edited one), so the script is a function. A migration that creates an append-only table calls `SELECT core_make_append_only('<table>')` in the same file (revokes `UPDATE, DELETE, TRUNCATE`, grants `SELECT, INSERT`, creates `<table>_append_only` and `<table>_no_truncate`) and adds the name to `appendOnlyTables` in `test/schema/exemptions.ts`. The schema test checks both triggers and the absence of mutating grants, and fails when a table has the trigger but is not listed.
3. **RLS switch.** `ELX_RLS` (`on|off`, default `off`) is read through `packages/config`. With `on`, the migration job calls `core_enable_tenant_rls()` after every run. It enables RLS on every public table that has a `tenant_isolation` policy, so later tables are covered without their migration knowing the flag. `off` never disables RLS on a database that was switched on. `ENABLE`, not `FORCE`: the owner is not subject to RLS; the runtime roles own nothing and are.
4. **Runner safety beyond the plan.** Before migrating, the runner compares the applied hashes with the files. It refuses an applied migration that was edited or removed, and a new migration dated before the last applied one (Drizzle would silently skip it). Shown red with a tampered file (8.0, B).
5. **`core_accounts` policy key.** `core_accounts` is the tenant, so its policy compares `id`, not `account_id`, and (after review M-3) is `FOR SELECT` with no write grant for `elx_app`; the comment in 0003 shows the all-commands template with `account_id` for every operational table. `core_accounts` and `core_schema_meta` are tenancy exemptions (platform tables); the schema test still requires the two policies on `core_accounts`.
6. **`core_uuidv7()`** is installed by 0001 because data §1.3 says the first migration installs it; the plan did not list it.
7. **`DATABASE_URL_ADMIN`** is new in `packages/config`: a superuser URL to create and drop the scratch test databases and `elx_seed`. Both need `CREATEDB`, which no `elx_` role has, and only a superuser can create `postgis`. It is refused in `staging` and `production` (a new refusal rule with tests) and documented in `.env.example`. Its helpers (`@eeasy-logistics/db/admin`) are limited to `src/seed/` and tests by the architecture test.
8. **Where the database tests live.** The unit-of-work database test began in `packages/db` (item A) and moved to `apps/api/test/integration/` in item D, because the CI lanes run only the api scripts (`migrate`, `test:unit`, `test:integration`, `test:architecture`). `packages/db` keeps database-free tests. Integration and schema tests run only through `vitest.integration.config.ts`; `test:unit`, and so `pnpm turbo run test`, needs no database. `turbo.json` now declares the test task's environment variables and the root `.env` as inputs, because Turborepo's strict mode otherwise hides `APP_ENV` from tests.
9. **Harness modes.** With `DATABASE_URL_ADMIN`, the global setup creates `elx_test_<random>` from `template1`, creates the three extensions as the superuser, migrates it with `ELX_RLS` respected and drops it at the end. Without it, only in `ci`, it uses the configured (already migrated) database. Locally without it, it refuses rather than touch the development database.
10. **CI wiring (PLAT-3 files).** `APP_ENV=ci` never reads `.env`, and the `ci` profile publishes random ports. `pr.yml` therefore exports `DATABASE_URL_*`, `REDIS_URL` and `STORAGE_*` built from `.env`'s local passwords and `docker compose port`, and seeds after migrating (data §11.6). `main.yml`'s image probe starts the `ci` profile's PostgreSQL, runs `--role migrate` twice and asserts the "Applied N migration(s)" and "Nothing to migrate" lines; the "No migrations yet" grep is gone. The api image now copies `apps/api/drizzle/`, which the job and `/ready` read.
11. **`/ready` details.** Four checks named `database`, `migrations`, `redis` and `storage` run in parallel, 2 s each; the 503 body is `{ status: 'not_ready', failing: [...] }`. Without `DATABASE_URL_APP` (allowed outside production) the API still boots: `/health` is 200 and `/ready` names `database` and `migrations`. The web census job and the image probe start the API without a database, so they keep working. Storage uses region `us-east-1` with path-style addressing because the config has no region variable; a provider that needs another region will need one (OPS-1).
12. **Seeds.** Fixtures live in `apps/api/src/seed/fixtures.ts`, not `packages/db/seed/` as data §11.6 says, because they write the kernel's private schema. Seeding runs through the `elx_platform` pool (accounts are platform rows), which the architecture test now allows in `src/seed/`.
13. **`elx_maintenance`** gets no grants in this order (plan 2.3 names only the two runtime roles). It can use the public schema through PostgreSQL's default `PUBLIC` usage but holds no table privilege.
14. **Amendment to PLAT-4 decision 2.3 (review H-2).** Production requirements now depend on `--role`: `api` and `worker` need `DATABASE_URL_APP` and `DATABASE_URL_PLATFORM` (with the rest of PLAT-4's list); `migrate` needs only `DATABASE_URL_OWNER` (no Redis, storage, signing or credentials keys, no messaging decision); no role needs `DATABASE_URL_MAINTENANCE` until the wave 1 deletion tool. In staging and production `api` and `worker` are refused the owner, maintenance and admin URLs, every role the admin URL. PLAT-4's plan text still says "all four database URLs"; this order supersedes that line.
15. **Data §4.2's promised lint rule now exists (review M-1, M-5).** ESLint in `apps/api` forbids `x.tx` and a destructured `{ tx }` outside `*.repository.ts`; the shared config forbids the strings `set_config` and `elx.account_id` outside `packages/db/src`, the database tests and the rule's own file. ADR-0031 (proposed) gained one sentence: RLS defends against a missing predicate, not against tenant code that sets the setting itself. The seed's write moved into `src/seed/fixtures.repository.ts` to satisfy the rule.
16. **Hardening deviations (review L-3).** The data §3.1 trigger functions keep their bodies verbatim but gain `SET search_path = pg_catalog, public, pg_temp`. The default-privilege revoke is written `ALTER DEFAULT PRIVILEGES FOR ROLE elx_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` without `IN SCHEMA public`, unlike the review's wording: a per-schema entry cannot remove the global PUBLIC grant (checked: with `IN SCHEMA` a new function stayed executable by `elx_app`; without it, not). Triggers still fire for `elx_app` without `EXECUTE` on their function (checked). Runtime roles can no longer create temporary tables, so tests use a throwaway schema.
17. **Readiness (review M-6, L-1, rolling deploys).** The `database` check asserts the pool logs in as `elx_app` and that the role has neither `rolsuper` nor `rolbypassrls`; the seed checks its `elx_platform` pool the same way (the platform pool has no runtime user yet). Checks run single-flight with a 2 s cached result; one Redis client (background reconnect) and one S3 client are reused. The `migrations` check passes at or beyond the build's version by the tag's numeric prefix.
18. **Residual risk (review L-4).** The image no longer carries `dist/seed`, but `packages/db/src/admin.ts` still ships in the image's workspace source; the API never imports it, and without `DATABASE_URL_ADMIN` (refused in staging and production) it cannot connect anywhere.

### 8.3 Not done here

- `tools/stack.sh clone` itself needs Docker; its SQL was run through `psql` against the native server instead.
- The CI changes in `pr.yml` and `main.yml` (exported variables, seed step, image probe) were not run; the first PR run proves them.
- PostgreSQL 16 (CI, production) versus 17.9 here: nothing used is specific to 17, but only CI shows it.
- `tools/native-stack.sh up` was not run: the developer's server already held `elx` and the four roles from an earlier run, and `up` refuses an `elx` it did not create. All checks used scratch databases, dropped afterwards.
- The `elx_platform` pool's role check runs in the seed only; no runtime code builds that pool yet (PLAT-6 or the platform module will).

## 9. Lead review and adversary
