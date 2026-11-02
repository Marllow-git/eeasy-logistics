import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Frame, RequestContext } from './context.ts';
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
/** Units of work (tenant and platform) whose transaction has committed or rolled back. */
const retired = new WeakSet<object>();

/**
 * A statement on a unit of work whose transaction has ended (PLAT-6 adversary M-1): a continuation
 * left running after the response (a timer, an unawaited promise) must never reach the pooled
 * connection, which by then may serve another request's transaction.
 */
export class UnitOfWorkClosedError extends Error {
  constructor() {
    super('The unit of work is closed: its transaction has committed or rolled back');
    this.name = 'UnitOfWorkClosedError';
  }
}

/** Retires a unit of work when its transaction settles (package-internal). */
export function retire<K extends object>(uow: K, map: WeakMap<K, Transaction>): void {
  map.delete(uow);
  retired.add(uow);
}

/** The open transaction of `uow` in `map`, else `UnitOfWorkClosedError` or `notOpened` (internal). */
export function openTransaction<K extends object>(
  uow: K,
  map: WeakMap<K, Transaction>,
  notOpened: string,
): Transaction {
  const tx = map.get(uow);
  if (tx !== undefined) return tx;
  if (retired.has(uow)) throw new UnitOfWorkClosedError();
  throw new Error(notOpened);
}

/**
 * The transaction of `uow`. Package-internal: the repository bases resolve it on every statement,
 * so a handle kept past the end of the transaction throws `UnitOfWorkClosedError`; tests reach it
 * through `@eeasy-logistics/db/testing`, which the apps/api architecture test keeps out of `src/`.
 */
export function transactionOf(uow: UnitOfWork): Transaction {
  return openTransaction(uow, transactions, 'Not a unit of work opened by @eeasy-logistics/db');
}

/**
 * Starts tenant work for `context` on an open transaction (package-internal): the first statement
 * is `set_config('elx.account_id', <account>, true)`, then `fn` runs with the context and the unit
 * of work as the current frame. Used by `withUnitOfWork` (elx_app) and by the cross-tenant door
 * (`withCrossTenantUnitOfWork`, elx_platform), which also puts its platform unit of work on the
 * same transaction in the frame (`door`).
 */
export async function runTenantTransaction<T>(
  tx: Transaction,
  context: RequestContext,
  fn: (uow: UnitOfWork) => Promise<T>,
  door?: Pick<Frame, 'doorUnitOfWork'>,
): Promise<T> {
  await tx.execute(sql`SELECT set_config('elx.account_id', ${context.accountId}, true)`);
  const uow: UnitOfWork = Object.freeze({ context });
  transactions.set(uow, tx);
  try {
    return await runInFrame({ context, unitOfWork: uow, ...door }, () => fn(uow));
  } finally {
    retire(uow, transactions);
  }
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
  if (uow !== undefined && retired.has(uow)) throw new UnitOfWorkClosedError();
  if (uow === undefined || !transactions.has(uow as UnitOfWork)) {
    throw new Error('No tenant unit of work: tenant repositories run inside one');
  }
  return uow as UnitOfWork;
}
