# CHORE-3 · Timestamp migration names and parallel-order migrations

- **Status:** registered 2026-11-02; brief at once.
- **Date:** 2026-11-02
- **Wave:** 0 (tooling). **Depends on:** nothing open. **Blocks:** nothing; every order with a migration benefits.
- **Lead:** architecture lead. **Executor:** `executor-api` (Opus), own worktree, native stack scratch databases. **Adversary:** no (tooling and the runner; no auth, tenancy, ledger or private-data path).
- **Issue:** #112. **Merge danger:** two-way door (drizzle-kit config, the runner in `packages/db`, tests, docs; existing migration files keep their names and hashes). Blast radius: every future migration's file name; a runner bug would stop `migrate` in CI, caught by `migrate.test.ts` and the lanes.
- **Branch:** `chore/timestamp-migrations` from `main`, one PR.
- **Paths:** `apps/api/drizzle.config.ts`, `packages/db/src/migrate.ts` and its tests, `apps/api/test/integration/migrate.test.ts`, `docs/architecture/data.md` §11, `.serena/memories/task_completion.md` or `api/core.md` (the migration procedure), `.claude/agents/executor-api.md` (the migration-number sentence). In flight beside PLAT-13 (migration 0016 on its branch), INT-2 (0017), DEL-4 (0016 or later): none of them touches these files; their branches keep index-named files, which the runner accepts beside timestamp-named ones.

## 0. Goal

Two orders that each add a migration never collide on a file name and never force each other to regenerate because one merged first: new migrations carry a timestamp prefix, the runner applies every unapplied journal entry in journal order whatever its age, and the one remaining hazard of parallel drizzle-kit migrations, a forked snapshot chain after a merge, has a written procedure and a test that proves the runner's behaviour, so that the three-way collision of 2026-11-02 (0016 taken by PLAT-13, INT-2 and DEL-4) cannot repeat.

## 1. Binding rules and ADRs

