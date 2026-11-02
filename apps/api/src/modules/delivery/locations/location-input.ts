import type { FieldProblem } from '../../kernel/public/index.js';
import { locationRingSize } from '../../kernel/public/index.js';

// The location batch rules that need no database (DEL-5 plan 2.6; domain model §7; ADR-0028). A
// point outside the coordinate, accuracy, speed, heading or battery ranges makes the batch `400`; a
// point whose device time lies more than 60 seconds ahead or more than 24 hours back, or is not
// newer than the last point kept, is dropped and counted (a duplicate or late point is harmless,
// never an error). A point up to 60 seconds ahead is kept with the server time as its device time
// (adversary round 1, L-d), so a phone whose clock runs ahead cannot block its next minutes.

const minute = 60_000;
export const maxFutureMs = minute;
export const maxAgeMs = 24 * 60 * minute;
export const maxAccuracyM = 10_000;
/** 100 m/s (360 km/h) bounds a real fix's speed; a heading is a compass angle (adversary L-b). */
export const maxSpeedMps = 100;
export const maxHeadingDeg = 360;

/** One point as the contract's `DriverLocationPoint` carries it. */
export interface PointInput {
  readonly client_ts: string;
  readonly lat: number;
  readonly lng: number;
  readonly accuracy_m?: number | undefined;
  readonly speed_mps?: number | undefined;
  readonly heading_deg?: number | undefined;
  readonly battery_pct?: number | undefined;
  readonly is_charging?: boolean | undefined;
  readonly power_saver?: boolean | undefined;
}

/** A point kept for the ring, its device time parsed. */
export interface AcceptedPoint {
  readonly clientTs: Date;
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM: number | null;
  readonly speedMps: number | null;
  readonly headingDeg: number | null;
  readonly batteryPct: number | null;
  readonly isCharging: boolean | null;
  readonly powerSaver: boolean | null;
}

export type DropReason = 'stale' | 'future' | 'too_old';

/** The range problems of a batch (`400 validation_failed`), each at its point's pointer. */
export function pointProblems(points: readonly PointInput[]): FieldProblem[] {
  const problems: FieldProblem[] = [];
  points.forEach((point, index) => {
    const at = (field: string): FieldProblem => ({
      pointer: `/body/points/${String(index)}/${field}`,
      code: 'invalid',
    });
    if (Number.isNaN(Date.parse(point.client_ts))) problems.push(at('client_ts'));
    if (!inRange(point.lat, -90, 90)) problems.push(at('lat'));
    if (!inRange(point.lng, -180, 180)) problems.push(at('lng'));
    if (point.accuracy_m !== undefined && !inRange(point.accuracy_m, 0, maxAccuracyM)) {
      problems.push(at('accuracy_m'));
    }
    if (point.battery_pct !== undefined && !inRange(point.battery_pct, 0, 100)) {
      problems.push(at('battery_pct'));
    }
    if (point.speed_mps !== undefined && !inRange(point.speed_mps, 0, maxSpeedMps)) {
      problems.push(at('speed_mps'));
    }
    if (point.heading_deg !== undefined && !inRange(point.heading_deg, 0, maxHeadingDeg)) {
      problems.push(at('heading_deg'));
    }
  });
  return problems;
}

/**
 * The points to keep, oldest first, and the count dropped per reason: device time more than 60
 * seconds ahead of `now` (`future`) or more than 24 hours behind it (`too_old`), or not newer than
 * `after` (the head's last point) or than the point kept before it (`stale`). A kept point ahead of
 * `now` is stored at `now`, so a second one in the same batch is `stale`.
 */
export function selectPoints(
  points: readonly PointInput[],
  now: Date,
  after: Date | null,
): { readonly kept: AcceptedPoint[]; readonly dropped: Readonly<Record<DropReason, number>> } {
  const dropped: Record<DropReason, number> = { stale: 0, future: 0, too_old: 0 };
  const sorted = points
    .map((point) => ({ point, clientTs: new Date(point.client_ts) }))
    .sort((a, b) => a.clientTs.getTime() - b.clientTs.getTime());
  const kept: AcceptedPoint[] = [];
  let last = after?.getTime() ?? Number.NEGATIVE_INFINITY;
  for (const { point, clientTs } of sorted) {
    const given = clientTs.getTime();
    const time = Math.min(given, now.getTime());
    if (given > now.getTime() + maxFutureMs) dropped.future += 1;
    else if (time < now.getTime() - maxAgeMs) dropped.too_old += 1;
    else if (time <= last) dropped.stale += 1;
    else {
      last = time;
      kept.push({
        clientTs: new Date(time),
        lat: point.lat,
        lng: point.lng,
        accuracyM: point.accuracy_m ?? null,
        speedMps: point.speed_mps ?? null,
        headingDeg: point.heading_deg ?? null,
        batteryPct: point.battery_pct ?? null,
        isCharging: point.is_charging ?? null,
        powerSaver: point.power_saver ?? null,
      });
    }
  }
  return { kept, dropped };
}

/**
 * The seq and ring slot of each of `count` new points, oldest first, once the head's `last_seq`
 * became `lastSeq` (data §6: `slot = seq % 240`).
 */
export function ringSlots(lastSeq: number, count: number): { seq: number; slot: number }[] {
  return Array.from({ length: count }, (_, index) => {
    const seq = lastSeq - count + 1 + index;
    return { seq, slot: seq % locationRingSize };
  });
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}
