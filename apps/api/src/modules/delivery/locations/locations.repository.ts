import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import type { SQL } from 'drizzle-orm';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
