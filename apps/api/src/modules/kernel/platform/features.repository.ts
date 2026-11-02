import type { Pool } from '@eeasy-logistics/db';
import type { PlatformDatabase, PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import {
  PlatformRepository,
  getPlatformUnitOfWork,
  withPlatformUnitOfWork,
} from '@eeasy-logistics/db/platform';
import { and, eq, sql } from 'drizzle-orm';
import type { FeatureStore } from '../features/feature-resolver.js';
import type { FlagState } from '../features/feature-rules.js';
import type { RolloutModeValue } from '../schema/rollout.js';
import { coreFeatureFlags, coreRolloutModes } from '../schema/rollout.js';

// The platform side of K-6 (PLAT-13 plan 2.5, 2.6): the rollout rows (a platform table, written
// only by `platformSetRolloutMode`) and the flag rows the gate and `Me.features` read. Reads run
// on the platform pool: `core_rollout_modes` has no `account_id`, so no tenant repository reaches
// it, and one short platform transaction reads both tables for any account the caller names (the
// principal's, never a request's).

export interface RolloutRow {
  readonly featureKey: string;
  readonly mode: RolloutModeValue;
  readonly updatedBy: string | null;
  readonly updatedAt: Date;
}

const rolloutColumns = {
  featureKey: coreRolloutModes.featureKey,
  mode: coreRolloutModes.mode,
  updatedBy: coreRolloutModes.updatedBy,
  updatedAt: coreRolloutModes.updatedAt,
};

export class FeatureRows extends PlatformRepository<typeof coreRolloutModes> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreRolloutModes);
  }

  /** Every rollout row. */
  async modes(): Promise<RolloutRow[]> {
    return this.unscoped().select(rolloutColumns).from(coreRolloutModes);
  }

  /** The rollout row of `key`; `lock` holds it `FOR UPDATE` until the transaction ends. */
  async mode(key: string, options: { lock?: boolean } = {}): Promise<RolloutRow | undefined> {
    const query = this.unscoped()
      .select(rolloutColumns)
      .from(coreRolloutModes)
      .where(eq(coreRolloutModes.featureKey, key))
      .$dynamic();
    const [row] = options.lock === true ? await query.for('update') : await query;
    return row;
  }

  /** Upserts the mode of `key` as `updatedBy`. */
  async setMode(key: string, mode: RolloutModeValue, updatedBy: string): Promise<RolloutRow> {
    const [row] = await this.unscoped()
      .insert(coreRolloutModes)
      .values({ featureKey: key, mode, updatedBy })
      .onConflictDoUpdate({
        target: coreRolloutModes.featureKey,
        set: { mode, updatedBy, updatedAt: sql`now()` },
      })
      .returning(rolloutColumns);
    if (row === undefined) throw new Error('The rollout upsert returned no row');
    return row;
  }

  /** The flag rows of an account, by key. */
  async flagsOf(accountId: string): Promise<Map<string, FlagState>> {
    const rows = await this.unscoped()
      .select({
        key: coreFeatureFlags.featureKey,
        enabled: coreFeatureFlags.enabled,
        provisionedBy: coreFeatureFlags.provisionedBy,
      })
      .from(coreFeatureFlags)
      .where(eq(coreFeatureFlags.accountId, accountId));
    return new Map(rows.map((row) => [row.key, row]));
  }

  /** One flag row of an account. */
  async flag(accountId: string, key: string): Promise<FlagState | undefined> {
    const [row] = await this.unscoped()
      .select({
        enabled: coreFeatureFlags.enabled,
        provisionedBy: coreFeatureFlags.provisionedBy,
      })
      .from(coreFeatureFlags)
      .where(and(eq(coreFeatureFlags.accountId, accountId), eq(coreFeatureFlags.featureKey, key)));
    return row;
  }
}

/** The gate's table reads on the API's platform pool, one short transaction each; null without. */
export function featureStoreOnPool(pool: Pool<PlatformDatabase> | null): FeatureStore | null {
  if (pool === null) return null;
  const run = <T>(fn: (rows: FeatureRows) => Promise<T>) =>
    withPlatformUnitOfWork(pool.db, (uow) => fn(new FeatureRows(uow)));
  return {
    mode: (key) => run(async (rows) => (await rows.mode(key))?.mode),
    flag: (accountId, key) => run((rows) => rows.flag(accountId, key)),
  };
}

/** The rollout rows on the current platform request's transaction (`platformSetRolloutMode`). */
export function currentFeatureRows(): {
  readonly uow: PlatformUnitOfWork;
  readonly rows: FeatureRows;
} {
  const uow = getPlatformUnitOfWork();
  return { uow, rows: new FeatureRows(uow) };
}

/** The modes and an account's flags on `uow` (`Me.features`, in the identity transaction). */
export async function featureStateIn(
  uow: PlatformUnitOfWork,
  accountId: string,
): Promise<{ modes: Map<string, RolloutModeValue>; flags: Map<string, FlagState> }> {
  const rows = new FeatureRows(uow);
  const modes = new Map((await rows.modes()).map((row) => [row.featureKey, row.mode]));
  return { modes, flags: await rows.flagsOf(accountId) };
}
