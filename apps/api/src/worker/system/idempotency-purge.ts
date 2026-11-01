import { randomUUID } from 'node:crypto';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { coreIdempotencyKeys } from '../../modules/kernel/schema/idempotency-keys.js';

// The idempotency purge (PLAT-6 plan 2.9; data §5.1; K-9): a cross-tenant system job on the
// elx_platform pool. Until PLAT-8 brings BullMQ schedulers, `--role worker` runs it hourly; a Redis
// lock lets one worker in the hour run it, so two workers do not race.

export const purgeLockKey = 'elx:lock:idempotency-purge';
export const purgeLockTtlMs = 55 * 60 * 1000;
export const purgeIntervalMs = 60 * 60 * 1000;
export const purgeBatchSize = 10_000;

/**
 * Deletes every row past `expires_at`, `batchSize` rows per statement through the worker-scan index
 * (each batch its own short transaction, so the purge never holds a long lock). Returns the count.
 */
export async function purgeIdempotencyKeys(
  db: PlatformDatabase,
  batchSize: number = purgeBatchSize,
): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await db.execute<{ id: string }>(sql`
      DELETE FROM ${coreIdempotencyKeys}
      WHERE ${coreIdempotencyKeys.id} IN (
        SELECT ${coreIdempotencyKeys.id} FROM ${coreIdempotencyKeys}
        WHERE ${coreIdempotencyKeys.expiresAt} < now()
        ORDER BY ${coreIdempotencyKeys.expiresAt}
        LIMIT ${batchSize})
      RETURNING ${coreIdempotencyKeys.id}`);
    total += deleted.length;
    if (deleted.length < batchSize) return total;
  }
}

export type PurgeRun = { readonly ran: true; readonly deleted: number } | { readonly ran: false };

/**
 * One scheduled run: takes the lock (`SET NX PX`, 55 min, never released early, so at most one run
 * per hour across workers) and purges; another worker holding the lock means skip.
 */
export async function runIdempotencyPurge(
  db: PlatformDatabase,
  redis: Pick<Redis, 'set'>,
  lockKey: string = purgeLockKey,
): Promise<PurgeRun> {
  const acquired = await redis.set(lockKey, randomUUID(), 'PX', purgeLockTtlMs, 'NX');
  if (acquired !== 'OK') return { ran: false };
  return { ran: true, deleted: await purgeIdempotencyKeys(db) };
}
