import { randomBytes } from 'node:crypto';
import type { Pool } from '@eeasy-logistics/db';
import { uuidv7 } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool, listenOnPlatformPool } from '@eeasy-logistics/db/platform';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { KindHandler, RelayRow } from '../../src/modules/kernel/outbox/kind-handlers.js';
import { KindHandlerRegistry } from '../../src/modules/kernel/outbox/kind-handlers.js';
import { nextOutboxId } from '../../src/modules/kernel/outbox/outbox-id.js';
import {
  OutboxQueues,
  outboxJobRetention,
  outboxQueueName,
} from '../../src/modules/kernel/outbox/queues.js';
import type { OutboxKind } from '../../src/modules/kernel/schema/outbox.js';
import type { RelayDependencies } from '../../src/worker/system/outbox-relay.js';
import {
  OutboxRelay,
  countRowsWithoutHandler,
  relayBatch,
  sweepStuckRows,
} from '../../src/worker/system/outbox-relay.js';
import { connectAs, integrationConfig } from './support.js';

// The outbox relay on the real database and Redis (PLAT-8 item C; plan 2.3, 2.12; integrations
// §4.4; data §5.2). Redis keys of this run live under their own prefix and are deleted afterwards.
// The relay here handles one test-only kind, `carrier_call` (no other suite writes it), so suites
// running in parallel on the same database never see their rows moved.

const config = integrationConfig();
const run = randomBytes(4).toString('hex');
const prefix = `elx-test-${run}`;
const lockKey = `${prefix}:lock:outbox-relay`;
const kind: OutboxKind = 'carrier_call';
const perAggregate: KindHandler = {
  kind,
  orderingKey: (row) => row.aggregateId,
  execute: () => Promise.resolve({ outcome: 'done' }),
};
const registry = new KindHandlerRegistry([perAggregate]);
const quiet = { log: () => undefined, warn: () => undefined };
const fast = {
  lockTtlMs: 1_500,
  renewEveryMs: 250,
  safetyMs: 300,
  pollEveryMs: 100,
  sweepEveryMs: 60_000,
};

