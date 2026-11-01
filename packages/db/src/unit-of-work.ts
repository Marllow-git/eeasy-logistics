import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { RequestContext } from './context.ts';
import { checkContext, currentFrame, runInFrame } from './context.ts';
import type { AppDatabase } from './pools.ts';

/** The Drizzle transaction a unit of work runs in. */
export type Transaction = Parameters<Parameters<PostgresJsDatabase['transaction']>[0]>[0];

/**
 * One transaction bound to one account (data §4.2). It carries no transaction handle: the raw
 * `tx` skips the repository's account predicate, so only the repository bases of this package
 * (constructed with the unit of work) reach it (PLAT-5 review M-1, structural fix in PLAT-6).
 */
export interface UnitOfWork {
  readonly context: RequestContext;
}

const transactions = new WeakMap<UnitOfWork, Transaction>();

/**
 * The transaction of `uow`. Package-internal: the repository bases use it; tests reach it through
 * `@eeasy-logistics/db/testing`, which the apps/api architecture test keeps out of `src/`.
 */
export function transactionOf(uow: UnitOfWork): Transaction {
  const tx = transactions.get(uow);
  if (tx === undefined) throw new Error('Not a unit of work opened by @eeasy-logistics/db');
  return tx;
}

/**
 * Starts tenant work for `context` on an open transaction (package-internal): the first statement
 * is `set_config('elx.account_id', <account>, true)`, then `fn` runs with the context and the unit
 * of work as the current frame. Used by `withUnitOfWork` (elx_app) and by the cross-tenant door
 * (`withCrossTenantUnitOfWork`, elx_platform).
 */
export async function runTenantTransaction<T>(
  tx: Transaction,
  context: RequestContext,
  fn: (uow: UnitOfWork) => Promise<T>,
): Promise<T> {
  await tx.execute(sql`SELECT set_config('elx.account_id', ${context.accountId}, true)`);
  const uow: UnitOfWork = Object.freeze({ context });
  transactions.set(uow, tx);
  return runInFrame({ context, unitOfWork: uow }, () => fn(uow));
}

/**
 * Runs `fn` in one transaction on the `elx_app` pool for `context.accountId` (data §4.2, ADR-0031).
 *
 * The first statement is `set_config('elx.account_id', <account>, true)`: the `true` makes the
 * setting transaction-local, so a pooled connection never carries one request's account into the
 * next, and the `tenant_isolation` policies (data §4.3) see the same account the repository
 * predicate uses. `fn` also runs with `context` as the current `getContext()` and the unit of work
 * as `getUnitOfWork()`. The transaction commits when `fn` resolves and rolls back when it rejects.
 * A cross-tenant context belongs on the platform pool (`withCrossTenantUnitOfWork`), never here.
 */
export async function withUnitOfWork<T>(
  db: AppDatabase,
  context: RequestContext,
  fn: (uow: UnitOfWork) => Promise<T>,
): Promise<T> {
  const checked = checkContext(context);
  if (checked.actingCrossTenant) {
    throw new Error('A cross-tenant context runs on the platform pool, never on elx_app');
  }
  return db.transaction((tx) => runTenantTransaction(tx, checked, fn));
}

/**
 * The unit of work of the current request or job, for constructing repositories. Throws outside
 * one, and on the platform surface without `@CrossTenant()` (no account, so no tenant rows).
 */
export function getUnitOfWork(): UnitOfWork {
  const uow = currentFrame()?.unitOfWork;
  if (uow === undefined || !transactions.has(uow as UnitOfWork)) {
    throw new Error('No tenant unit of work: tenant repositories run inside one');
  }
  return uow as UnitOfWork;
}
