import { randomBytes } from 'node:crypto';
import type { Pool } from '@eeasy-logistics/db';
import { uuidv7 } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import { DelayedError, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditWriter } from '../../src/modules/kernel/audit/audit-writer.js';
import type { ConnectionParker } from '../../src/modules/kernel/outbox/connection-parker.js';
import type { KindHandler, KindOutcome } from '../../src/modules/kernel/outbox/kind-handlers.js';
import { KindHandlerRegistry } from '../../src/modules/kernel/outbox/kind-handlers.js';
import { nextOutboxId } from '../../src/modules/kernel/outbox/outbox-id.js';
import { ProviderFailure } from '../../src/modules/kernel/outbox/provider-failure.js';
import { OutboxQueues, outboxQueueName } from '../../src/modules/kernel/outbox/queues.js';
import {
  StorageLifecycleHandler,
  storageAuditAction,
} from '../../src/modules/kernel/outbox/storage-lifecycle.handler.js';
import { StubObjectStorage } from '../../src/modules/kernel/storage/object-storage.js';
import type { OutboxKind } from '../../src/modules/kernel/schema/outbox.js';
import type { OutboxJob } from '../../src/worker/system/outbox-workers.js';
import { OutboxWorkers, processOutboxJob } from '../../src/worker/system/outbox-workers.js';
import { connectAs, integrationConfig } from './support.js';

// Outcome write-back on the real database (PLAT-8 item E; plan 2.5, 2.12; integrations §4.2,
// §4.4). Rows of the test-only kind `message` (no other suite writes it) are executed through the
// processor directly, one through a real worker to see the job delayed in Redis.

const config = integrationConfig();
const prefix = `elx-test-${randomBytes(4).toString('hex')}`;
const kind: OutboxKind = 'message';
const quiet = { log: () => undefined, warn: () => undefined };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Stored {
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: Date;
  done_at: Date | null;
}

