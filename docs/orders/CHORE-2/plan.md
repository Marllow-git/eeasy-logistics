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
| A | 192e56d | `vitest list --filesOnly`: 27 files in `parallel`, 1 (`migrate.test.ts`) in `migrator`; suite `ELX_RLS=on` 255/255 in 28 files, `off` 255/255; a verbose run lists `migrate.test.ts` last, after every `parallel` file | Root `globalSetup` kept at root (runs once; Vitest 5 does not inherit it into projects, and its `provide` reaches both); `include` moves into the projects |
| B | 6d0f6ed | **Before (on `main`'s config and test), four runs:** `ELX_RLS=on` run 1 255/255; run 2 1 failed / 254 (`outbox-platform.http.test.ts` "with account_id: that account only…" got 500 instead of 200); run 3 3 failed / 252 with `deadlock detected` (`migrate.test.ts` "is idempotent and serialises concurrent runs" and "keeps the current month and the next three audit partitions", `outbox-writer.test.ts` "supersedes the pending row…": `insert into core_outbox` waiting for AccessExclusiveLock); `ELX_RLS=off` run 4 255/255. **Red then green** for the new case "runs on a database of its own, never on the one the other files share" (`migrate.test.ts` only, `ELX_RLS=on`): with the `beforeAll` scratch database switched off 1 failed / 8 (`expected 'elx_test_c9125b96e21e' not to be 'elx_test_c9125b96e21e'`), with it 9/9. **After (A and B), ten full runs:** `ELX_RLS=on` 5 of 5 green, 256/256 in 28 files each (6–7 s); `ELX_RLS=off` 5 of 5 green, 256/256 each (6 s); no `elx_test_*` database left. **CI mode locally** (`APP_ENV=ci`, no `DATABASE_URL_ADMIN`, URLs on a pre-created `elx_chore2` migrated by `pnpm run migrate` first, as `pr.yml` does): `on` 255 passed, 1 skipped (the new case, by design); `off` the same; `elx_chore2` dropped. Unit 279/279 in 30 files, `test:architecture` clean, `typecheck`, `lint`, `prettier --check` clean | `integrationConfig(overrides, database)` takes the database (default: the harness's). The new case runs only with an admin URL (`it.skipIf`): without one the file uses the shared database by design (2.3) |

| CI | (evidence) | Before the fix, from the coordinator: PLAT-14 PR #76, run 41331995506, job `api-test-rls`: `migrate.test.ts` "keeps the current month and the next three audit partitions" failed with `deadlock detected` in `PL/pgSQL function core_enable_tenant_rls() line 11 at EXECUTE` (the `ALTER TABLE … ENABLE ROW LEVEL SECURITY`), 258/259 otherwise. After: this PR's `api-test` and `api-test-rls` checks | The CI trace names the RLS switch as one side of the cycle, as 2.1 says |

### 8.1 Skills and documents consulted

All on 2026-11-01.

- **Vitest 5.0.5** (installed; Context7 `/vitest-dev/vitest/v5.0.3`, the nearest indexed version): `docs/guide/recipes/parallel-sequential.md` ("Run sequential after parallel", `sequence.groupOrder`, `fileParallelism: false`), `docs/guide/projects.md` (`extends` default true since 5.0; root `globalSetup` runs once and is not inherited by projects), `docs/api/advanced/vitest.md` and `test-project.md` (`provide`: every project inherits the root project's values).
- **PostgreSQL 17** (owner's Homebrew server, 5432): no doc fetched; lock facts used are `ALTER TABLE … ENABLE ROW LEVEL SECURITY` taking AccessExclusive (the CI and local traces show it) and partition DDL locking the parent.
- **Documents (plan §1):** `apps/api/vitest.integration.config.ts`, `test/integration/global-setup.ts`, `support.ts`, `migrate.test.ts`; `packages/db/src/migrate.ts`, `packages/db/src/admin.ts`; `apps/api/drizzle/0004_rls_switch.sql` (`core_enable_tenant_rls`), `0006_core_audit_log.sql` (`core_ensure_audit_partitions`, `core_drop_audit_partitions_before`); `.github/workflows/pr.yml` `api-test` env; `tools/postgres/init/01-roles.sql`; issue #71; CHORE-1 plan for the shape; memories `suggested_commands`, `memory_upkeep`, `api/core`.
- **Stack:** Node 24.22.2 (`/opt/homebrew/opt/node@24/bin`), pnpm 10.34.9, Redis 6379 (owner's), MinIO on 9000 (already running, not started or stopped by this order); `.env` copied from `.env.example` into the worktree (gitignored) because `APP_ENV=local` reads it; `pnpm --filter @eeasy-logistics/contracts run build` once (the suite imports `generated/`).

### 8.2 Interpretations the lead should check

1. **Two mechanisms, not one (2.2 and 2.3).** The brief's first rung (own scratch database) is impossible in CI as it stands: `pr.yml` sets no `DATABASE_URL_ADMIN` and `elx_owner` is `NOCREATEDB`, and both are outside this order. So the `migrator` project carries CI, and the own database keeps every local and admin-URL run from touching the shared database at all after global setup. In CI the migrator, `core_enable_tenant_rls()` and the partition DDL still run on the ci database, but only after every other file has finished, which removes the concurrency the deadlock needs. If the lead wants the stricter "never on the shared database" in CI too, the follow-up is an admin URL in `pr.yml` `api-test` (the Compose superuser), after which `migrate.test.ts` takes the scratch path unchanged.
2. **The `outbox-platform.http.test.ts` 500 (before, run 2).** No `deadlock detected` reached the log (the API's error filter answers 500 and the test logs nothing), so I attribute it to the same collision by elimination: that route writes `core_audit_log` and reads `core_outbox` while `migrate.test.ts` drops and re-creates audit partitions and re-runs the RLS switch. It has not recurred in the ten runs after the fix.
3. **One added test (255 → 256).** "Runs on a database of its own" pins the isolation so a later edit cannot quietly put the migrator back on the shared database; it is skipped without an admin URL (CI shows 255 passed, 1 skipped). No test was removed or changed in substance: the two `describe`-level `const config = integrationConfig()` became one module-level `config` the `beforeAll` repoints.
4. **Other DDL left in `parallel` (2.4).** `append-only`, `unit-of-work`, `rls`, `site-scope.http` and `probe-table.ts` touch only their own throwaway schemas; none appeared in any deadlock trace.

### 8.3 Not done here

- `pr.yml` admin URL for CI (8.2 item 1): outside "apps/api test and config files only".
- CI mode without an admin URL was checked locally once per RLS mode (8.0 row B), not five times; CI on this PR is the authority for it.
- The PLAT-6 `b-1` flaky assertion (CHORE-1 §8.3) and the PLAT-8 clock-bound flake named in #71 are other causes, not touched.
- Memories: `api/core` "Audit test traps" bullet gains the `migrator` project rule; `task_completion` and `suggested_commands` unchanged (no script or command changed).

## 9. Lead review
