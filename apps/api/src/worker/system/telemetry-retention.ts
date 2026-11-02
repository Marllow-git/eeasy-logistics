import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '@eeasy-logistics/db';
import { withUnitOfWork } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { purgeAccountTelemetry, retentionCutoff } from '../../modules/delivery/public/index.js';
import { accountScope, systemContext } from './tenant-runs.js';

// Telemetry retention (DEL-5 plan 2.8; data §6, §10; Q-5 on its 90-day default): daily at 03:00
// Asia/Riyadh under `elx:lock:telemetry-retention`, trails of business days older than 90 days and
// the ring and head rows of `archived` drivers are deleted. The accounts holding either are listed
// on the platform pool; each account's deletes run in one tenant transaction on elx_app. The timer
// ticks every 15 minutes; a tick outside the 03:00 hour does nothing, and the 23-hour lock lets one
// worker a day run it.

export const retentionLockKey = 'elx:lock:telemetry-retention';
export const retentionTickMs = 15 * 60 * 1000;
export const retentionLockTtlMs = 23 * 60 * 60 * 1000;
/** The hour of the day (Asia/Riyadh) the job runs in. */
export const retentionHour = 3;

const riyadhHour = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Riyadh',
  hour: '2-digit',
  hourCycle: 'h23',
});

/** Whether `now` falls in the 03:00 hour in Riyadh. */
export function isRetentionHour(now: Date): boolean {
  return Number(riyadhHour.format(now)) === retentionHour;
}

export interface RetentionCounts {
  readonly accounts: number;
  readonly trails: number;
  readonly ringRows: number;
  readonly heads: number;
  readonly failed: number;
}

export type RetentionRun =
  { readonly ran: true; readonly counts: RetentionCounts } | { readonly ran: false };

export interface RetentionDependencies {
  readonly db: PlatformDatabase;
  readonly app: AppDatabase;
  readonly redis: Pick<Redis, 'set'>;
  readonly logger: { warn(message: string): void };
  readonly now?: () => Date;
  readonly lockKey?: string;
  /** Only these accounts (tests); every account otherwise. */
  readonly accounts?: readonly string[];
}

/** One tick: in the 03:00 hour, takes the lock (`SET NX PX`, 23 h) and purges account by account. */
export async function runTelemetryRetention(deps: RetentionDependencies): Promise<RetentionRun> {
  const now = deps.now?.() ?? new Date();
  if (!isRetentionHour(now)) return { ran: false };
  const lock = deps.lockKey ?? retentionLockKey;
  const acquired = await deps.redis.set(lock, randomUUID(), 'PX', retentionLockTtlMs, 'NX');
  if (acquired !== 'OK') return { ran: false };
  const cutoff = retentionCutoff(now);
  const accounts = await deps.db.execute<{ account_id: string }>(sql`
    SELECT account_id FROM del_driver_trails
    WHERE business_date < ${cutoff}::date${accountScope(sql`account_id`, deps.accounts)}
    UNION
    SELECT h.account_id FROM del_driver_location_heads h
    JOIN del_drivers d ON d.id = h.driver_id
    WHERE d.status = 'archived'${accountScope(sql`h.account_id`, deps.accounts)}
    ORDER BY account_id`);
  const counts = { accounts: 0, trails: 0, ringRows: 0, heads: 0, failed: 0 };
  for (const { account_id: accountId } of accounts) {
    try {
      const purged = await withUnitOfWork(deps.app, systemContext(accountId), () =>
        purgeAccountTelemetry(cutoff),
      );
      counts.accounts += 1;
      counts.trails += purged.trails;
      counts.ringRows += purged.ringRows;
      counts.heads += purged.heads;
    } catch (error) {
      counts.failed += 1;
      deps.logger.warn(
        `Telemetry retention failed for account ${accountId}: ${error instanceof Error ? error.name : 'error'}`,
      );
    }
  }
  return { ran: true, counts };
}
