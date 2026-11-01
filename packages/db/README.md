# @eeasy-logistics/db

Shared database helpers (data architecture §1.2, §4; ADR-0020, ADR-0025, proposed ADR-0031; order PLAT-5). Table declarations never live here: they stay private to each context in `apps/api/src/modules/<context>/schema/`.

| Entry | What | Who may import it |
|---|---|---|
| `@eeasy-logistics/db` | `createAppPool` (`elx_app`), `withUnitOfWork`, `RequestContext` and `getContext()`, `ScopedRepository`, `uuidv7()` | any server code |
| `@eeasy-logistics/db/platform` | `createPlatformPool` (`elx_platform`), `withPlatformUnitOfWork`, `PlatformRepository` with `unscoped()` | `apps/api/src/modules/kernel/platform/` and the worker's system jobs only (architecture test) |
| `@eeasy-logistics/db/testing` | the test-only context setter | tests only (architecture test) |

## Rules

- Every URL comes from `packages/config` (`config.db.urls`); this package holds no connection string and reads no environment.
- Tenant work runs inside `withUnitOfWork(appDb, context, fn)`: one transaction whose first statement is `SELECT set_config('elx.account_id', <account>, true)`. The setting is transaction-local, so a pooled connection never carries an account into the next transaction; the `tenant_isolation` policies read the same setting (data §4.3).
- `ScopedRepository` adds `account_id = <context account>` to every read, update and delete and sets `account_id` from the context on every insert, whatever the input says. Its transaction is private; omitting the predicate needs `unscoped()`, which only `PlatformRepository` has.
- The context comes from the token (request guard, PLAT-6) or a job payload, never from a request parameter.

## Tests

`pnpm --filter @eeasy-logistics/db test` needs a real PostgreSQL (handbook 03) reachable through `DATABASE_URL_APP`: `APP_ENV=local` with the root `.env` and the native or Compose stack, or `APP_ENV=ci` with the variables set. The tests use a temporary table only and leave nothing behind.
