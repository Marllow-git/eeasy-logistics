import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository, uuidv7 } from '@eeasy-logistics/db';
import type { SQL } from 'drizzle-orm';
import { and, eq, gt, inArray, lt, lte, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  delDriverLocationHeads,
  delDriverLocations,
  delDriverTrails,
} from '../../kernel/public/index.js';
import type { AcceptedPoint } from './location-input.js';
import { ringSlots } from './location-input.js';

// The location tables in the request's tenant unit of work (DEL-5 plan 2.6, 2.7; data §6). Points
// are written as `ST_SetSRID(ST_MakePoint(lng, lat), 4326)` and read as `{ x: lng, y: lat }`
// (data §8). Positions are personal data: nothing here logs one.

/** A `del_driver_location_heads` row of the context's account. */
export type HeadRow = typeof delDriverLocationHeads.$inferSelect;

const pointOf = (lat: number, lng: number): SQL =>
  sql`ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)`;

/** `driver_id` is one of the account's `archived` drivers (the retention job, data §6). */
const archivedDriver = (column: AnyPgColumn, accountId: string): SQL =>
  sql`${column} IN (SELECT d.id FROM del_drivers d
                    WHERE d.account_id = ${accountId} AND d.status = 'archived')`;

/** A ring point as the trail appender reads it: M is the device time in Unix seconds. */
export interface RingPoint {
  readonly seq: number;
  readonly lat: number;
  readonly lng: number;
  readonly clientTs: Date;
}

/**
 * The trail's simplification tolerance (data §6: about 5 m) in degrees of the SRID 4326 plane:
 * 5 m of latitude, and at most 5.5 m of longitude at Saudi latitudes (16° to 32° N).
 */
export const trailToleranceDeg = 0.000045;

export class LocationHeadsRepository extends ScopedRepository<typeof delDriverLocationHeads> {
  constructor(uow: UnitOfWork) {
    super(uow, delDriverLocationHeads);
  }

  /** The driver's head, created empty on the first batch. The caller holds the driver lock. */
  async ensure(driverId: string): Promise<HeadRow> {
    await this.insertIgnoringConflicts([{ driverId }]);
    const [row] = await this.findMany(eq(delDriverLocationHeads.driverId, driverId));
    if (row === undefined) throw new Error('The location head vanished under the driver lock');
    return row;
  }

  /**
   * `last_seq + count` with the newest point as the latest (data §6: one `UPDATE … RETURNING` per
   * batch); returns the new `last_seq`.
   */
  async advance(driverId: string, count: number, newest: AcceptedPoint): Promise<number> {
    const [row] = await this.updateWhere(
      {
        lastSeq: sql`${delDriverLocationHeads.lastSeq} + ${count}` as unknown as number,
        lastPoint: pointOf(newest.lat, newest.lng) as unknown as HeadRow['lastPoint'],
        lastClientTs: newest.clientTs,
        lastServerTs: sql`now()` as unknown as Date,
      },
      eq(delDriverLocationHeads.driverId, driverId),
    );
    if (row === undefined) throw new Error('The location head vanished under the driver lock');
    return row.lastSeq;
  }

  async find(driverId: string): Promise<HeadRow | undefined> {
    const [row] = await this.findMany(eq(delDriverLocationHeads.driverId, driverId));
    return row;
  }

  /** The trail appender took every point up to `seq` (plan 2.8). */
  async markAppended(driverId: string, seq: number): Promise<void> {
    await this.updateWhere({ trailSeq: seq }, eq(delDriverLocationHeads.driverId, driverId));
  }

  /** Deletes the heads of the account's `archived` drivers (retention, data §6); how many. */
  async deleteOfArchivedDrivers(): Promise<number> {
    return (await this.deleteWhere(archivedDriver(delDriverLocationHeads.driverId, this.accountId)))
      .length;
  }

  /** The heads of `driverIds` that hold a point (the maps' fallback when Redis has none). */
  async latestOf(driverIds: readonly string[]): Promise<HeadRow[]> {
    if (driverIds.length === 0) return [];
    return this.findMany(
      and(
        inArray(delDriverLocationHeads.driverId, [...driverIds]),
        sql`${delDriverLocationHeads.lastPoint} IS NOT NULL`,
      ),
    );
  }
}

export class LocationRingRepository extends ScopedRepository<typeof delDriverLocations> {
  constructor(uow: UnitOfWork) {
    super(uow, delDriverLocations);
  }

  /** The ring points with `afterSeq < seq <= upToSeq` in seq order (the trail appender, plan 2.8). */
  since(driverId: string, afterSeq: number, upToSeq: number): Promise<RingPoint[]> {
    return this.selectWhere<RingPoint>(
      {
        seq: delDriverLocations.seq,
        lat: sql<number>`ST_Y(${delDriverLocations.point})`,
        lng: sql<number>`ST_X(${delDriverLocations.point})`,
        clientTs: delDriverLocations.clientTs,
      },
      and(
        eq(delDriverLocations.driverId, driverId),
        gt(delDriverLocations.seq, afterSeq),
        lte(delDriverLocations.seq, upToSeq),
      ),
      { orderBy: [sql`${delDriverLocations.seq}`] },
    );
  }

  /** Deletes the ring rows of the account's `archived` drivers (retention, data §6); how many. */
  async deleteOfArchivedDrivers(): Promise<number> {
    return (await this.deleteWhere(archivedDriver(delDriverLocations.driverId, this.accountId)))
      .length;
  }

