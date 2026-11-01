// The cross-tenant path (data §4.4, ADR-0031): the `elx_platform` pool, the platform unit of work,
// the cross-tenant door and the repository base that may omit the account predicate. The apps/api
// architecture test allows importing this entry only from `modules/kernel/platform/`, the worker's
// system jobs (`src/worker/system/`) and the seed tool.
import type { Secret } from '@eeasy-logistics/config';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { PlatformContext, RequestContext } from './context.ts';
import { checkContext, checkPlatformContext, currentFrame, runInFrame } from './context.ts';
import type { Pool, RoleDatabase } from './pools.ts';
import { openPool } from './pools.ts';
import type { Transaction, UnitOfWork } from './unit-of-work.ts';
import { runTenantTransaction } from './unit-of-work.ts';

export type { PlatformContext } from './context.ts';

/** The `elx_platform` pool; the `platform_access` policy shows it every account. */
export type PlatformDatabase = RoleDatabase<'platform'>;

/**
 * One transaction on the platform pool, with no account setting. Like the tenant unit of work it
 * carries no transaction handle; only `PlatformRepository` reaches it.
 */
export interface PlatformUnitOfWork {
  /** The platform staff member of a platform request; null for system jobs and the seed tool. */
  readonly context: PlatformContext | null;
}

const transactions = new WeakMap<PlatformUnitOfWork, Transaction>();

/** The part of `Config['db']` the platform pool needs. */
export interface PlatformPoolSettings {
  readonly urls: { readonly platform: Secret | undefined };
  readonly poolSize: { readonly platform: number };
}

export function createPlatformPool(
  db: PlatformPoolSettings,
  name = 'elx-platform',
): Pool<PlatformDatabase> {
  return openPool<'platform'>(db.urls.platform, 'DATABASE_URL_PLATFORM', {
    max: db.poolSize.platform,
    name,
  });
}

/**
 * Runs `fn` in one transaction on the platform pool. Every caller writes its own audit row. On the
 * platform surface `context` names the staff member and becomes the current frame, so
 * `getPlatformUnitOfWork()` finds it; `getUnitOfWork()` and `getContext()` keep throwing (no
 * account, so no tenant repository can be built).
 */
export function withPlatformUnitOfWork<T>(
  db: PlatformDatabase,
  fn: (uow: PlatformUnitOfWork) => Promise<T>,
  context: PlatformContext | null = null,
): Promise<T> {
  const checked = context === null ? null : checkPlatformContext(context);
  return db.transaction((tx) => {
    const uow: PlatformUnitOfWork = Object.freeze({ context: checked });
    transactions.set(uow, tx);
    return runInFrame(
      checked === null ? { unitOfWork: uow } : { platform: checked, unitOfWork: uow },
      () => fn(uow),
    );
  });
}

/**
 * The cross-tenant door (PLAT-6 plan 2.7; identity and tenancy §5): one transaction on the
 * platform pool whose first statement sets `elx.account_id` to the target account, so tenant
 * repositories (`ScopedRepository`, predicate) see that account only. `context.actingCrossTenant`
 * must be true and `context.userId` names the platform staff member. The caller (the
 * `@CrossTenant()` interceptor) has checked the support reason and emits the audit event.
 */
export async function withCrossTenantUnitOfWork<T>(
  db: PlatformDatabase,
  context: RequestContext,
  fn: (uow: UnitOfWork) => Promise<T>,
): Promise<T> {
  const checked = checkContext(context);
  if (!checked.actingCrossTenant || checked.userId === null) {
    throw new Error('The cross-tenant door needs actingCrossTenant and the platform user');
  }
  return db.transaction((tx) => runTenantTransaction(tx, checked, fn));
}

/** The platform unit of work of the current platform request or system job; throws otherwise. */
export function getPlatformUnitOfWork(): PlatformUnitOfWork {
  const uow = currentFrame()?.unitOfWork;
  if (uow === undefined || !transactions.has(uow as PlatformUnitOfWork)) {
    throw new Error('No platform unit of work');
  }
  return uow as PlatformUnitOfWork;
}

/** Repository base for platform handlers and system jobs: `unscoped()` exists only here. */
export abstract class PlatformRepository<TTable extends PgTable> {
  readonly #tx: Transaction;
  protected readonly table: TTable;

  constructor(uow: PlatformUnitOfWork, table: TTable) {
    const tx = transactions.get(uow);
    if (tx === undefined) throw new Error('Not a platform unit of work');
    this.#tx = tx;
    this.table = table;
  }

  /** The transaction without any account predicate: reads and writes across every account. */
  protected unscoped(): Transaction {
    return this.#tx;
  }
}
