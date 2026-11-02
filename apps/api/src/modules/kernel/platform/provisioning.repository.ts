import type { PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository, getPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import type { SQL } from 'drizzle-orm';
import { and, eq, ilike, inArray, sql } from 'drizzle-orm';
import type { ListPagePlan } from '../contract/list-page.js';
import { keysetAfter, keysetOrder } from '../contract/list-page.js';
import type { AccountLocale, AccountStatus } from '../schema/accounts.js';
import { coreAccounts } from '../schema/accounts.js';
import { coreFeatureFlags } from '../schema/rollout.js';
import type { AccountRecord } from './accounts.repository.js';
import { recordColumns } from './accounts.repository.js';

// The platform side of provisioning (PLAT-13 plan 2.2 to 2.4; K-1, K-2, K-6): `core_accounts` rows
// created, listed, changed and activated, and the account's first feature flags. Platform-pool
// work only (elx_app may only read either table, 0014 and 0016).

/** The documented sort fields of `platformListAccounts` (plan 2.4). */
export type AccountSortField = 'created_at' | 'name' | 'status';

/**
 * The sort value of a field: `created_at` truncated to milliseconds, so a page's last key (a JS
 * `Date`, which keeps no microseconds) compares equal to its row (PLAT-12 trap).
 */
export function accountSortValue(field: AccountSortField): SQL {
  if (field === 'created_at') return sql`date_trunc('milliseconds', ${coreAccounts.createdAt})`;
  return field === 'name' ? sql`${coreAccounts.name}` : sql`${coreAccounts.status}`;
}

/** `q` as a literal `ILIKE` pattern: every `%`, `_` and `\` matches itself. */
export function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export interface NewAccount {
  readonly id: string;
  readonly name: string;
  readonly defaultLocale: AccountLocale;
  readonly limits: Readonly<Record<string, number>>;
  readonly provisionedBy: string;
}

/** The fields `platformUpdateAccount` may change (plan 2.4). */
export interface AccountProfileChange {
  readonly name?: string;
  readonly defaultLocale?: AccountLocale;
  readonly limits?: Readonly<Record<string, number>>;
}

export class ProvisionedAccounts extends PlatformRepository<typeof coreAccounts> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreAccounts);
  }

  /**
   * K-1: the one insert of an account, `provisioned`, in Saudi Arabia, Asia/Riyadh, with empty
   * settings and the limits and provisioning user the door was given.
   */
  async insert(account: NewAccount): Promise<AccountRecord> {
    const [row] = await this.unscoped()
      .insert(coreAccounts)
      .values({
        id: account.id,
        name: account.name,
        status: 'provisioned',
        country: 'SA',
        defaultLocale: account.defaultLocale,
        timezone: 'Asia/Riyadh',
        limits: { ...account.limits },
        settings: {},
        provisionedBy: account.provisionedBy,
      })
      .returning(recordColumns);
    if (row === undefined) throw new Error('The account insert returned no row');
    return row;
  }

  /** One page of accounts (`plan.limit` rows: the page plus one), filtered and keyset-ordered. */
  async page(
    plan: ListPagePlan<AccountSortField>,
    filters: { readonly statuses: readonly AccountStatus[] | undefined; readonly q?: string },
  ): Promise<AccountRecord[]> {
    const value = accountSortValue(plan.sort.field);
    const conditions = [
      filters.statuses === undefined
        ? undefined
        : inArray(coreAccounts.status, [...filters.statuses]),
      filters.q === undefined ? undefined : ilike(coreAccounts.name, containsPattern(filters.q)),
      keysetAfter(plan, value, coreAccounts.id),
    ].filter((condition): condition is SQL => condition !== undefined);
    return this.unscoped()
      .select(recordColumns)
      .from(coreAccounts)
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(...keysetOrder(plan, value, coreAccounts.id))
      .limit(plan.limit);
  }

  /** Writes the changed profile fields, `version + 1`; the caller holds the row's lock. */
  async updateProfile(accountId: string, change: AccountProfileChange): Promise<AccountRecord> {
    const [row] = await this.unscoped()
      .update(coreAccounts)
      .set({
        ...(change.name === undefined ? {} : { name: change.name }),
        ...(change.defaultLocale === undefined ? {} : { defaultLocale: change.defaultLocale }),
        ...(change.limits === undefined ? {} : { limits: { ...change.limits } }),
        version: sql`${coreAccounts.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(coreAccounts.id, accountId))
      .returning(recordColumns);
    if (row === undefined) throw new Error('The account row vanished under its lock');
    return row;
  }

  /**
   * `provisioned → active` (plan 2.3), in one statement: the row when this call made the change,
   * undefined when the account was in any other state (already active, suspended or closed:
   * nothing moves).
   */
  async activateProvisioned(accountId: string): Promise<AccountRecord | undefined> {
    const [row] = await this.unscoped()
      .update(coreAccounts)
      .set({ status: 'active', version: sql`${coreAccounts.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(coreAccounts.id, accountId), eq(coreAccounts.status, 'provisioned')))
      .returning(recordColumns);
    return row;
  }
}

/** The account's first flags, written by the provisioning door on the platform pool (plan 2.2). */
export class ProvisionedFeatureFlags extends PlatformRepository<typeof coreFeatureFlags> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreFeatureFlags);
  }

  /** One `enabled` row per key, `provisioned_by` the caller and `enabled_at` now (K-6). */
  async insertEnabled(
    accountId: string,
    keys: readonly string[],
    provisionedBy: string,
  ): Promise<void> {
    if (keys.length === 0) return;
    await this.unscoped()
      .insert(coreFeatureFlags)
      .values(
        keys.map((featureKey) => ({
          accountId,
          featureKey,
          enabled: true,
          provisionedBy,
          enabledAt: sql`now()`,
        })),
      );
  }
}

/** The provisioning repositories on the current platform request's transaction (plan 2.2). */
export interface ProvisioningTransaction {
  readonly uow: PlatformUnitOfWork;
  readonly accounts: ProvisionedAccounts;
  readonly flags: ProvisionedFeatureFlags;
}

/** The current platform request's transaction, for the doors outside this module (ADR-0031). */
export function currentProvisioning(): ProvisioningTransaction {
  const uow = getPlatformUnitOfWork();
  return { uow, accounts: new ProvisionedAccounts(uow), flags: new ProvisionedFeatureFlags(uow) };
}
