import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '@eeasy-logistics/db';
import { withUnitOfWork } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import type { Locale } from '@eeasy-logistics/i18n/push';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import {
  noShowGraceMs,
  overdueGraceMs,
  redisLatestForget,
  sweepAccountShifts,
} from '../../modules/delivery/public/index.js';
import { AuditWriter } from '../../modules/kernel/audit/audit-writer.js';
import { OutboxWriter } from '../../modules/kernel/outbox/outbox-writer.js';
import { getMetrics } from '../../modules/kernel/telemetry/metrics.js';
import { accountScope, systemContext } from './tenant-runs.js';

// The shift sweeper (DEL-5 plan 2.5, 2.8): every 5 minutes under `elx:lock:shift-sweeper`, the
// accounts with a `planned` shift past its 30-minute grace or an `active` shift are listed on the
// platform pool, with the language of each driver on an active shift (core_users, read there);
// each account's sweep (no-shows, live shifts 60 minutes past their planned end, then stale alerts)
// runs in one tenant transaction on elx_app; an ended shift's latest-position key is deleted after
// that transaction commits.
// The run also stores the `active_shifts` gauge (active and paused, every account).

export const shiftSweeperLockKey = 'elx:lock:shift-sweeper';
export const shiftSweeperIntervalMs = 5 * 60 * 1000;
export const shiftSweeperLockTtlMs = 4 * 60 * 1000;

export interface ShiftSweeperCounts {
  readonly accounts: number;
  readonly noShows: number;
  readonly ended: number;
  readonly stale: number;
  readonly failed: number;
}

export type ShiftSweeperRun =
  { readonly ran: true; readonly counts: ShiftSweeperCounts } | { readonly ran: false };

export interface ShiftSweeperDependencies {
  readonly db: PlatformDatabase;
  readonly app: AppDatabase;
  readonly redis: Pick<Redis, 'set' | 'del'>;
  readonly logger: { warn(message: string): void };
  readonly now?: () => Date;
  readonly lockKey?: string;
  /** Only these accounts (tests); every account otherwise. */
  readonly accounts?: readonly string[];
}

/** One scheduled run: takes the lock (`SET NX PX`, 4 min), sweeps account by account. */
export async function runShiftSweeper(deps: ShiftSweeperDependencies): Promise<ShiftSweeperRun> {
  const lock = deps.lockKey ?? shiftSweeperLockKey;
  const acquired = await deps.redis.set(lock, randomUUID(), 'PX', shiftSweeperLockTtlMs, 'NX');
  if (acquired !== 'OK') return { ran: false };
  const now = deps.now?.() ?? new Date();
  const runId = randomUUID();

  const live = await deps.db.execute<{ status: string; n: number }>(sql`
    SELECT status, count(*)::int AS n FROM del_driver_shifts
    WHERE status IN ('active', 'paused') GROUP BY status`);
  const metrics = getMetrics();
  for (const status of ['active', 'paused']) {
    metrics.set('active_shifts', live.find((row) => row.status === status)?.n ?? 0, { status });
  }

  const overdue = new Date(now.getTime() - overdueGraceMs).toISOString();
  const accounts = await deps.db.execute<{ account_id: string }>(sql`
    SELECT DISTINCT account_id FROM del_driver_shifts
    WHERE (status = 'active'
           OR (status = 'paused' AND planned_end <= ${overdue}::timestamptz)
           OR (status = 'planned'
               AND planned_start <= ${new Date(now.getTime() - noShowGraceMs).toISOString()}::timestamptz))
      ${accountScope(sql`account_id`, deps.accounts)}
    ORDER BY account_id`);
  const counts = { accounts: 0, noShows: 0, ended: 0, stale: 0, failed: 0 };
  const writers = {
    audit: new AuditWriter(),
    outbox: new OutboxWriter(),
    fanout: redisLatestForget(deps.redis),
  };
  for (const { account_id: accountId } of accounts) {
    try {
      const languages = await deps.db.execute<{ driver_id: string; locale: Locale }>(sql`
        SELECT s.driver_id, u.locale FROM del_driver_shifts s
        JOIN del_drivers d ON d.id = s.driver_id
        JOIN core_users u ON u.id = d.user_id
        WHERE s.account_id = ${accountId} AND s.status = 'active'`);
      const locales = new Map(languages.map((row) => [row.driver_id, row.locale] as const));
      const swept = await withUnitOfWork(deps.app, systemContext(accountId), () =>
        sweepAccountShifts(writers, { now, runId, locales }),
      );
      counts.accounts += 1;
      counts.noShows += swept.noShows;
      counts.ended += swept.ended;
      counts.stale += swept.stale;
    } catch (error) {
      counts.failed += 1;
      deps.logger.warn(
        `Shift sweep failed for account ${accountId}: ${error instanceof Error ? error.name : 'error'}`,
      );
    }
  }
  return { ran: true, counts };
}