describe('outbox outcomes (plan 2.5)', () => {
  const account = uuidv7();
  let owner: postgres.Sql;
  let pool: Pool<PlatformDatabase>;

  const insert = async (rowKind: OutboxKind = kind, attempts = 0, payload: object = {}) => {
    const id = nextOutboxId();
    await owner`
      INSERT INTO core_outbox (id, type, event_version, account_id, aggregate_type, aggregate_id,
                               sequence, payload, kind, status, attempts, enqueued_at)
      VALUES (${id}, 'core.account.suspended', 1, ${account}, 'account', ${uuidv7()}, 1,
              ${owner.json(payload as postgres.JSONValue)}, ${rowKind}, 'enqueued', ${attempts}, now())`;
    return id;
  };
  const stored = async (id: string) =>
    (
      await owner<Stored[]>`
        SELECT status, attempts, last_error, next_attempt_at, done_at
        FROM core_outbox WHERE id = ${id}`
    )[0];
  const answering = (answer: () => Promise<KindOutcome>): KindHandler => ({
    kind,
    orderingKey: () => null,
    execute: answer,
  });
  const fakeJob = (outboxId: string) => {
    const moveToDelayed = vi.fn((_at: number, _token?: string) => Promise.resolve());
    return { job: { data: { outboxId }, moveToDelayed } as unknown as OutboxJob, moveToDelayed };
  };
  const runJob = (
    handler: KindHandler,
    outboxId: string,
    extra: { parker?: ConnectionParker } = {},
  ) => {
    const { job, moveToDelayed } = fakeJob(outboxId);
    const deps = {
      db: pool.db,
      registry: new KindHandlerRegistry([handler]),
      logger: quiet,
      random: () => 0.5,
      ...extra,
    };
    return { result: processOutboxJob(deps, handler.kind, job, 'token'), moveToDelayed };
  };

  beforeAll(async () => {
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'outbox-outcomes-test');
    await owner`INSERT INTO core_accounts (id, name, status) VALUES (${account}, 'outcomes', 'active')`;
  });

  afterAll(async () => {
    await owner`DELETE FROM core_outbox WHERE account_id = ${account}`;
    // The account keeps its audit rows (FK, K-7): it is left, like the audit suites do.
    await Promise.all([owner.end(), pool.close()]);
  });

  it('done: the row is done with done_at', async () => {
    const id = await insert();
    const { result } = runJob(
      answering(() => Promise.resolve({ outcome: 'done' })),
      id,
    );
    expect(await result).toBe('done');
    expect(await stored(id)).toMatchObject({ status: 'done', attempts: 0 });
    expect((await stored(id))?.done_at).not.toBeNull();
  });

  it('superseded: the row is superseded with the reason', async () => {
    const id = await insert();
    const { result } = runJob(
      answering(() => Promise.resolve({ outcome: 'superseded', reason: 'order delivered' })),
      id,
    );
    expect(await result).toBe('superseded');
    expect(await stored(id)).toMatchObject({ status: 'superseded', last_error: 'order delivered' });
  });

  it('retry: one attempt consumed, next_attempt_at on the schedule, the job moved to delayed', async () => {
    const id = await insert();
    const before = Date.now();
    const { result, moveToDelayed } = runJob(
      answering(() => Promise.reject(new ProviderFailure('transient', 'gateway', { status: 502 }))),
      id,
    );
    await expect(result).rejects.toBeInstanceOf(DelayedError);
    const row = await stored(id);
    expect(row).toMatchObject({ status: 'enqueued', attempts: 1, last_error: '502 gateway' });
    // message: first step 15 s, half of it with the pinned jitter.
    const delay = (row?.next_attempt_at.getTime() ?? 0) - before;
    expect(delay).toBeGreaterThanOrEqual(7_000);
    expect(delay).toBeLessThan(9_000);
    expect(moveToDelayed).toHaveBeenCalledWith(row?.next_attempt_at.getTime(), 'token');
  });

  it('rate_limited: reschedules at retry_after_s and keeps the attempt count', async () => {
    const id = await insert(kind, 2);
    const before = Date.now();
    const { result } = runJob(
      answering(() =>
        Promise.reject(
          new ProviderFailure('rate_limited', 'Too Many Requests', {
            status: 429,
            retryAfterS: 120,
          }),
        ),
      ),
      id,
    );
    await expect(result).rejects.toBeInstanceOf(DelayedError);
    const row = await stored(id);
    expect(row).toMatchObject({
      status: 'enqueued',
      attempts: 2,
      last_error: '429 Too Many Requests',
    });
    const delay = (row?.next_attempt_at.getTime() ?? 0) - before;
    expect(delay).toBeGreaterThanOrEqual(119_000);
    expect(delay).toBeLessThan(122_000);
  });

  it('unauthorised: the connection parker is called, retry in an hour, no attempt consumed', async () => {
    const id = await insert(kind, 1);
    const park = vi.fn(() => Promise.resolve());
    const before = Date.now();
    const { result } = runJob(
      answering(() =>
        Promise.reject(
          new ProviderFailure('unauthorised', 'token revoked', { status: 401, connectionId: 'c1' }),
        ),
      ),
      id,
      { parker: { park } },
    );
    await expect(result).rejects.toBeInstanceOf(DelayedError);
    expect(park).toHaveBeenCalledTimes(1);
    const row = await stored(id);
    expect(row).toMatchObject({ status: 'enqueued', attempts: 1 });
    expect((row?.next_attempt_at.getTime() ?? 0) - before).toBeGreaterThanOrEqual(3_599_000);
  });

  it('dead after the budget: the 5th failure of a message, no further delay', async () => {
    const id = await insert(kind, 4);
    const { result, moveToDelayed } = runJob(
      answering(() =>
        Promise.reject(new ProviderFailure('transient', 'still down', { status: 503 })),
      ),
      id,
    );
    expect(await result).toBe('dead');
    expect(await stored(id)).toMatchObject({
      status: 'dead',
      attempts: 5,
      last_error: '503 still down',
    });
    expect(moveToDelayed).not.toHaveBeenCalled();
  });

  it('dead at once on a permanent failure; last_error is redacted, never the payload', async () => {
    const id = await insert(kind, 0, { phone: '+966500000000' });
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln';
    const { result } = runJob(
      answering(() =>
        Promise.reject(
          new ProviderFailure(
            'permanent',
            `invalid number; Authorization: Bearer ${jwt} api_key=abc`,
            {
              status: 400,
            },
          ),
        ),
      ),
      id,
    );
    expect(await result).toBe('dead');
    const lastError = (await stored(id))?.last_error ?? '';
    expect(lastError.startsWith('400 invalid number;')).toBe(true);
    for (const secret of [jwt, 'api_key=abc', '+966500000000'])
      expect(lastError).not.toContain(secret);
  });

  it('a row finished elsewhere meanwhile is left alone', async () => {
    const id = await insert();
    const { result } = runJob(
      answering(async () => {
        await owner`UPDATE core_outbox SET status = 'done', done_at = now() WHERE id = ${id}`;
        return { outcome: 'dead', error: { message: 'late' } };
      }),
      id,
    );
    expect(await result).toBe('skipped');
    expect(await stored(id)).toMatchObject({ status: 'done', last_error: null });
  });

  it('a retry through a real worker leaves the job delayed in Redis and the row enqueued', async () => {
    const url = config.redis.url?.reveal();
    if (url === undefined) throw new Error('This test needs REDIS_URL');
    const redis = new Redis(url, { maxRetriesPerRequest: null });
    const queues = new OutboxQueues(redis, prefix);
    const inspect = new Queue(outboxQueueName(kind), { connection: redis, prefix });
    const workers = new OutboxWorkers({
      db: pool.db,
      connection: redis,
      registry: new KindHandlerRegistry([
        answering(() =>
          Promise.reject(new ProviderFailure('rate_limited', 'later', { retryAfterS: 600 })),
        ),
      ]),
      logger: quiet,
      prefix,
    });
    try {
      workers.start();
      const id = await insert();
      await queues.add(kind, [id]);
      const end = Date.now() + 5_000;
      while ((await inspect.getJobState(id)) !== 'delayed' && Date.now() < end) await sleep(25);
      expect(await inspect.getJobState(id)).toBe('delayed');
      expect(await stored(id)).toMatchObject({ status: 'enqueued', attempts: 0 });
      // Present in Redis, so the sweeper leaves the row alone.
      expect(await queues.hasJob(kind, id)).toBe(true);
    } finally {
      await workers.close(5_000);
      await inspect.close();
      await queues.close();
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 500);
        cursor = next;
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== '0');
      redis.disconnect();
    }
  });

  it('storage_lifecycle: deletes through the stub and audits the executed batch', async () => {
    const storage = new StubObjectStorage('ci');
    const handler = new StorageLifecycleHandler(storage, new AuditWriter(pool));
    const keys = [`acc/${account}/exports/1`, `acc/${account}/imports/2.csv`];
    const id = await insert('storage_lifecycle', 0, { keys });
    const { result } = runJob(handler, id);
    expect(await result).toBe('done');
    expect(storage.deleted).toEqual(keys);
    const audit = await owner<
      {
        action: string;
        actor_type: string;
        account_id: string;
        request_id: string;
        after: unknown;
      }[]
    >`
      SELECT action, actor_type, account_id, request_id, after FROM core_audit_log
      WHERE target_type = 'outbox_row' AND target_id = ${id}`;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: storageAuditAction,
      actor_type: 'system',
      account_id: account,
      request_id: id,
      after: { count: 2, objects: [...keys].sort() },
    });
  });

  it("storage_lifecycle: another account's key kills the row; nothing deleted or audited", async () => {
    const storage = new StubObjectStorage('ci');
    const handler = new StorageLifecycleHandler(storage, new AuditWriter(pool));
    const id = await insert('storage_lifecycle', 0, { keys: [`acc/${uuidv7()}/proofs/x`] });
    const { result } = runJob(handler, id);
    expect(await result).toBe('dead');
    expect(storage.deleted).toEqual([]);
    expect((await stored(id))?.last_error).toMatch(/^invalid_batch /);
    const audit = await owner`SELECT 1 FROM core_audit_log WHERE target_id = ${id}`;
    expect(audit).toHaveLength(0);
  });
});
