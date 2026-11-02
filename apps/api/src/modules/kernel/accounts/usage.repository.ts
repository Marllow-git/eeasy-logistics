import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import { and, eq, sql } from 'drizzle-orm';
import type { UsageMetric } from '../schema/sites.js';
import { coreUsageCounters } from '../schema/sites.js';

/**
 * `core_usage_counters` of the context's account (PLAT-12 plan 2.2). The period is the month start
 * in Asia/Riyadh (the accounts' one timezone, 0014), taken from the database clock.
 */
export class UsageCountersRepository extends ScopedRepository<typeof coreUsageCounters> {
  constructor(uow: UnitOfWork) {
    super(uow, coreUsageCounters);
  }

  /** The counter of `metric` for the current month, or 0 when nothing was counted yet. */
  async thisMonth(metric: UsageMetric): Promise<number> {
    const [row] = await this.findMany(
      and(
        eq(coreUsageCounters.metric, metric),
        eq(
          coreUsageCounters.period,
          sql`date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh')::date`,
        ),
      ),
    );
    return row?.value ?? 0;
  }
}
