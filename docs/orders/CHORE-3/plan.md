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

### 8.1 Deviations

### 8.2 Notes

### 8.3 Not done here

## 9. Lead review
