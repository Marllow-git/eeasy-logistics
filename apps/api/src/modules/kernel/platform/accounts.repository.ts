import type { Pool } from '@eeasy-logistics/db';
import type { PlatformDatabase, PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository, withPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { eq, sql } from 'drizzle-orm';
import type { AccountLocale, AccountStatus } from '../schema/accounts.js';
import { coreAccounts } from '../schema/accounts.js';

/** Platform reads of `core_accounts` (elx_platform, every account). */
export class AccountsDirectory extends PlatformRepository<typeof coreAccounts> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreAccounts);
  }

  /** Whether `accountId` names an account, whatever its status (support reaches suspended ones). */
  async exists(accountId: string): Promise<boolean> {
    const rows = await this.unscoped()
      .select({ id: coreAccounts.id })
      .from(coreAccounts)
      .where(eq(coreAccounts.id, accountId))
      .limit(1);
    return rows.length === 1;
  }
}

/** One account row as the account doors read it (PLAT-12 plan 2.2, 2.3). */
export interface AccountRecord {
  readonly id: string;
  readonly name: string;
  readonly status: AccountStatus;
  readonly country: string;
  readonly defaultLocale: AccountLocale;
  readonly timezone: string;
  /** `limits` as stored; `accounts/limits.ts` applies the defaults. */
  readonly limits: unknown;
  /** `settings` as stored; `accounts/settings.ts` applies the defaults. */
  readonly settings: unknown;
  readonly provisionedBy: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** The columns of an `AccountRecord` (PLAT-13's provisioning repository selects the same). */
export const recordColumns = {
  id: coreAccounts.id,
  name: coreAccounts.name,
  status: coreAccounts.status,
  country: coreAccounts.country,
  defaultLocale: coreAccounts.defaultLocale,
  timezone: coreAccounts.timezone,
  limits: coreAccounts.limits,
  settings: coreAccounts.settings,
  provisionedBy: coreAccounts.provisionedBy,
  version: coreAccounts.version,
  createdAt: coreAccounts.createdAt,
  updatedAt: coreAccounts.updatedAt,
};

/**
 * The staff surface's own account (PLAT-12 plan 2.2, 2.3). `core_accounts` is a platform table that
 * elx_app may only read (0003, review M-3), so the account doors read and write it here, on the
 * platform pool, always for the id of the token's account the caller passes (`getContext()`),
 * never one from a request.
 */
export class AccountRecords extends PlatformRepository<typeof coreAccounts> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreAccounts);
  }

  /**
   * The row, or undefined. `lock` takes `FOR NO KEY UPDATE` until the transaction ends: it orders
   * concurrent settings writers, and unlike `FOR UPDATE` it does not wait for the `FOR KEY SHARE`
   * lock the caller's own request transaction holds on this row (any insert there with a foreign
   * key to `core_accounts`, the idempotency key first), which on the other pool would never be
   * released while this transaction waits: a deadlock PostgreSQL cannot see.
   */
  async find(
    accountId: string,
    options: { lock?: boolean } = {},
  ): Promise<AccountRecord | undefined> {
    const query = this.unscoped()
      .select(recordColumns)
      .from(coreAccounts)
      .where(eq(coreAccounts.id, accountId))
      .$dynamic();
    const [row] = options.lock === true ? await query.for('no key update') : await query;
    return row;
  }

  /** Stores the settings document; `version + 1`. */
  async writeSettings(
    accountId: string,
    settings: Record<string, unknown>,
  ): Promise<AccountRecord> {
    const [row] = await this.unscoped()
      .update(coreAccounts)
      .set({
        settings,
        version: sql`${coreAccounts.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(coreAccounts.id, accountId))
      .returning(recordColumns);
    if (row === undefined) throw new Error('The account row vanished under its lock');
    return row;
  }
}

/**
 * One platform transaction over the account doors' repository; `uow` is that transaction, for the
 * audit row of a change made in it (`AuditSink.recordIn`, PLAT-12 adversary M-1).
 */
export interface AccountStore {
  run<T>(fn: (accounts: AccountRecords, uow: PlatformUnitOfWork) => Promise<T>): Promise<T>;
}

/** The store on the API's platform pool, or null without one (`DATABASE_URL_PLATFORM` unset). */
export function accountStoreOnPool(pool: Pool<PlatformDatabase> | null): AccountStore | null {
  if (pool === null) return null;
  return {
    run: (fn) => withPlatformUnitOfWork(pool.db, (uow) => fn(new AccountRecords(uow), uow)),
  };
}
