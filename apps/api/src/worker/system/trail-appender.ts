import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '@eeasy-logistics/db';
import { withUnitOfWork } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { appendDriverTrail } from '../../modules/delivery/public/index.js';
import { accountScope, systemContext } from './tenant-runs.js';

// The trail appender (DEL-5 plan 2.8; data §6; ADR-0028): every 5 minutes under the Redis lock
// `elx:lock:trail-appender`, the drivers whose head has points the trail has not taken
// (`last_seq > trail_seq`) are listed on the platform pool, and each driver's points are appended
// in a tenant transaction of its own on elx_app (one per driver, the account set). It runs far more
// often than the ring wraps (one hour at 15 s). One driver's failure skips that driver only.

export const trailAppenderLockKey = 'elx:lock:trail-appender';
export const trailAppenderIntervalMs = 5 * 60 * 1000;
/** The lock outlives one run and expires before the next (the push receipts pattern). */
export const trailAppenderLockTtlMs = 4 * 60 * 1000;

export interface TrailAppenderCounts {
  readonly drivers: number;
  readonly points: number;
  readonly failed: number;
}

export type TrailAppenderRun =
  { readonly ran: true; readonly counts: TrailAppenderCounts } | { readonly ran: false };

export interface TrailAppenderDependencies {
  readonly db: PlatformDatabase;
  readonly app: AppDatabase;
  readonly redis: Pick<Redis, 'set'>;
  readonly logger: { warn(message: string): void };
  readonly lockKey?: string;
  /** Only these accounts (tests); every account otherwise. */
  readonly accounts?: readonly string[];
}

/** One scheduled run: takes the lock (`SET NX PX`, 4 min), then appends driver by driver. */
export async function runTrailAppender(deps: TrailAppenderDependencies): Promise<TrailAppenderRun> {
  const lock = deps.lockKey ?? trailAppenderLockKey;
  const acquired = await deps.redis.set(lock, randomUUID(), 'PX', trailAppenderLockTtlMs, 'NX');
  if (acquired !== 'OK') return { ran: false };
  const due = await deps.db.execute<{ account_id: string; driver_id: string }>(sql`
    SELECT account_id, driver_id FROM del_driver_location_heads
    WHERE last_seq > trail_seq${accountScope(sql`account_id`, deps.accounts)}
    ORDER BY account_id, driver_id`);
  let drivers = 0;
  let points = 0;
  let failed = 0;
  for (const row of due) {
    try {
      const appended = await withUnitOfWork(deps.app, systemContext(row.account_id), () =>
        appendDriverTrail(row.driver_id),
      );
      drivers += appended.points > 0 ? 1 : 0;
      points += appended.points;
    } catch (error) {
      failed += 1;
      // Ids and the error class only: never a position (data §10).
      deps.logger.warn(
        `Trail append failed for driver ${row.driver_id}: ${error instanceof Error ? error.name : 'error'}`,
      );
    }
  }
  return { ran: true, counts: { drivers, points, failed } };
}
