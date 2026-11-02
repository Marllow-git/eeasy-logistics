import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import { eq, sql } from 'drizzle-orm';
import { coreFeatureFlags } from '../schema/rollout.js';

export type FeatureFlagRow = typeof coreFeatureFlags.$inferSelect;

/**
 * `core_feature_flags` of the context's account (PLAT-13 plan 2.6): read and written inside the
 * account's cross-tenant door (`platformListFeatureFlags`, `platformSetFeatureFlag`). Writes take
 * the account's `core_feature_flags` advisory lock first, so two changes of one account run one
 * after the other and each reads the row the previous one committed.
 */
export class FeatureFlagsRepository extends ScopedRepository<typeof coreFeatureFlags> {
  constructor(uow: UnitOfWork) {
    super(uow, coreFeatureFlags);
  }

  async all(): Promise<FeatureFlagRow[]> {
    return this.findMany();
  }

  async lockForWrite(): Promise<void> {
    await this.transactionLock('core_feature_flags');
  }

  async find(key: string): Promise<FeatureFlagRow | undefined> {
    const [row] = await this.findMany(eq(coreFeatureFlags.featureKey, key));
    return row;
  }

  /**
   * Sets the flag of `key`: enabled with `provisioned_by` the caller and `enabled_at` now, or
   * disabled with both cleared (K-6); a new row or `version + 1`.
   */
  async set(
    key: string,
    enabled: boolean,
    caller: string,
    existing: FeatureFlagRow | undefined,
  ): Promise<FeatureFlagRow> {
    const values = {
      enabled,
      provisionedBy: enabled ? caller : null,
      enabledAt: enabled ? (sql`now()` as unknown as Date) : null,
    };
    const [row] =
      existing === undefined
        ? await this.insertMany([{ featureKey: key, ...values }])
        : await this.updateWhere(
            {
              ...values,
              version: sql`${coreFeatureFlags.version} + 1` as unknown as number,
              updatedAt: sql`now()` as unknown as Date,
            },
            eq(coreFeatureFlags.featureKey, key),
          );
    if (row === undefined) throw new Error('The flag write returned no row');
    return row;
  }
}