- AGENTS.md "Testing" (behaviour changes ship with a test that fails without the fix; never weaken a test) and "Sizing a change". ADR-0020 (Drizzle with reviewed SQL migrations; `drizzle-kit generate` only; the API's own runner applies them).
- `docs/architecture/data.md` §11 "Migration workflow" (the `-- reviewed` header, hand-edited SQL, the runner's refusals: an applied file edited or removed, a file older than the last applied one "because Drizzle would skip it silently").
- `packages/db/src/migrate.ts` (`runMigrations`: the advisory lock, `checkHistory`, `drizzle.__drizzle_migrations` by hash and `created_at` = the journal's `when`), `apps/api/drizzle/meta/_journal.json` (entries with `idx`, `when`, `tag`), `apps/api/src/migrate/run.ts`; drizzle-kit 0.31.11 `defineConfig` `migrations.prefix` (`index`, `timestamp`, `supabase`, `unix`, `none`; `index.d.mts` line 126).
- The executors' practice recorded in PLAT-11 to DEL-4 plans: "regenerate rather than rename; the runner refuses a back-dated file"; INT-4 8.2 #2, PLAT-13 8.2 #1, INT-2 8.2 #1.

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Prefix | `apps/api/drizzle.config.ts` gains `migrations: { prefix: 'timestamp' }`; new files are `YYYYMMDDHHmmss_<slug>.sql` with matching snapshot names; the existing `0000` to `0015` files, their snapshots and journal entries are untouched (their hashes must not change: `migrate.test.ts` proves a database migrated at main stays "nothing to migrate") |
| 2.2 | Runner | `checkHistory` keeps the two refusals that protect history (an applied file edited or removed) and drops the third: an unapplied file whose `when` is older than the last applied one is applied, in journal order, with one log line naming it (`migration <tag> is older than the last applied one; applying in journal order`); the runner applies by the journal's order and never by file name; drizzle's own `migrate()` is not used for the apply step if it would skip such a file (the executor checks `drizzle-orm/postgres-js/migrator`'s behaviour on the pin and, if it skips, applies the SQL files itself with the same `__drizzle_migrations` bookkeeping: `hash` = SHA-256 of the file as drizzle computes it, `created_at` = the journal `when`); a test plants a journal with an entry older than the last applied one and proves it is applied once and recorded |
| 2.3 | Forked snapshot chain | After a merge of two branches that each generated a migration from the same base, the last snapshot in journal order does not contain the other branch's schema, so the next `drizzle-kit generate` would emit it again. Procedure (data.md §11, the memory, the executor sentence): the branch that merges second rebases and runs `drizzle-kit generate` once; if it emits a migration that only repeats what main already holds, it deletes that SQL file and its journal entry and keeps the generated snapshot as the chain's head (the snapshot must equal the merged schema); `migrate.test.ts` on a fresh database and the tenancy schema test prove the result; the lead's "regenerate rather than rename" rule stays for the executor's own migration when its base moved |
| 2.4 | Journal merges | `apps/api/drizzle/meta/_journal.json` keeps conflicting on parallel merges (both append); the procedure says: keep both entries, ordered by `when`, renumber `idx` to be consecutive, and run `migrate` twice on a scratch database; no git merge driver (a union merge breaks the JSON) |
| 2.5 | Tests | `packages/db` unit: `checkHistory` with the older-unapplied case now admitted, the edited and removed cases still refused; `apps/api` integration `migrate.test.ts`: a scratch database migrated at main, then a planted timestamp-named migration appended to a copy of the folder and journal, applied once, "nothing to migrate" on the second run; `drizzle-kit generate` with the new prefix on an unchanged schema produces nothing (so the config change is inert on main) |
| 2.6 | Documents | data.md §11 gains the prefix, the runner rule and the two procedures (2.3, 2.4) as A-26; the executor memory's migration sentence and `.claude/agents/executor-api.md`'s "migration number" wording change to "the next migration is timestamp-named; regenerate on rebase only when drizzle-kit emits a duplicate (plan CHORE-3 2.3)" |

## 3. Build list

| Item | Delivers | Verify |
|---|---|---|
| A | The prefix (2.1), the runner change with its unit tests (2.2), the integration test (2.5) | both RLS lanes; `migrate` twice on a scratch database |
| B | data.md §11, the memory, the executor sentence (2.6); plan §8; PR | the gate |

## 4. Commit plan

Two commits `CHORE-3: A …`, `CHORE-3: B …`; PR from the template with `Release note: none (tooling)` and the `Memories:` line.

## 5. Exit criteria

- A new migration on `main` is timestamp-named and applies; the existing sixteen stay byte-identical and already-applied databases report nothing to migrate.
- An unapplied migration older than the last applied one is applied in journal order and recorded.
- The forked-chain and journal-merge procedures are written where executors read them.

## 6. Not in this order

A git merge driver for the journal; moving away from drizzle-kit's snapshot chain; renaming existing files.

## 7. Owner questions

None (the owner ruled timestamp names on 2026-11-02).

## 8. Executor notes (filled by the executor)

### 8.0 Counts

| Item | Commit | Tests (red, then green) | Interpretation |
|---|---|---|---|
| A | `39e5e5d` `CHORE-3: A, timestamp prefix and the runner applies older entries in journal order` | `packages/db` unit `test/migrate-history.test.ts` against main's `checkHistory` (only `export` added): 4 failed, 2 passed; green: `packages/db` 4 files, 19 passed, depcruise clean. `apps/api` integration `migrate.test.ts` + `test/schema/tenancy.test.ts` against main's runner: 1 failed (the older-entry case: "Migration 20261102091756_early is older than the last applied one; regenerate it"), 25 passed; green: 26 passed with `ELX_RLS=off` and 26 passed with `ELX_RLS=on`. `test/integration-projects.test.ts` 4 passed. A scratch database migrated by main's runner (`Applied 16 migration(s)`) then reports `Nothing to migrate; the database is at 0015_core_push_tickets.` twice under the new runner; a fresh one migrated by the new runner applies 16, then nothing; the 16 `drizzle.__drizzle_migrations` rows (id, hash, created_at) of the two databases are identical. `drizzle-kit generate` with the prefix on the unchanged schema: "No schema changes, nothing to migrate", no file written. `turbo typecheck lint` for db and api: 8 of 8 tasks; `format:check` clean | 8.2 #1 to #3 |
| B | `CHORE-3: B, data §11.9, memories, executor sentence, plan §8` | Docs, memories and the agent file only. A forked-chain simulation with drizzle-kit 0.31.11 in a scratch copy of `apps/api/drizzle` (orders X and Y each generate one migration from `0015`, X merges first, Y rebases with both journal entries ordered by `when`): `generate` on the merged folder aborts with "… are pointing to a parent snapshot … which is a collision"; the documented repair (Y's snapshot `prevId` set to X's `id`, `generate` once) writes one migration that only repeats `CREATE TABLE chore3_x`, which is deleted with its journal entry, and the next `generate` says "No schema changes, nothing to migrate"; the alternative (delete Y's SQL, snapshot and entry, regenerate) writes only `CREATE TABLE chore3_y`, then nothing. `format:check` clean | 8.1 #1 to #3 |

### 8.1 Deviations

1. **2.3 needs one step more.** drizzle-kit 0.31.11 (`bin.cjs` `prepareMigrationFolder`, `validateWithReport`) refuses to generate while two snapshots name the same `prevId`, so after a parallel merge `generate` never gets as far as emitting the duplicate the plan expects. The written procedure (data §11.9, `api/core` memory) first points the second order's first snapshot at main's newest snapshot `id`, then runs 2.3 as decided; it also names the plain alternative for a migration without hand edits (delete own SQL, snapshot and entry, regenerate). Both paths were simulated (8.0 B).
2. **Amendment label.** 2.6 says A-26, but the roadmap's A-26 is PLAT-11's (`core_auth_challenges`). data §11.9 is labelled A-27; the roadmap row is the lead's to add.
3. **Executor sentence.** `.claude/agents/executor-api.md` held no "migration number" wording to change, so one sentence was added to its Testing section. It points to data §11.9 instead of "regenerate on rebase only when drizzle-kit emits a duplicate", because in the procedure that duplicate is deleted, not regenerated.

Documents and sources consulted (2026-11-02): Context7 `/drizzle-team/drizzle-orm-docs` (drizzle-kit `migrations.prefix`: `index`, `timestamp` = `supabase` → `YYYYMMDDHHmmss_name.sql`, `unix`, `none`); on the pins: drizzle-orm 0.45.4 `pg-core/dialect.js` `migrate`, `migrator.js` `readMigrationFiles`, `postgres-js/session.js`; drizzle-kit 0.31.11 `index.d.mts` line 126 and `bin.cjs` (`prepareMigrationMetadata`, the journal and snapshot writer, `prepareOutFolder` sorting snapshots by file name, the `prevId` collision check); postgres 3.4.9 `unsafe()`; data §11; ADR-0020.

### 8.2 Notes

1. **Migrator investigation (2.2).** drizzle-orm 0.45.4 `PgDialect.migrate` reads the newest row (`order by created_at desc limit 1`) and applies a journal entry only when `created_at < folderMillis`: an unapplied entry older than the last applied one is skipped silently. So the runner no longer calls `migrate()`; it applies the entries itself the way Drizzle does: the same `CREATE SCHEMA` / `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations` DDL, every pending file in one transaction, each `--> statement-breakpoint` part sent with `tx.unsafe(part)` (Drizzle's postgres-js session also calls `client.unsafe(query, [])`, the simple protocol when there are no parameters), then the row `(hash, created_at)` from `readMigrationFiles` (SHA-256 of the file, the journal `when`). The 16 rows of a database migrated by each runner are identical (8.0 A).
2. **Identity of an applied migration.** As in Drizzle, a row is matched to its file by `created_at` = journal `when`, so two journal entries with the same `when` would make one look applied when it is not. `checkHistory` refuses that (a fourth refusal, not in 2.2). With millisecond `when`s from two machines it should never fire.
3. **The integration test on the shared ci database.** ci has no `DATABASE_URL_ADMIN`, so `migrate.test.ts` runs on the migrated ci database (last, project `migrator`). The planted migrations live in a temp copy of the folder and create only throwaway schemas `chore3_<slug>_<hex>`. `afterAll` deletes their bookkeeping rows and schemas and re-runs the real folder, so the version is `0015_core_push_tickets` again.
4. **Journal order and dependencies.** Ordering by `when` means a fresh database applies the older order's migration first. That is safe because an order that generated earlier cannot depend on the other order's objects. A hand-edited migration that must run after the other order's should be regenerated so it gets a later `when`.
5. **The snapshot the repair keeps** has no journal entry of its own. drizzle-kit accepts that (it reads snapshots and the journal separately), and so does the runner, which reads only the journal and the SQL files.
6. **Serena trap (2026-11-02).** In this session the Serena server's active project switched to a sibling worktree (`agent-a749d9951a1a2f924`) after `activate_project`, so two `edit_memory` calls wrote there. Both were reversed exactly (that file again equals its own branch's content apart from its DEL-4 lines). The memories of this PR were then edited with the file tools. The sibling's DEL-4 branch already records the same trap in `api/core`.

### 8.3 Not done here

1. The forked-chain case where the order that merges second generated first (its timestamp older than main's newest) was reasoned through, not simulated. Snapshots sort by file name and the collision check only reads `prevId`, so the same repair applies.
2. Only `packages/db` unit, `migrate.test.ts`, the tenancy schema test and the project guard ran locally. The full integration suite and the full turbo gate are left to CI.
3. The in-flight branches (PLAT-13 0016, INT-2 0017, DEL-4 0016) are untouched. Their index-named files go through the runner like any other, and the second and third to merge follow data §11.9.
4. The roadmap A-27 row (8.1 #2).

## 9. Lead review
