// The cross-tenant path (data §4.4, ADR-0031): the `elx_platform` pool and the repository base that
// may omit the account predicate. The apps/api architecture test allows importing this entry only
// from `modules/kernel/platform/` and the worker's system jobs (`src/worker/system/`).
import type { Secret } from '@eeasy-logistics/config';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Pool, RoleDatabase } from './pools.ts';
import { openPool } from './pools.ts';
import type { Transaction } from './unit-of-work.ts';

/** The `elx_platform` pool; the `platform_access` policy shows it every account. */
export type PlatformDatabase = RoleDatabase<'platform'>;

/** One transaction on the platform pool, with no account setting. */
export interface PlatformUnitOfWork {
  readonly tx: Transaction;
}

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

/** Runs `fn` in one transaction on the platform pool. Every caller writes its own audit row. */
export function withPlatformUnitOfWork<T>(
  db: PlatformDatabase,
  fn: (uow: PlatformUnitOfWork) => Promise<T>,
): Promise<T> {
  return db.transaction((tx) => fn(Object.freeze({ tx })));
}

/** Repository base for platform handlers and system jobs: `unscoped()` exists only here. */
export abstract class PlatformRepository<TTable extends PgTable> {
  readonly #uow: PlatformUnitOfWork;
  protected readonly table: TTable;

  constructor(uow: PlatformUnitOfWork, table: TTable) {
    this.#uow = uow;
    this.table = table;
  }

  /** The transaction without any account predicate: reads and writes across every account. */
  protected unscoped(): Transaction {
    return this.#uow.tx;
  }
}