describe('outbox relay (plan 2.3)', () => {
  const account = uuidv7();
  const suspended = uuidv7();
  let owner: postgres.Sql;
  let pool: Pool<PlatformDatabase>;
  let redis: Redis;
  let queues: OutboxQueues;
  let inspect: Queue;
  const relays: OutboxRelay[] = [];

  const insert = async (
    aggregateId: string,
    sequence: number,
    extra: {
      accountId?: string | null;
      kind?: OutboxKind;
      status?: string;
      enqueuedAgo?: string;
    } = {},
  ) => {
    const id = nextOutboxId();
    await owner`
      INSERT INTO core_outbox (id, type, event_version, account_id, aggregate_type, aggregate_id,
                               sequence, payload, kind, status, enqueued_at)
      VALUES (${id}, 'core.account.suspended', 1,
              ${extra.accountId === undefined ? account : extra.accountId}, 'account',
              ${aggregateId}, ${sequence}, '{"secret":"never in redis"}', ${extra.kind ?? kind},
              ${extra.status ?? 'pending'},
              ${extra.enqueuedAgo === undefined ? null : owner`now() - ${extra.enqueuedAgo}::interval`})`;
    return id;
  };
  const statuses = async (ids: string[]) => {
    const rows = await owner<{ id: string; status: string }[]>`
      SELECT id, status FROM core_outbox WHERE id IN ${owner(ids)}`;
    return ids.map((id) => rows.find((row) => row.id === id)?.status);
  };
  const markDone = (id: string) =>
    owner`UPDATE core_outbox SET status = 'done', done_at = now() WHERE id = ${id}`;
  const relay = (overrides: Partial<RelayDependencies> = {}) => {
    const created = new OutboxRelay({
      db: pool.db,
      queues,
      registry,
      redis,
      listen: (onNotify) => listenOnPlatformPool(pool.db, 'elx_outbox', onNotify),
      batchSize: 500,
      logger: quiet,
      lockKey,
      timings: fast,
      ...overrides,
    });
    relays.push(created);
    return created;
  };

  beforeAll(async () => {
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'outbox-relay-test');
    const url = config.redis.url?.reveal();
    if (url === undefined) throw new Error('The relay suite needs REDIS_URL');
    redis = new Redis(url, { maxRetriesPerRequest: null });
    queues = new OutboxQueues(redis, prefix);
    inspect = new Queue(outboxQueueName(kind), { connection: redis, prefix });
    await owner`
      INSERT INTO core_accounts (id, name, status)
      VALUES (${account}, 'relay', 'active'), (${suspended}, 'relay suspended', 'suspended')`;
  });

  afterEach(async () => {
    await Promise.all(relays.splice(0).map((r) => r.stop()));
    await owner`UPDATE core_outbox SET status = 'done' WHERE kind = ${kind} AND status <> 'done'`;
  });

  afterAll(async () => {
    await owner`DELETE FROM core_outbox WHERE kind = ${kind} OR account_id IN (${account}, ${suspended})`;
    await owner`DELETE FROM core_accounts WHERE id IN (${account}, ${suspended})`;
    await inspect.close();
    await queues.close();
    // Only this run's keys: the shared Redis is never flushed.
    for (const pattern of [`${prefix}:*`]) {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
        cursor = next;
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== '0');
    }
    redis.disconnect();
    await Promise.all([owner.end(), pool.close()]);
  });

  it('enqueues per aggregate in order and holds a row whose predecessor is not done', async () => {
    const x = uuidv7();
    const y = uuidv7();
    const x1 = await insert(x, 1);
    const x2 = await insert(x, 2);
    const x3 = await insert(x, 3);
    const y1 = await insert(y, 1);

    const first = await relayBatch(pool.db, queues, registry, 500);
    expect(await statuses([x1, x2, x3, y1])).toEqual([
      'enqueued',
      'pending',
      'pending',
      'enqueued',
    ]);
    expect(first.relayed).toBeGreaterThanOrEqual(2);

    // x2 waits while x1 is enqueued, not done.
    await relayBatch(pool.db, queues, registry, 500);
    expect(await statuses([x2, x3])).toEqual(['pending', 'pending']);

    await markDone(x1);
    await relayBatch(pool.db, queues, registry, 500);
    expect(await statuses([x2, x3])).toEqual(['enqueued', 'pending']);
    await owner`UPDATE core_outbox SET status = 'dead' WHERE id = ${x2}`; // dead releases too
    await relayBatch(pool.db, queues, registry, 500);
    expect(await statuses([x3])).toEqual(['enqueued']);
  });

  it('orders one change by (sequence, id) and is held by an earlier row that is not yet due', async () => {
    const x = uuidv7();
    const early = await insert(x, 1);
    await owner`UPDATE core_outbox SET next_attempt_at = now() + interval '1 hour' WHERE id = ${early}`;
    const a = await insert(x, 2);
    const b = await insert(x, 2); // same change, written after a
    await relayBatch(pool.db, queues, registry, 500);
    expect(await statuses([early, a, b])).toEqual(['pending', 'pending', 'pending']);
    await markDone(early);
    await relayBatch(pool.db, queues, registry, 500);
    expect(await statuses([a, b])).toEqual(['enqueued', 'pending']);
  });

  it('adds jobs with jobId = row id and data { outboxId } only; a second add is a no-op', async () => {
    const id = await insert(uuidv7(), 1);
    await relayBatch(pool.db, queues, registry, 500);
    const job = await inspect.getJob(id);
    expect(job?.id).toBe(id);
    expect(job?.data).toEqual({ outboxId: id });
    expect(JSON.stringify(job?.data)).not.toContain('secret');
    await queues.add(kind, [id]);
    expect(await inspect.getJobCountByTypes('waiting', 'delayed', 'active')).toBeGreaterThan(0);
    const all = await inspect.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
    expect(all.filter((candidate) => candidate.id === id)).toHaveLength(1);
  });

  it("leaves a suspended account's rows pending, and moves platform-only rows", async () => {
    const held = await insert(uuidv7(), 1, { accountId: suspended });
    const platformOnly = await insert(uuidv7(), 1, { accountId: null });
    await relayBatch(pool.db, queues, registry, 500);
    expect(await statuses([held, platformOnly])).toEqual(['pending', 'enqueued']);
    await owner`UPDATE core_accounts SET status = 'active' WHERE id = ${suspended}`;
    await relayBatch(pool.db, queues, registry, 500);
    expect(await statuses([held])).toEqual(['enqueued']);
    // A closed account's rows are held too (adversary L-2).
    await owner`UPDATE core_accounts SET status = 'closed' WHERE id = ${suspended}`;
    const closed = await insert(uuidv7(), 1, { accountId: suspended });
    await relayBatch(pool.db, queues, registry, 500);
    expect(await statuses([closed])).toEqual(['pending']);
    await owner`UPDATE core_accounts SET status = 'suspended' WHERE id = ${suspended}`;
  });

  it("never holds a row behind another account's row of the same aggregate id (adversary L-3)", async () => {
    const aggregate = uuidv7();
    const foreign = await insert(aggregate, 1, { accountId: suspended });
    const own = await insert(aggregate, 2);
    await relayBatch(pool.db, queues, registry, 500);
    expect(await statuses([foreign, own])).toEqual(['pending', 'enqueued']);
  });

  it('re-adds a job for a pending row whose earlier job finished (adversary M-2)', async () => {
    const id = await insert(uuidv7(), 1);
    await relayBatch(pool.db, queues, registry, 500);
    const workerConnection = new Redis(config.redis.url?.reveal() ?? '', {
      maxRetriesPerRequest: null,
    });
    const worker = new Worker(outboxQueueName(kind), () => Promise.resolve(), {
      connection: workerConnection,
      prefix,
    });
    try {
      await expect
        .poll(async () => (await inspect.getJob(id))?.finishedOn !== undefined, { timeout: 5_000 })
        .toBe(true);
    } finally {
      await worker.close();
      workerConnection.disconnect();
    }
    // As the processor leaves a held row: back to pending, its job completed and retained.
    await owner`UPDATE core_outbox SET status = 'pending', enqueued_at = NULL WHERE id = ${id}`;
    await relayBatch(pool.db, queues, registry, 500);
    expect(await statuses([id])).toEqual(['enqueued']);
    expect(await inspect.getJobState(id)).toBe('waiting');
  });

  it("enqueues a suspended account's internal_event rows and holds its other kinds (lead ruling)", async () => {
    // Real kinds that other suites also write: the double records what the relay would enqueue,
    // then refuses, so the batch rolls back and no other suite's row is ever marked.
    const internal = await insert(uuidv7(), 1, { accountId: suspended, kind: 'internal_event' });
    const webhook = await insert(uuidv7(), 1, { accountId: suspended, kind: 'webhook' });
    const activeWebhook = await insert(uuidv7(), 1, { kind: 'webhook' });
    // One kind per batch, so the one `add` call carries every row the relay would enqueue.
    const offeredFor = async (only: OutboxKind) => {
      const offered = new Set<string>();
      const refusing: RelayDependencies['queues'] = {
        add: (_kind, ids) => {
          for (const id of ids) offered.add(id);
          return Promise.reject(new Error('rolled back on purpose'));
        },
        existingJobs: () => Promise.resolve(new Set()),
      };
      const single = new KindHandlerRegistry([
        {
          kind: only,
          orderingKey: (row: RelayRow) => row.aggregateId,
          execute: () => Promise.resolve({ outcome: 'done' as const }),
        },
      ]);
      await relayBatch(pool.db, refusing, single, 100_000).catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== 'rolled back on purpose') throw error;
      });
      return offered;
    };
    expect((await offeredFor('internal_event')).has(internal)).toBe(true);
    const webhooks = await offeredFor('webhook');
    expect(webhooks.has(activeWebhook)).toBe(true);
    expect(webhooks.has(webhook)).toBe(false);
    expect(await statuses([internal, webhook, activeWebhook])).toEqual([
      'pending',
      'pending',
      'pending',
    ]);
    await owner`UPDATE core_outbox SET status = 'done' WHERE id IN (${internal}, ${webhook}, ${activeWebhook})`;
  });

  it('skips and counts kinds with no handler, never enqueueing them', async () => {
    const before = await countRowsWithoutHandler(pool.db, registry);
    const webhook = await insert(uuidv7(), 1, { kind: 'webhook' });
    await relayBatch(pool.db, queues, registry, 500);
    expect(await statuses([webhook])).toEqual(['pending']);
    expect(await countRowsWithoutHandler(pool.db, registry)).toBeGreaterThanOrEqual(before + 1);
    expect(await countRowsWithoutHandler(pool.db, registry)).toBeGreaterThanOrEqual(1);
    expect(await relayBatch(pool.db, queues, new KindHandlerRegistry(), 500)).toEqual({
      relayed: 0,
      held: 0,
      selected: 0,
    });
    await owner`DELETE FROM core_outbox WHERE id = ${webhook}`;
  });

  it('rolls the marks back when Redis refuses the jobs: the rows stay pending', async () => {
    const id = await insert(uuidv7(), 1);
    const failing = {
      add: () => Promise.reject(new Error('redis down')),
      existingJobs: () => Promise.resolve(new Set<string>()),
    };
    await expect(relayBatch(pool.db, failing, registry, 500)).rejects.toThrow('redis down');
    expect(await statuses([id])).toEqual(['pending']);
  });

  it('sweeps an enqueued row whose job is gone back to pending, and keeps one whose job exists', async () => {
    const lost = await insert(uuidv7(), 1, { status: 'enqueued', enqueuedAgo: '10 minutes' });
    const live = await insert(uuidv7(), 1, { status: 'enqueued', enqueuedAgo: '10 minutes' });
    const recent = await insert(uuidv7(), 1, { status: 'enqueued', enqueuedAgo: '1 minute' });
    await queues.add(kind, [live]);
    expect(await sweepStuckRows(pool.db, queues)).toBeGreaterThanOrEqual(1);
    expect(await statuses([lost, live, recent])).toEqual(['pending', 'enqueued', 'enqueued']);
    const [row] = await owner<{ enqueued_at: Date | null }[]>`
      SELECT enqueued_at FROM core_outbox WHERE id = ${lost}`;
    expect(row?.enqueued_at).toBeNull();
  });

  it('sweeps a batch across kinds in one pass, re-checking each row before returning it', async () => {
    const lost = [
      await insert(uuidv7(), 1, { status: 'enqueued', enqueuedAgo: '10 minutes' }),
      await insert(uuidv7(), 1, { status: 'enqueued', enqueuedAgo: '9 minutes', kind: 'push' }),
    ];
    const live = await insert(uuidv7(), 1, { status: 'enqueued', enqueuedAgo: '8 minutes' });
    // Finished by the worker while the sweeper was checking Redis: must not come back.
    const finished = await insert(uuidv7(), 1, { status: 'enqueued', enqueuedAgo: '7 minutes' });
    const calls: { kind: OutboxKind; ids: string[] }[] = [];
    const racing = {
      add: () => Promise.resolve(),
      existingJobs: async (k: OutboxKind, ids: readonly string[]) => {
        calls.push({ kind: k, ids: [...ids] });
        await markDone(finished);
        return new Set(ids.filter((id) => id === live));
      },
    };
    const returned = await sweepStuckRows(pool.db, racing);
    expect(await statuses([...lost, live, finished])).toEqual([
      'pending',
      'pending',
      'enqueued',
      'done',
    ]);
    expect(returned).toBeGreaterThanOrEqual(2);
    // One existence check per kind, never one per row.
    expect(new Set(calls.map((call) => call.kind)).size).toBe(calls.length);
    expect(calls.find((call) => call.kind === kind)?.ids).toEqual(
      expect.arrayContaining([lost[0], live, finished]),
    );
    await owner`UPDATE core_outbox SET status = 'done' WHERE id = ${lost[1] ?? ''}`;
  });

  it('keeps a row whose job completed and is still retained (no duplicate delivery)', async () => {
    const id = await insert(uuidv7(), 1);
    await relayBatch(pool.db, queues, registry, 500);
    const url = config.redis.url?.reveal() ?? '';
    const workerConnection = new Redis(url, { maxRetriesPerRequest: null });
    const worker = new Worker(outboxQueueName(kind), () => Promise.resolve(), {
      connection: workerConnection,
      prefix,
    });
    try {
      await expect
        .poll(async () => (await inspect.getJob(id))?.finishedOn !== undefined, { timeout: 5_000 })
        .toBe(true);
    } finally {
      await worker.close();
      workerConnection.disconnect();
    }
    const job = await inspect.getJob(id);
    expect(await job?.isCompleted()).toBe(true);
    expect(job?.opts.removeOnComplete).toEqual(outboxJobRetention.removeOnComplete);
    expect(job?.opts.removeOnFail).toEqual(outboxJobRetention.removeOnFail);
    // As if the outcome write had not landed: still enqueued, long ago.
    await owner`UPDATE core_outbox SET enqueued_at = now() - interval '10 minutes' WHERE id = ${id}`;
    expect(await queues.hasJob(kind, id)).toBe(true);
    await sweepStuckRows(pool.db, queues);
    expect(await statuses([id])).toEqual(['enqueued']);
  });

  it('gives the lock back when LISTEN fails right after taking it', async () => {
    const failing = relay({ listen: () => Promise.reject(new Error('listen refused')) });
    await failing.start();
    expect(failing.leading).toBe(false);
    expect(await redis.get(lockKey)).toBeNull();
    await failing.stop(); // its timer would otherwise keep retaking the lock
    const next = relay();
    await next.start();
    expect(next.leading).toBe(true);
  });

  it('runs one leader among two relays; the second never enqueues until the first stops', async () => {
    const one = relay();
    const two = relay();
    await one.start();
    await two.start();
    expect([one.leading, two.leading]).toEqual([true, false]);

    const ids = [await insert(uuidv7(), 1), await insert(uuidv7(), 1)];
    await expect.poll(() => statuses(ids), { timeout: 5_000 }).toEqual(['enqueued', 'enqueued']);
    expect(one.stats.relayed).toBeGreaterThanOrEqual(2);
    expect(two.stats.relayed).toBe(0);
    expect(two.stats.ticks).toBe(0);

    await one.stop(); // releases the lock
    await expect.poll(() => two.leading, { timeout: 5_000 }).toBe(true);
    const later = await insert(uuidv7(), 1);
    await expect.poll(() => statuses([later]), { timeout: 5_000 }).toEqual(['enqueued']);
    expect(two.stats.relayed).toBeGreaterThanOrEqual(1);
    expect(await redis.get(lockKey)).not.toBeNull();
  });

  it('stops relaying when a renewal fails (the lock taken by another holder)', async () => {
    const leader = relay();
    await leader.start();
    expect(leader.leading).toBe(true);
    await redis.set(lockKey, 'someone-else', 'PX', 60_000);
    await expect.poll(() => leader.leading, { timeout: 3_000 }).toBe(false);
    const id = await insert(uuidv7(), 1);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await statuses([id])).toEqual(['pending']);
    expect(await redis.get(lockKey)).toBe('someone-else'); // never released by a non-holder
    await redis.del(lockKey);
  });

  it('wakes on NOTIFY when a row commits, without waiting for the poll', async () => {
    const leader = relay({ timings: { ...fast, pollEveryMs: 60_000 } });
    await leader.start();
    await expect.poll(() => leader.stats.ticks, { timeout: 3_000 }).toBeGreaterThan(0);
    const id = await insert(uuidv7(), 1);
    await expect.poll(() => statuses([id]), { timeout: 3_000 }).toEqual(['enqueued']);
  });
});
