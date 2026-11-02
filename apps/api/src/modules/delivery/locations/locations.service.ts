import type { AppDatabase } from '@eeasy-logistics/db';
import { getContext, getUnitOfWork, withUnitOfWork } from '@eeasy-logistics/db';
import type { RateLimiter, ShiftStatus } from '../../kernel/public/index.js';
import { ApiException, getMetrics } from '../../kernel/public/index.js';
import { DriversRepository } from '../drivers/drivers.repository.js';
import { tokenDriver } from '../drivers/token-driver.js';
import { ShiftsRepository } from '../shifts/shifts.repository.js';
import type { LatestPosition, LocationFanout } from './location-fanout.js';
import type { DropReason, PointInput } from './location-input.js';
import { pointProblems, selectPoints } from './location-input.js';
import type { HeadRow, TrailView } from './locations.repository.js';
import {
  LocationHeadsRepository,
  LocationRingRepository,
  TrailsRepository,
} from './locations.repository.js';

// The location ingest and the staff reads (DEL-5 plan 2.6, 2.7; domain model §7; ADR-0009,
// ADR-0028). The ingest has no request unit of work (`@NoUnitOfWork()`): it opens the request's only
// app transaction, commits, and then writes Redis, so a point is on the maps only once it is in the
// ring, and the ingest answers `202` whether Redis answers or not (the head is the fallback). No
// outbox row and no domain event for a point; no log line carries one.

export class LocationsService {
  constructor(
    private readonly deps: {
      readonly app: AppDatabase | null;
      readonly fanout: LocationFanout | null;
      readonly limiter: Pick<RateLimiter, 'charge'> | undefined;
      readonly now?: () => Date;
    },
  ) {}

  /**
   * `driverPostLocations`: the batch checked, then under the driver row lock the live shift
   * (`409 shift_not_active`), the per-driver budget (`429`), the points newer than the head into
   * the ring; after commit the latest hash and one publish per point.
   */
  async ingest(points: readonly PointInput[]): Promise<void> {
    const problems = pointProblems(points);
    if (problems.length > 0) throw new ApiException('validation_failed', { fields: problems });
    const { app } = this.deps;
    if (app === null) throw new Error('The location ingest needs the app pool');
    const context = getContext();
    const now = this.deps.now?.() ?? new Date();
    const outcome = await withUnitOfWork(app, context, async (uow) => {
      const { driver } = await tokenDriver(uow);
      await new DriversRepository(uow).lockDriver(driver.id);
      const shift = await new ShiftsRepository(uow).live(driver.id);
      if (shift === undefined) throw new ApiException('shift_not_active');
      await this.deps.limiter?.charge('driver_locations', `driver:${driver.id}`);
      const heads = new LocationHeadsRepository(uow);
      const head = await heads.ensure(driver.id);
      const { kept, dropped } = selectPoints(points, now, head.lastClientTs);
      const newest = kept.at(-1);
      let latest: LatestPosition | undefined;
      if (newest !== undefined) {
        const advanced = await heads.advance(driver.id, kept.length, newest);
        await new LocationRingRepository(uow).write(driver.id, shift.id, advanced.lastSeq, kept);
        latest = latestOf(driver.id, advanced, shift.status);
      }
      return { kept, dropped, latest };
    });
    record(outcome.kept.length, outcome.dropped, outcome.kept, new Date());
    // The head's state as committed (adversary round 1, finding 3): its point, device time and
    // database time; the hash takes it only when it is newer than what Redis holds.
    if (outcome.latest === undefined || this.deps.fanout === null) return;
    await this.deps.fanout.publish(
      context.accountId,
      outcome.latest,
      outcome.kept.map((point) => ({
        lat: point.lat,
        lng: point.lng,
        clientTs: point.clientTs.toISOString(),
      })),
    );
  }

  /**
   * `listLatestDriverPositions`: drivers on a live shift (at `siteId` when given, within a
   * site-scoped member's sites), their newest point from Redis, else from the head row; drivers
   * with no point yet are left out. The shift status is the database's.
   */
  async latest(siteId: string | undefined): Promise<LatestPosition[]> {
    const uow = getUnitOfWork();
    const context = getContext();
    const shifts = await new ShiftsRepository(uow).liveShifts(siteId, context);
    const driverIds = shifts.map((shift) => shift.driverId);
    const cached =
      (await this.deps.fanout?.latest(context.accountId, driverIds)) ??
      new Map<string, LatestPosition>();
    const missing = driverIds.filter((id) => !cached.has(id));
    const heads = new Map(
      (await new LocationHeadsRepository(uow).latestOf(missing)).map((head) => [
        head.driverId,
        head,
      ]),
    );
    const positions: LatestPosition[] = [];
    for (const shift of shifts) {
      const hit = cached.get(shift.driverId);
      if (hit !== undefined) {
        positions.push({ ...hit, shiftStatus: shift.status });
        continue;
      }
      const head = heads.get(shift.driverId);
      if (
        head === undefined ||
        head.lastPoint === null ||
        head.lastClientTs === null ||
        head.lastServerTs === null
      ) {
        continue;
      }
      positions.push({
        driverId: shift.driverId,
        lat: head.lastPoint.y,
        lng: head.lastPoint.x,
        clientTs: head.lastClientTs.toISOString(),
        serverTs: head.lastServerTs.toISOString(),
        shiftStatus: shift.status,
      });
    }
    return positions;
  }

  /** `getDriverTrail`: the driver's simplified line of one business day; `404` when none. */
  async trail(driverId: string, businessDate: string): Promise<TrailView> {
    const uow = getUnitOfWork();
    if ((await new DriversRepository(uow).find(driverId)) === undefined) {
      throw new ApiException('not_found');
    }
    const trail = await new TrailsRepository(uow).ofDay(driverId, businessDate);
    if (trail === undefined) throw new ApiException('not_found');
    return trail;
  }
}

/** The ingest's metrics (plan 2.6): points by outcome and the lag of each kept one. */
function record(
  accepted: number,
  dropped: Readonly<Record<DropReason, number>>,
  kept: readonly { clientTs: Date }[],
  serverTs: Date,
): void {
  const metrics = getMetrics();
  if (accepted > 0) metrics.add('driver_pings_total', accepted, { outcome: 'accepted' });
  for (const [reason, count] of Object.entries(dropped)) {
    if (count > 0) metrics.add('driver_pings_total', count, { outcome: reason });
  }
  for (const point of kept) {
    metrics.record('driver_ping_lag_ms', serverTs.getTime() - point.clientTs.getTime(), {});
  }
}

/** The latest position a committed head describes (`advance` always sets every field). */
function latestOf(driverId: string, head: HeadRow, shiftStatus: ShiftStatus): LatestPosition {
  if (head.lastPoint === null || head.lastClientTs === null || head.lastServerTs === null) {
    throw new Error('An advanced location head has no latest point');
  }
  return {
    driverId,
    lat: head.lastPoint.y,
    lng: head.lastPoint.x,
    clientTs: head.lastClientTs.toISOString(),
    serverTs: head.lastServerTs.toISOString(),
    shiftStatus,
  };
}
