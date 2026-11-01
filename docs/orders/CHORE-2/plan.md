# CHORE-2 · Flaky integration deadlocks

- **Status:** in build 2026-11-01
- **Date:** 2026-11-01
- **Wave:** 0. **Depends on:** nothing open. **Blocks:** nothing; every API order's `api-test` lanes benefit.
- **Lead:** architecture lead. **Executor:** `executor-api` (Opus), own worktree, native stack (owner's PostgreSQL 17 on 5432, Redis on 6379, MinIO on 9000), scratch databases through the PLAT-5 harness. **Adversary:** no (test harness only; no auth, tenancy, ledger, payment or private-data path).
- **Issue:** #71. **Merge danger:** two-way door (test and Vitest config files only; a revert undoes it).
- **Branch:** `chore/flaky-integration-deadlocks` from `main`, one PR.

## 0. Goal

`apps/api` `test:integration` fails now and then with PostgreSQL `deadlock detected` (four times on 2026-11-01 under `ELX_RLS=on`, once with it off; PLAT-14 PR #76 CI run 41331995506 once more), always between `migrate.test.ts` and a file writing `core_outbox` or `core_audit_log`, green on re-run. Make the suite deterministic on that point without weakening a test.

## 1. Binding rules and ADRs

- `AGENTS.md` "Testing" (integration against a real PostgreSQL; never delete or weaken a test) and "Sizing a change".
- Handbook 03 (never a mock database); PLAT-5 plan 2.9 (one scratch database per run, the ci database without `DATABASE_URL_ADMIN`); data §11.7 (the suite never migrates the development database).
- `apps/api/vitest.integration.config.ts`, `test/integration/global-setup.ts`, `test/integration/support.ts`, `test/integration/migrate.test.ts`; `packages/db/src/migrate.ts` (`runMigrations`: advisory lock, then `core_enable_tenant_rls()` and `core_ensure_audit_partitions()` in one transaction) and `packages/db/src/admin.ts` (`recreateDatabase`, `dropDatabase`).
- `.github/workflows/pr.yml` `api-test`: `APP_ENV=ci`, no `DATABASE_URL_ADMIN`; `tools/postgres/init/01-roles.sql`: `elx_owner` is `NOCREATEDB`.
- Vitest 5 docs: projects, `sequence.groupOrder`, root `globalSetup` runs once and its `provide` reaches every project.

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Cause | Vitest runs files in parallel workers on one scratch database. `migrate.test.ts` calls `runMigrations` three times and the audit partition maintenance once on that database: under `ELX_RLS=on` `core_enable_tenant_rls()` runs `ALTER TABLE … ENABLE ROW LEVEL SECURITY` (AccessExclusive) on every tenant table in one transaction, and in both modes the test drops and re-creates `core_audit_log` partitions. Other files' transactions write `core_outbox`, `core_audit_log` and the tenant tables in another order, so the lock graph can close a cycle. |
| 2.2 | Fix, with an admin URL (local, or ci when set) | `migrate.test.ts` creates its own scratch database `elx_test_<hex>` in `beforeAll` from `DATABASE_URL_ADMIN` (`recreateDatabase`), migrates it with `runMigrations` (ELX_RLS respected) and points every client of the file at it; `afterAll` drops it. No migrator, RLS switch or partition DDL then runs on the shared database after global setup. |
| 2.3 | Fix, without an admin URL (ci today) | `elx_owner` cannot create databases, and `pr.yml` is outside this order. The integration config splits into two Vitest projects: `parallel` (every file but the migrator's, `groupOrder` 0) and `migrator` (`migrate.test.ts`, `groupOrder` 1, `fileParallelism: false`), so the migrator file starts only after every other file has finished. The split applies in every mode (one config); with an admin URL it is belt and braces. |
| 2.4 | Other DDL in tests | `append-only`, `unit-of-work`, `rls`, `site-scope.http` and `probe-table.ts` create, alter and drop only their own schema and tables (private schemas, policies not in `public`, so `core_enable_tenant_rls()` never touches them) and take no lock on a shared table: they stay in `parallel`. |
| 2.5 | Scope | `apps/api` test and Vitest config files only; no product code, no workflow change. Release note: none (technical PR). |

## 3. Build list

| Item | Delivers | Verify |
|---|---|---|
| A | Vitest projects per 2.3 | `pnpm exec vitest list` shows `migrate.test.ts` only in `migrator`; suite green |
| B | `migrate.test.ts` on its own scratch database per 2.2; `integrationConfig` takes the database name | before the fix: up to three runs to reproduce (counts recorded); after: five runs `ELX_RLS=on` and five `off` on the native stack, all green with counts; the scratch databases are dropped; one run without `DATABASE_URL_ADMIN` is not possible locally (the harness refuses), so CI is the evidence for 2.3 |

## 4. Commit plan

Plan file first, then one commit per item, `CHORE-2: <letter>, <what>`, each with its §8.0 row. Draft PR `CHORE-2: flaky integration deadlocks`, `Closes #71`, "Release note: none (technical PR)".

## 5. Exit criteria

- No file runs the migrator or `core_enable_tenant_rls()` on the shared database while another file runs.
- Ten consecutive local runs green (five per RLS mode); CI `api-test` and `api-test-rls` green.
- No test deleted or weakened; test count unchanged.

## 6. Not in this order

`pr.yml` (an admin URL in ci), product code, the PLAT-6 flaky `b-1` assertion (CHORE-1 §8.3), test isolation of other kinds (shared rows between files).

## 7. Owner questions

None.

## 8. Executor notes (filled by the executor)

### 8.0 Progress

| Item | Commit | Tests (counts) | Interpretation |
|---|---|---|---|

### 8.1 Skills and documents consulted

### 8.2 Interpretations the lead should check

### 8.3 Not done here

## 9. Lead review
