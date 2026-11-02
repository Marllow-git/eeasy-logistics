import { randomBytes } from 'node:crypto';
import type { Pool } from '@eeasy-logistics/db';
import { uuidv7 } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type {
  KindHandler,
  KindOutcome,
  OutboxRow,
} from '../../src/modules/kernel/outbox/kind-handlers.js';
import { KindHandlerRegistry } from '../../src/modules/kernel/outbox/kind-handlers.js';
import { nextOutboxId } from '../../src/modules/kernel/outbox/outbox-id.js';
import { OutboxQueues, outboxQueueName } from '../../src/modules/kernel/outbox/queues.js';
import type { OutboxKind } from '../../src/modules/kernel/schema/outbox.js';
import { OutboxWorkers } from '../../src/worker/system/outbox-workers.js';
import { connectAs, integrationConfig } from './support.js';

// The outbox queue workers on the real database and Redis (PLAT-8 item D; plan 2.4, 2.9). Redis
// keys of this run live under their own prefix and are deleted afterwards. The workers here
// consume one kind no suite relays, `webhook`, through a test handler (INT-4: `push` has a real
// handler now, and the push suite relays its pending rows).

const config = integrationConfig();
const run = randomBytes(4).toString('hex');
const prefix = `elx-test-${run}`;
const kind: OutboxKind = 'webhook';
const quiet = { log: () => undefined, warn: () => undefined };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('outbox queue workers (plan 2.4, 2.9)', () => {
  const account = uuidv7();
  let owner: postgres.Sql;
  let pool: Pool<PlatformDatabase>;
  let redis: Redis;
  let queues: OutboxQueues;
  let inspect: Queue;
  const started: OutboxWorkers[] = [];

  /** The test handler: records what it was given, waits `delayMs`, answers `outcome`. */
  const handler = (delayMs = 0, outcome: KindOutcome = { outcome: 'done' }) => {
    const seen: OutboxRow[] = [];
    const h: KindHandler = {
      kind,
      orderingKey: () => null,
      execute: async (row) => {
        seen.push(row);
        if (delayMs > 0) await sleep(delayMs);
        return outcome;
      },
    };
    return { h, seen };
  };
  const workers = (h: KindHandler) => {
    const created = new OutboxWorkers({
      db: pool.db,
      connection: redis,
      registry: new KindHandlerRegistry([h]),
      logger: quiet,
      prefix,
    });
    created.start();
    started.push(created);
    return created;
  };
  const insert = async (status = 'enqueued') => {
    const id = nextOutboxId();
    await owner`
      INSERT INTO core_outbox (id, type, event_version, account_id, aggregate_type, aggregate_id,
                               sequence, payload, kind, status, enqueued_at)
      VALUES (${id}, 'core.account.suspended', 1, ${account}, 'account', ${uuidv7()}, 1,
              '{"secret":"never in redis"}', ${kind}, ${status},
              ${status === 'pending' ? null : owner`now()`})`;
    return id;
  };
  const status = async (id: string) =>
    (await owner<{ status: string }[]>`SELECT status FROM core_outbox WHERE id = ${id}`)[0]?.status;
  const until = async (check: () => Promise<boolean>, ms = 5_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return;
      await sleep(25);
    }
    throw new Error('timed out');
  };

  beforeAll(async () => {
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'outbox-workers-test');
    const url = config.redis.url?.reveal();
    if (url === undefined) throw new Error('The workers suite needs REDIS_URL');
    redis = new Redis(url, { maxRetriesPerRequest: null });
    queues = new OutboxQueues(redis, prefix);
    inspect = new Queue(outboxQueueName(kind), { connection: redis, prefix });
    await owner`INSERT INTO core_accounts (id, name, status) VALUES (${account}, 'workers', 'active')`;
  });

  afterEach(async () => {
    await Promise.all(started.splice(0).map((w) => w.close(5_000)));
  });

  afterAll(async () => {
    await owner`DELETE FROM core_outbox WHERE account_id = ${account}`;
    await owner`DELETE FROM core_accounts WHERE id = ${account}`;
    await inspect.close();
    await queues.close();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
    redis.disconnect();
    await Promise.all([owner.end(), pool.close()]);
  });

  it('runs a job carrying { outboxId } only: the worker re-reads the row and writes the outcome', async () => {
    const { h, seen } = handler();
    workers(h);
    const id = await insert('enqueued');
    await queues.add(kind, [id]);
    await until(async () => (await status(id)) === 'done');
    const job = await inspect.getJob(id);
    expect(job?.data).toEqual({ outboxId: id });
    expect(JSON.stringify(job?.data)).not.toContain('never in redis');
    // The handler got the whole row from the database, payload included.
    expect(seen.map((row) => [row.id, row.payload])).toEqual([[id, { secret: 'never in redis' }]]);
    // Completed after the row was written: a completed job means the row left `enqueued`.
    expect(await job?.getState()).toBe('completed');
    expect(job?.returnvalue).toBe('done');
  });

  it('accepts a job whose row is still pending (jobs are added before the batch commits)', async () => {
    const { h, seen } = handler();
    workers(h);
    const id = await insert('pending');
    await queues.add(kind, [id]);
    await until(async () => (await status(id)) === 'done');
    expect(seen).toHaveLength(1);
  });

  it('skips a row that is no longer pending or enqueued, and a job for a missing row', async () => {
    const { h, seen } = handler();
    workers(h);
    const finished = await insert('superseded');
    const missing = nextOutboxId();
    await queues.add(kind, [finished, missing]);
    await until(async () => {
      const states = await Promise.all([finished, missing].map((id) => inspect.getJobState(id)));
      return states.every((state) => state === 'completed');
    });
    expect(seen).toHaveLength(0);
    expect(await status(finished)).toBe('superseded');
    expect((await inspect.getJob(finished))?.returnvalue).toBe('skipped');
  });

  it('drains on shutdown: close waits for a slow job, which writes its outcome first', async () => {
    const { h, seen } = handler(1_000);
    const w = workers(h);
    const id = await insert();
    await queues.add(kind, [id]);
    await until(() => Promise.resolve(seen.length === 1));
    const startedAt = Date.now();
    expect(await w.close(5_000)).toBe(true);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(500);
    expect(await status(id)).toBe('done');
    expect(await inspect.getJobState(id)).toBe('completed');
  });

  it('leaves a job the grace cut short: the row stays enqueued for a stalled re-run or the sweeper', async () => {
    const { h, seen } = handler(1_500);
    const w = workers(h);
    const id = await insert();
    await queues.add(kind, [id]);
    await until(() => Promise.resolve(seen.length === 1));
    const startedAt = Date.now();
    expect(await w.close(200)).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(await status(id)).toBe('enqueued');
    // Let the cut-short handler end before the suite closes the pool.
    await until(async () => (await status(id)) === 'done', 5_000);
  });
});
