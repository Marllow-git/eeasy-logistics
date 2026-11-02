import { getUnitOfWork } from '@eeasy-logistics/db';
import { DriversRepository } from '../drivers/drivers.repository.js';
import type { RingPoint } from './locations.repository.js';
import {
  LocationHeadsRepository,
  LocationRingRepository,
  TrailsRepository,
} from './locations.repository.js';

// The Delivery side of the telemetry worker jobs (DEL-5 plan 2.8; data §6; domain model §7): one
// driver's trail append and one account's retention, each in the caller's tenant unit of work on
// elx_app (the worker opens one per driver or per account: elx_platform only reads these tables,
// leg 1 ruling on 8.2 #1). Positions are personal data (data §10): nothing here logs one.

/** Trails are kept 90 days (Q-5; owner question §7 #4 on its default). */
export const trailRetentionDays = 90;

const riyadhDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Riyadh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The business date (Asia/Riyadh calendar day, `YYYY-MM-DD`) of an instant. */
export function businessDateOf(at: Date): string {
  return riyadhDate.format(at);
}

/** The first business date retention keeps at `now`: today in Riyadh minus 90 days. */
export function retentionCutoff(now: Date): string {
  const today = new Date(`${businessDateOf(now)}T00:00:00Z`);
  return new Date(today.getTime() - trailRetentionDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Splits seq-ordered points into business days (plan 2.8: a segment crossing midnight in Riyadh is
 * split at the boundary), in order of appearance; each day keeps its points in seq order.
 */
export function splitByBusinessDate(
  points: readonly RingPoint[],
): ReadonlyMap<string, readonly RingPoint[]> {
  const days = new Map<string, RingPoint[]>();
  for (const point of points) {
    const day = businessDateOf(point.clientTs);
    const list = days.get(day);
    if (list === undefined) days.set(day, [point]);
    else list.push(point);
  }
  return days;
}

export interface TrailAppend {
  /** Ring points appended (0 when the head had nothing new). */
  readonly points: number;
  /** Business-day rows written. */
  readonly days: number;
}

/**
 * Appends one driver's new ring points to the day trails (plan 2.8; data §6): under the driver row
 * lock (so no batch moves the head meanwhile), the ring rows with `trail_seq < seq <= last_seq`, one
 * simplified segment per business day, then `trail_seq = last_seq`, all in the caller's transaction.
 * Points the ring overwrote before a run (more than 240 since the last) are gone; the run takes what
 * the ring still holds. A second run without new points writes nothing.
 */
export async function appendDriverTrail(driverId: string): Promise<TrailAppend> {
  const uow = getUnitOfWork();
  await new DriversRepository(uow).lockDriver(driverId);
  const heads = new LocationHeadsRepository(uow);
  const head = await heads.find(driverId);
  if (head === undefined || head.lastSeq <= head.trailSeq) return { points: 0, days: 0 };
  const points = await new LocationRingRepository(uow).since(driverId, head.trailSeq, head.lastSeq);
  const days = splitByBusinessDate(points);
  const trails = new TrailsRepository(uow);
  for (const [day, segment] of days) await trails.append(driverId, day, segment);
  await heads.markAppended(driverId, head.lastSeq);
  return { points: points.length, days: days.size };
}

export interface TelemetryPurge {
  readonly trails: number;
  readonly ringRows: number;
  readonly heads: number;
}

/**
 * One account's retention (plan 2.8; data §6, §10): trails of business days before `cutoff`, and
 * the ring and head rows of the account's `archived` drivers.
 */
export async function purgeAccountTelemetry(cutoff: string): Promise<TelemetryPurge> {
  const uow = getUnitOfWork();
  const trails = await new TrailsRepository(uow).deleteBefore(cutoff);
  const ringRows = await new LocationRingRepository(uow).deleteOfArchivedDrivers();
  const heads = await new LocationHeadsRepository(uow).deleteOfArchivedDrivers();
  return { trails, ringRows, heads };
}
