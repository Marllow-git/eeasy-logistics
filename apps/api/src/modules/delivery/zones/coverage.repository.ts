import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository, uuidv7 } from '@eeasy-logistics/db';
import type { SQL } from 'drizzle-orm';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { ListPagePlan, PageKey } from '../../kernel/public/index.js';
import { delCoverage, keysetAfter, keysetOrder } from '../../kernel/public/index.js';

/** A `del_coverage` row of the context's account. */
export type CoverageRow = typeof delCoverage.$inferSelect;

/** The documented sort field of `listCoverage` (plan 2.4). */
export type CoverageSortField = 'created_at';

const createdAt = sql`date_trunc('milliseconds', ${delCoverage.createdAt})`;

export const coverageKeyOf = (row: CoverageRow): PageKey => ({
  value: row.createdAt.toISOString(),
  id: row.id,
});

/** `del_coverage` of the context's account (DEL-1 plan 2.4, 2.5, 2.6). */
export class CoverageRepository extends ScopedRepository<typeof delCoverage> {
  constructor(uow: UnitOfWork) {
    super(uow, delCoverage);
  }

  /** Orders the account's coverage replacements (plan 2.4): a site's set is read, then written. */
  lockWrites(): Promise<void> {
    return this.transactionLock('del_coverage');
  }

  /** The zones a site covers, sorted. */
  async zonesOf(siteId: string): Promise<string[]> {
    const rows = await this.selectWhere<{ zoneId: string }>(
      { zoneId: delCoverage.zoneId },
      eq(delCoverage.siteId, siteId),
      { orderBy: [asc(delCoverage.zoneId)] },
    );
    return rows.map((row) => row.zoneId);
  }

  /**
   * The site's set becomes `zoneIds` (plan 2.4): rows outside it are deleted, missing ones
   * inserted; the caller holds `lockWrites()` and checked every id.
   */
  async replace(siteId: string, zoneIds: readonly string[]): Promise<void> {
    await this.deleteWhere(
      and(
        eq(delCoverage.siteId, siteId),
        zoneIds.length === 0 ? undefined : notInArray(delCoverage.zoneId, [...zoneIds]),
      ),
    );
    await this.insertIgnoringConflicts(zoneIds.map((zoneId) => ({ id: uuidv7(), siteId, zoneId })));
  }

  /** The sites covering any of `zoneIds` (that site only, when given), sorted, once each. */
  async sitesOf(zoneIds: readonly string[], siteId?: string): Promise<string[]> {
    if (zoneIds.length === 0) return [];
    const rows = await this.selectWhere<{ siteId: string }>(
      { siteId: delCoverage.siteId },
      and(
        inArray(delCoverage.zoneId, [...zoneIds]),
        siteId === undefined ? undefined : eq(delCoverage.siteId, siteId),
      ),
    );
    return [...new Set(rows.map((row) => row.siteId))].sort();
  }

  page(query: {
    readonly siteId: string | undefined;
    readonly scope: SQL | undefined;
    readonly sort: ListPagePlan<CoverageSortField>['sort'];
    readonly after: PageKey | undefined;
    readonly limit: number;
  }): Promise<CoverageRow[]> {
    const plan = { sort: query.sort, after: query.after };
    return this.findMany(
      and(
        query.siteId === undefined ? undefined : eq(delCoverage.siteId, query.siteId),
        query.scope,
        keysetAfter(plan, createdAt, delCoverage.id),
      ),
      { orderBy: keysetOrder(plan, createdAt, delCoverage.id), limit: query.limit },
    );
  }

  /** Every row of the account, by site then zone (the provisioning door's answer, plan 2.6). */
  all(): Promise<CoverageRow[]> {
    return this.findMany(undefined, {
      orderBy: [asc(delCoverage.siteId), asc(delCoverage.zoneId)],
    });
  }
}
