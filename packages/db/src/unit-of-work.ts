import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { RequestContext } from './context.ts';
import { checkContext, runWithContext } from './context.ts';
import type { AppDatabase } from './pools.ts';

/** The Drizzle transaction a unit of work runs in. */
export type Transaction = Parameters<Parameters<PostgresJsDatabase['transaction']>[0]>[0];

/** One transaction bound to one account (data §4.2). */
export interface UnitOfWork {
  readonly tx: Transaction;
  readonly context: RequestContext;
}

/**
 * Runs `fn` in one transaction on the `elx_app` pool for `context.accountId` (data §4.2, ADR-0031).
 *
 * The first statement is `set_config('elx.account_id', <account>, true)`: the `true` makes the
 * setting transaction-local, so a pooled connection never carries one request's account into the
 * next, and the `tenant_isolation` policies (data §4.3) see the same account the repository
 * predicate uses. `fn` also runs with `context` as the current `getContext()`.
 */
export async function withUnitOfWork<T>(
  db: AppDatabase,
  context: RequestContext,
  fn: (uow: UnitOfWork) => Promise<T>,
): Promise<T> {
  const checked = checkContext(context);
  return runWithContext(checked, () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('elx.account_id', ${checked.accountId}, true)`);
      return fn(Object.freeze({ tx, context: checked }));
    }),
  );
}
