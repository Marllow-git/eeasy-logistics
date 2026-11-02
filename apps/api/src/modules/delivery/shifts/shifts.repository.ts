import type { RequestContext, TenantUpdate, UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import type { SQL } from 'drizzle-orm';
import { and, eq, gt, inArray, lt, lte, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { ListPagePlan, PageKey, ShiftStatus } from '../../kernel/public/index.js';
import {
  delDriverShifts,
  keysetAfter,
  keysetOrder,
  liveShiftStatuses,
  siteFilter,
} from '../../kernel/public/index.js';

/** A `del_driver_shifts` row of the context's account. */
export type ShiftRow = typeof delDriverShifts.$inferSelect;

/** The documented sort fields of `listShifts` and `driverListShifts` (`-planned_start` default). */
export type ShiftSortField = 'planned_start' | 'created_at';

const live = inArray(delDriverShifts.status, [...liveShiftStatuses]);
const byDriver = [sql`${delDriverShifts.driverId}`, sql`${delDriverShifts.id}`];

/** The statuses a new plan may not overlap (plan 2.3). */
const occupying: readonly ShiftStatus[] = ['planned', 'active', 'paused'];

/** What each sort field orders by, at the millisecond the cursor carries. */
const sortValue: Record<ShiftSortField, SQL | AnyPgColumn> = {
  planned_start: sql`date_trunc('milliseconds', ${delDriverShifts.plannedStart})`,
  created_at: sql`date_trunc('milliseconds', ${delDriverShifts.createdAt})`,
};

export function shiftKeyOf(field: ShiftSortField, row: ShiftRow): PageKey {
  const value = field === 'planned_start' ? row.plannedStart : row.createdAt;
  return { value: value.toISOString(), id: row.id };
}

export interface ShiftFilters {
  readonly statuses?: readonly ShiftStatus[] | undefined;
  readonly siteId?: string | undefined;
  readonly driverId?: string | undefined;
  /** The Asia/Riyadh calendar date of `planned_start` (`YYYY-MM-DD`). */
  readonly businessDate?: string | undefined;
}

/** `del_driver_shifts` of the context's account in the caller's tenant unit of work (DEL-5 2.1). */
export class ShiftsRepository extends ScopedRepository<typeof delDriverShifts> {
  constructor(uow: UnitOfWork) {
    super(uow, delDriverShifts);
  }

  async find(id: string): Promise<ShiftRow | undefined> {
    const [row] = await this.findMany(eq(delDriverShifts.id, id));
    return row;
  }

  /** The driver's live (`active` or `paused`) shift; at most one by the partial unique index. */
  async live(driverId: string): Promise<ShiftRow | undefined> {
    const [row] = await this.findMany(and(eq(delDriverShifts.driverId, driverId), live), {
      limit: 1,
    });
    return row;
  }

  /**
   * The account's live shifts (`listLatestDriverPositions`, plan 2.7), at `siteId` when given and
   * within a site-scoped member's sites (`siteFilter`), oldest start first.
   */
  liveShifts(siteId: string | undefined, context: RequestContext): Promise<ShiftRow[]> {
    return this.findMany(
      and(
        live,
        siteId === undefined ? undefined : eq(delDriverShifts.siteId, siteId),
        siteFilter(context, delDriverShifts.siteId),
      ),
      { orderBy: [sql`${delDriverShifts.plannedStart}`, sql`${delDriverShifts.id}`] },
    );
  }

  /**
   * The account's live shifts in driver order (the suspension consumer, plan 2.5): the system
   * writers take driver locks in this order, so two of them never wait on each other in a cycle.
   */
  liveByDriver(): Promise<ShiftRow[]> {
    return this.findMany(live, { orderBy: byDriver });
  }

  /** Live shifts whose `planned_end` is at or before `cutoff`, in driver order (overdue ends). */
  liveEndedBy(cutoff: Date): Promise<ShiftRow[]> {
    return this.findMany(and(live, lte(delDriverShifts.plannedEnd, cutoff)), { orderBy: byDriver });
  }

  /** `planned` shifts whose `planned_start` is at or before `cutoff`, in driver order (no-shows). */
  plannedStartedBy(cutoff: Date): Promise<ShiftRow[]> {
    return this.findMany(
      and(eq(delDriverShifts.status, 'planned'), lte(delDriverShifts.plannedStart, cutoff)),
      { orderBy: byDriver },
    );
  }

  /** `active` shifts not alerted after `alertedBefore` (the stale check, plan 2.8), driver order. */
  activeNotAlertedSince(alertedBefore: Date): Promise<ShiftRow[]> {
    return this.findMany(
      and(
        eq(delDriverShifts.status, 'active'),
        sql`(${delDriverShifts.staleAlertedAt} IS NULL OR ${delDriverShifts.staleAlertedAt} <= ${alertedBefore.toISOString()}::timestamptz)`,
      ),
      { orderBy: byDriver },
    );
  }

  /** A stale alert on an `active` shift (`version + 1`); undefined once it is no longer active. */
  async markStaleAlerted(id: string, at: Date): Promise<ShiftRow | undefined> {
    const [row] = await this.updateWhere(
      {
        staleAlertedAt: at,
        version: sql`${delDriverShifts.version} + 1` as unknown as number,
        updatedAt: sql`now()` as unknown as Date,
      },
      and(eq(delDriverShifts.id, id), eq(delDriverShifts.status, 'active')),
    );
    return row;
  }

  /** A `planned`, `active` or `paused` shift of the driver overlapping `[start, end)`, if any. */
  async overlapping(driverId: string, start: Date, end: Date): Promise<ShiftRow | undefined> {
    const [row] = await this.findMany(
      and(
        eq(delDriverShifts.driverId, driverId),
        inArray(delDriverShifts.status, [...occupying]),
        lt(delDriverShifts.plannedStart, end),
        gt(delDriverShifts.plannedEnd, start),
      ),
      { orderBy: [sql`${delDriverShifts.plannedStart}`], limit: 1 },
    );
    return row;
  }

  page(query: {
    readonly filters: ShiftFilters;
    readonly sort: ListPagePlan<ShiftSortField>['sort'];
    readonly after: PageKey | undefined;
    readonly limit: number;
  }): Promise<ShiftRow[]> {
    const { filters } = query;
    const value = sortValue[query.sort.field];
    const plan = { sort: query.sort, after: query.after };
    return this.findMany(
      and(
        filters.statuses === undefined
          ? undefined
          : inArray(delDriverShifts.status, [...filters.statuses]),
        filters.siteId === undefined ? undefined : eq(delDriverShifts.siteId, filters.siteId),
        filters.driverId === undefined ? undefined : eq(delDriverShifts.driverId, filters.driverId),
        filters.businessDate === undefined
          ? undefined
          : sql`(${delDriverShifts.plannedStart} AT TIME ZONE 'Asia/Riyadh')::date = ${filters.businessDate}::date`,
        keysetAfter(plan, value, delDriverShifts.id),
      ),
      { orderBy: keysetOrder(plan, value, delDriverShifts.id), limit: query.limit },
    );
  }

  async insert(values: {
    readonly id: string;
    readonly driverId: string;
    readonly siteId: string;
    readonly vehicleId: string | null;
    readonly plannedStart: Date;
    readonly plannedEnd: Date;
    readonly status: Extract<ShiftStatus, 'planned' | 'active'>;
  }): Promise<ShiftRow> {
    const [row] = await this.insertMany([
      {
        ...values,
        ...(values.status === 'active' ? { startedAt: sql`now()` as unknown as Date } : {}),
      },
    ]);
    if (row === undefined) throw new Error('The shift insert returned no row');
    return row;
  }

  /**
   * The status change `from` → `to` (the caller checked the arrow under the driver row lock), the
   * server times it implies, `version + 1`. Undefined when the row is no longer in `from`.
   */
  async move(
    id: string,
    from: ShiftStatus,
    to: ShiftStatus,
    extra: Pick<TenantUpdate<typeof delDriverShifts>, 'vehicleId'> = {},
  ): Promise<ShiftRow | undefined> {
    const now = sql`now()` as unknown as Date;
    const [row] = await this.updateWhere(
      {
        ...extra,
        status: to,
        ...(to === 'active' && from === 'planned' ? { startedAt: now } : {}),
        ...(to === 'ended' ? { endedAt: now } : {}),
        version: sql`${delDriverShifts.version} + 1` as unknown as number,
        updatedAt: now,
      },
      and(eq(delDriverShifts.id, id), eq(delDriverShifts.status, from)),
    );
    return row;
  }
}
