import { randomUUID } from 'node:crypto';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

// The outbox pruning job (PLAT-8 plan 2.8; data §5.2, §5.3): a daily cross-tenant system job on the
// elx_platform pool. `done` and `superseded` rows go after 7 days, `dead` rows after 30, consumer
// receipts after 35 (longer than the dead-row window, so a replayable event still finds its
// receipts) and dead letters after 30, each in batches of 5,000 (one short statement per batch).
// `pending` and `enqueued` rows are never touched, whatever their age. A Redis lock lets one worker
// a day run it.

export const pruneLockKey = 'elx:lock:outbox-prune';
/** Held for 23 hours and never released early: at most one run a day across workers. */
export const pruneLockTtlMs = 23 * 60 * 60 * 1000;
export const pruneIntervalMs = 24 * 60 * 60 * 1000;
export const pruneBatchSize = 5_000;

/** The retention windows in days (data §5.2, §5.3). */
export const pruneWindows = {
  finished: 7,
  dead: 30,
  receipts: 35,
  deadLetters: 30,
} as const;

export interface PruneCounts {
  /** `done` and `superseded` rows. */
  readonly finished: number;
  readonly dead: number;
  readonly receipts: number;
  readonly deadLetters: number;
}

const olderThan = (days: number): SQL => sql`now() - make_interval(days => ${days})`;

/** Deletes in batches until a batch comes back short; returns the total. */
async function inBatches(
  db: PlatformDatabase,
  batch: (limit: number) => SQL,
  batchSize: number,
): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await db.execute(batch(batchSize));
    total += deleted.length;
    if (deleted.length < batchSize) return total;
  }
}

/** One pruning pass over the four tables. */
export async function pruneOutbox(
  db: PlatformDatabase,
  batchSize: number = pruneBatchSize,
): Promise<PruneCounts> {
  const outboxRows = (statuses: SQL, days: number) => (limit: number) => sql`
    DELETE FROM core_outbox WHERE id IN (
      SELECT id FROM core_outbox
      WHERE status IN (${statuses}) AND created_at < ${olderThan(days)}
      LIMIT ${limit})
    RETURNING id`;
  const finished = await inBatches(
    db,
    outboxRows(sql`'done', 'superseded'`, pruneWindows.finished),
    batchSize,
  );
  const dead = await inBatches(db, outboxRows(sql`'dead'`, pruneWindows.dead), batchSize);
  const receipts = await inBatches(
    db,
    (limit) => sql`
      DELETE FROM core_consumer_receipts WHERE (consumer, event_id) IN (
        SELECT consumer, event_id FROM core_consumer_receipts
        WHERE processed_at < ${olderThan(pruneWindows.receipts)}
        LIMIT ${limit})
      RETURNING event_id`,
    batchSize,
  );
  const deadLetters = await inBatches(
    db,
    (limit) => sql`
      DELETE FROM core_consumer_dead_letters WHERE id IN (
        SELECT id FROM core_consumer_dead_letters
        WHERE created_at < ${olderThan(pruneWindows.deadLetters)}
        LIMIT ${limit})
      RETURNING id`,
    batchSize,
  );
  return { finished, dead, receipts, deadLetters };
}

export type PruneRun =
  { readonly ran: true; readonly counts: PruneCounts } | { readonly ran: false };

/**
 * One scheduled run: takes the lock (`SET NX PX`, 23 h, never released early) and prunes; another
 * worker holding the lock means skip.
 */
export async function runOutboxPrune(
  db: PlatformDatabase,
  redis: Pick<Redis, 'set'>,
  lockKey: string = pruneLockKey,
): Promise<PruneRun> {
  const acquired = await redis.set(lockKey, randomUUID(), 'PX', pruneLockTtlMs, 'NX');
  if (acquired !== 'OK') return { ran: false };
  return { ran: true, counts: await pruneOutbox(db) };
}