  /**
   * The points into their slots (`seq % 240`), one upsert for the batch (data §6); `lastSeq` is the
   * head's `last_seq` after `advance`.
   */
  async write(
    driverId: string,
    shiftId: string,
    lastSeq: number,
    points: readonly AcceptedPoint[],
  ): Promise<void> {
    const slots = ringSlots(lastSeq, points.length);
    const now = sql`now()` as unknown as Date;
    const excluded = (column: string) => sql.raw(`excluded.${column}`) as unknown as never;
    await this.upsertMany(
      points.map((point, index) => {
        const { seq, slot } = slots[index] ?? { seq: 0, slot: 0 };
        return {
          driverId,
          slot,
          seq,
          shiftId,
          point: pointOf(point.lat, point.lng) as unknown as { x: number; y: number },
          clientTs: point.clientTs,
          serverTs: now,
          accuracyM: point.accuracyM,
          speedMps: point.speedMps,
          headingDeg: point.headingDeg,
          batteryPct: point.batteryPct,
          isCharging: point.isCharging,
          powerSaver: point.powerSaver,
        };
      }),
      [delDriverLocations.driverId, delDriverLocations.slot],
      {
        seq: excluded('seq'),
        shiftId: excluded('shift_id'),
        point: excluded('point'),
        clientTs: excluded('client_ts'),
        serverTs: excluded('server_ts'),
        accuracyM: excluded('accuracy_m'),
        speedMps: excluded('speed_mps'),
        headingDeg: excluded('heading_deg'),
        batteryPct: excluded('battery_pct'),
        isCharging: excluded('is_charging'),
        powerSaver: excluded('power_saver'),
      },
    );
  }
}

/** A trail as `getDriverTrail` answers it: the path as GeoJSON, M values left out (plan 2.7). */
export interface TrailView {
  readonly driverId: string;
  readonly businessDate: string;
  readonly line: { readonly type: 'LineString'; readonly coordinates: [number, number][] };
}

export class TrailsRepository extends ScopedRepository<typeof delDriverTrails> {
  constructor(uow: UnitOfWork) {
    super(uow, delDriverTrails);
  }

  /**
   * Appends a segment of one business day (plan 2.8; data §6): the points as a LineStringM (M =
   * device time in Unix seconds) simplified at about 5 m (`ST_Simplify`, collapsed lines kept), then
   * `ST_MakeLine(path, segment)` onto the day's row, or a new row. A one-point segment of a new day
   * is that point twice, so the row holds a valid line. `point_count` counts ring points taken.
   */
  async append(
    driverId: string,
    businessDate: string,
    points: readonly RingPoint[],
  ): Promise<void> {
    const first = points[0];
    const last = points.at(-1);
    if (first === undefined || last === undefined) return;
    const vertices = points.length === 1 ? [first, first] : points;
    const segment = sql`ST_Simplify(ST_SetSRID(ST_MakeLine(ARRAY[${sql.join(
      vertices.map(
        (point) =>
          sql`ST_MakePointM(${point.lng}::float8, ${point.lat}::float8, ${point.clientTs.getTime() / 1000}::float8)`,
      ),
      sql`, `,
    )}]), 4326), ${trailToleranceDeg}::float8, true)`;
    const existing = (column: string) => sql.raw(`del_driver_trails.${column}`);
    const excluded = (column: string) => sql.raw(`excluded.${column}`);
    await this.upsertMany(
      [
        {
          id: uuidv7(),
          driverId,
          businessDate,
          path: segment as unknown as string,
          pointCount: points.length,
          firstTs: first.clientTs,
          lastTs: last.clientTs,
        },
      ],
      [delDriverTrails.accountId, delDriverTrails.driverId, delDriverTrails.businessDate],
      {
        path: sql`ST_MakeLine(${existing('path')}, ${excluded('path')})` as unknown as string,
        pointCount:
          sql`${existing('point_count')} + ${excluded('point_count')}` as unknown as number,
        firstTs: sql`least(${existing('first_ts')}, ${excluded('first_ts')})` as unknown as Date,
        lastTs: sql`greatest(${existing('last_ts')}, ${excluded('last_ts')})` as unknown as Date,
        updatedAt: sql`now()` as unknown as Date,
      },
    );
  }

  /** Deletes the account's trails of business days before `cutoff` (retention, Q-5); how many. */
  async deleteBefore(cutoff: string): Promise<number> {
    return (await this.deleteWhere(lt(delDriverTrails.businessDate, cutoff))).length;
  }

  async ofDay(driverId: string, businessDate: string): Promise<TrailView | undefined> {
    const [row] = await this.selectWhere<{ driverId: string; businessDate: string; line: string }>(
      {
        driverId: delDriverTrails.driverId,
        businessDate: delDriverTrails.businessDate,
        line: sql<string>`ST_AsGeoJSON(ST_Force2D(${delDriverTrails.path}))`,
      },
      and(eq(delDriverTrails.driverId, driverId), eq(delDriverTrails.businessDate, businessDate)),
    );
    if (row === undefined) return undefined;
    return {
      driverId: row.driverId,
      businessDate: row.businessDate,
      line: JSON.parse(row.line) as TrailView['line'],
    };
  }
}
