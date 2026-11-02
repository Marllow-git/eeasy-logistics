import { randomBytes } from 'node:crypto';
import type { Pool } from '@eeasy-logistics/db';
import { uuidv7 } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import { DelayedError } from 'bullmq';
import { Redis } from 'ioredis';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditWriter } from '../../src/modules/kernel/audit/audit-writer.js';
import { KindHandlerRegistry } from '../../src/modules/kernel/outbox/kind-handlers.js';
import { ProviderFailure } from '../../src/modules/kernel/outbox/provider-failure.js';
import type { PushSender } from '../../src/modules/kernel/push/push-sender.js';
import { getMetrics } from '../../src/modules/kernel/telemetry/metrics.js';
import { pushTicketsPurgedAction, runPushReceipts } from '../../src/worker/system/push-receipts.js';
import { nextOutboxId } from '../../src/modules/kernel/outbox/outbox-id.js';
import { OutboxQueues } from '../../src/modules/kernel/outbox/queues.js';
import { pushTicketWriter } from '../../src/modules/kernel/platform/push-tickets.repository.js';
import type { PushTokenInvalidation } from '../../src/modules/kernel/push/invalidations.js';
import { PushTokenInvalidations } from '../../src/modules/kernel/push/invalidations.js';
import { PushKindHandler } from '../../src/modules/kernel/push/push.handler.js';
import { RecorderPushSender } from '../../src/modules/kernel/push/recorder-push-sender.js';
import { relayBatch } from '../../src/worker/system/outbox-relay.js';
import type { OutboxJob } from '../../src/worker/system/outbox-workers.js';
import { OutboxWorkers, processOutboxJob } from '../../src/worker/system/outbox-workers.js';
import { connectAs, integrationConfig } from './support.js';

// INT-4 item C (plan 2.3, 2.8, 2.10): `push` rows on the real database and Redis, through the
// relay and the queue workers with the recorder. This is the only suite that writes `push` rows,
// so its relay batches see only its own. Redis keys live under a per-run prefix.

const config = integrationConfig();
const prefix = `elx-test-${randomBytes(4).toString('hex')}`;
const quiet = { log: () => undefined, warn: () => undefined };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const token = (label: string) => `ExponentPushToken[${label}-${randomBytes(6).toString('hex')}]`;

interface Stored {
  status: string;
  attempts: number;
  deferrals: number;
  last_error: string | null;
  next_attempt_at: Date;
}

describe('push delivery (INT-4 plan 2.3)', () => {
  const account = uuidv7();
  let owner: postgres.Sql;
  let pool: Pool<PlatformDatabase>;
  let redis: Redis;
  let queues: OutboxQueues;
  let recorder: RecorderPushSender;
  let invalidated: PushTokenInvalidation[];
  let handler: PushKindHandler;
  const started: OutboxWorkers[] = [];

  const offerRow = (devices: { device_id: string; push_token: string }[], expiresInS = 300) => {
    const offer = uuidv7();
    return {
      driver_id: uuidv7(),
      template: 'offer_received',
      params: { expires_in_min: '5' },
      locale: 'en',
      data: { kind: 'offer', offer_id: offer, route: `eeasydriver://offers/${offer}` },
      ttl_s: 600,
      collapse_id: `offer:${offer}`,
      expires_at: new Date(Date.now() + expiresInS * 1000).toISOString(),
      devices,
    };
  };
  const insert = async (payload: object, status = 'pending') => {
    const id = nextOutboxId();
    await owner`
      INSERT INTO core_outbox (id, type, event_version, account_id, aggregate_type, aggregate_id,
                               sequence, payload, kind, status, enqueued_at)
      VALUES (${id}, 'delivery.order.offered', 1, ${account}, 'offer', ${uuidv7()}, 1,
              ${owner.json(payload as postgres.JSONValue)}, 'push', ${status},
              ${status === 'pending' ? null : owner`now()`})`;
    return id;
  };
  const stored = async (id: string) =>
    (
      await owner<Stored[]>`
        SELECT status, attempts, deferrals, last_error, next_attempt_at
        FROM core_outbox WHERE id = ${id}`
    )[0];
  const ticketsOf = (id: string) =>
    owner<{ device_id: string; ticket_id: string; status: string; account_id: string }[]>`
      SELECT device_id, ticket_id, status, account_id FROM core_push_tickets
      WHERE outbox_id = ${id} ORDER BY device_id`;
  const waitFor = async (check: () => Promise<boolean>, ms = 10_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return;
      await sleep(25);
    }
    throw new Error('timed out');
  };
  const runJob = (id: string) => {
    const moveToDelayed = vi.fn((_at: number, _token?: string) => Promise.resolve());
    const job = { data: { outboxId: id }, moveToDelayed } as unknown as OutboxJob;
    const deps = {
      db: pool.db,
      registry: new KindHandlerRegistry([handler]),
      logger: quiet,
      random: () => 0.5,
    };
    return { result: processOutboxJob(deps, 'push', job, 'token'), moveToDelayed };
  };

  beforeAll(async () => {
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'push-delivery-test');
    const url = config.redis.url?.reveal();
    if (url === undefined) throw new Error('The push suite needs REDIS_URL');
    redis = new Redis(url, { maxRetriesPerRequest: null });
    queues = new OutboxQueues(redis, prefix);
    await owner`INSERT INTO core_accounts (id, name, status) VALUES (${account}, 'push', 'active')`;
  });

  afterEach(async () => {
    await Promise.all(started.splice(0).map((w) => w.close(5_000)));
  });

  afterAll(async () => {
    await owner`DELETE FROM core_push_tickets WHERE account_id = ${account}`;
    await owner`DELETE FROM core_outbox WHERE account_id = ${account}`;
    await owner`DELETE FROM core_accounts WHERE id = ${account}`;
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

  const fresh = () => {
    recorder = new RecorderPushSender();
    invalidated = [];
    const invalidations = new PushTokenInvalidations(quiet);
    invalidations.register((i) => {
      invalidated.push(i);
      return Promise.resolve();
    });
    handler = new PushKindHandler({
      sender: recorder,
      tickets: pushTicketWriter(pool.db),
      invalidations,
      logger: quiet,
    });
  };

  it('relays a row with two devices, executes it through the queue worker, keeps two tickets', async () => {
    fresh();
    const registry = new KindHandlerRegistry([handler]);
    const workers = new OutboxWorkers({
      db: pool.db,
      connection: redis,
      registry,
      logger: quiet,
      prefix,
    });
    workers.start();
    started.push(workers);
    const devices = [
      { device_id: uuidv7(), push_token: token('a') },
      { device_id: uuidv7(), push_token: token('b') },
    ];
    const id = await insert(offerRow(devices));
    const batch = await relayBatch(pool.db, queues, registry, 500);
    expect(batch.relayed).toBeGreaterThanOrEqual(1);
    await waitFor(async () => (await stored(id))?.status === 'done');
    expect(recorder.tokens).toEqual(devices.map((d) => d.push_token));
    expect(recorder.messages[0]).toMatchObject({
      title: 'New delivery offer',
      body: 'You have a new offer. Minutes left to accept: 5',
      channelId: 'offers',
      data: { kind: 'offer', push_id: id },
    });
    const tickets = await ticketsOf(id);
    expect(tickets).toHaveLength(2);
    expect(tickets.map((t) => t.device_id).sort()).toEqual(devices.map((d) => d.device_id).sort());
    expect(tickets.every((t) => t.status === 'pending' && t.account_id === account)).toBe(true);
    expect(invalidated).toEqual([]);
  });

  it('hands a planted DeviceNotRegistered ticket to the registry once; the row is still done', async () => {
    fresh();
    const gone = { device_id: uuidv7(), push_token: token('gone') };
    const kept = { device_id: uuidv7(), push_token: token('kept') };
    recorder.planTicketError(gone.push_token);
    const id = await insert(offerRow([kept, gone]), 'enqueued');
    expect(await runJob(id).result).toBe('done');
    expect(await stored(id)).toMatchObject({ status: 'done', last_error: null });
    expect(invalidated).toEqual([
      { accountId: account, deviceId: gone.device_id, reason: 'device_not_registered' },
    ]);
    expect((await ticketsOf(id)).map((t) => t.device_id)).toEqual([kept.device_id]);
  });

  it('leaves a rate-limited row waiting at Retry-After with its attempts unchanged', async () => {
    fresh();
    recorder.rateLimitNextSend(90);
    const id = await insert(
      offerRow([{ device_id: uuidv7(), push_token: token('r') }]),
      'enqueued',
    );
    const before = Date.now();
    const { result, moveToDelayed } = runJob(id);
    await expect(result).rejects.toBeInstanceOf(DelayedError);
    const row = await stored(id);
    // A retry keeps the row `enqueued` with its job delayed (PLAT-8 plan 2.5): not relayed again.
    expect(row).toMatchObject({ status: 'enqueued', attempts: 0, deferrals: 1 });
    expect(row?.last_error).toContain('429');
    expect(row?.next_attempt_at.getTime()).toBeGreaterThanOrEqual(before + 89_000);
    expect(moveToDelayed).toHaveBeenCalledWith(row?.next_attempt_at.getTime(), 'token');
    expect(recorder.tokens).toEqual([]);
    expect(await ticketsOf(id)).toEqual([]);
  });

  it('drops an expired offer as done `stale` without a send', async () => {
    fresh();
    const id = await insert(
      offerRow([{ device_id: uuidv7(), push_token: token('s') }], -1),
      'enqueued',
    );
    expect(await runJob(id).result).toBe('done');
    expect(await stored(id)).toMatchObject({ status: 'done', last_error: 'skipped: stale' });
    expect(recorder.tokens).toEqual([]);
  });

  it('makes a malformed row dead at once, without an attempt or a send', async () => {
    fresh();
    const id = await insert({ ...offerRow([]), recipient_name: 'Sara' }, 'enqueued');
    expect(await runJob(id).result).toBe('dead');
    expect(await stored(id)).toMatchObject({
      status: 'dead',
      attempts: 0,
      last_error: 'payload push payload is invalid',
    });
    expect(recorder.tokens).toEqual([]);
  });

  it('writes no token, title or body to the row or its tickets', async () => {
    fresh();
    const device = { device_id: uuidv7(), push_token: token('private') };
    recorder.planTicketError(device.push_token, 'MessageTooBig');
    const id = await insert(offerRow([device]), 'enqueued');
    expect(await runJob(id).result).toBe('done');
    const [row] = await owner<{ last_error: string | null }[]>`
      SELECT last_error FROM core_outbox WHERE id = ${id}`;
    expect(row?.last_error ?? '').not.toContain('ExponentPushToken');
    const [tickets] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM core_push_tickets
      WHERE outbox_id = ${id} OR ticket_id LIKE '%PushToken%'`;
    expect(tickets?.n).toBe(0);
  });

  // INT-4 item D (plan 2.4): the receipts job. It reads every unchecked ticket of the database, and
  // only this file writes tickets, so these tests run here, after the delivery tests, on a clean
  // slate, with the clock faked through `now`.
  describe('push receipts job (plan 2.4)', () => {
    const minute = 60_000;
    const lockKey = `${prefix}:lock:push-receipts`;
    const ticketRows = () =>
      owner<{ device_id: string; status: string; error: string | null; checked: boolean }[]>`
        SELECT device_id, status, error, checked_at IS NOT NULL AS checked
        FROM core_push_tickets WHERE account_id = ${account} ORDER BY device_id`;
    const runReceipts = (at: Date, sender: PushSender = recorder) =>
      runPushReceipts({
        db: pool.db,
        redis,
        sender,
        invalidations: handler.invalidations,
        audit: new AuditWriter(pool),
        logger: quiet,
        now: () => at,
        lockKey,
      });
    /** Sends one row to `devices` through the handler; returns when its tickets are kept. */
    const sendTo = async (devices: { device_id: string; push_token: string }[]) => {
      const id = await insert(offerRow(devices), 'enqueued');
      expect(await runJob(id).result).toBe('done');
      return id;
    };

    beforeAll(async () => {
      await owner`DELETE FROM core_push_tickets WHERE account_id = ${account}`;
    });

    afterEach(async () => {
      await redis.del(lockKey);
      await owner`DELETE FROM core_push_tickets WHERE account_id = ${account}`;
    });

    it('checks tickets only after 15 minutes, writes ok and error, and hands DeviceNotRegistered on once', async () => {
      fresh();
      const ok = { device_id: uuidv7(), push_token: token('ok') };
      const gone = { device_id: uuidv7(), push_token: token('gone') };
      recorder.planReceiptError(gone.push_token);
      await sendTo([ok, gone]);
      const add = vi.spyOn(getMetrics(), 'add');

      const early = await runReceipts(new Date(Date.now() + 10 * minute));
      expect(early).toMatchObject({ ran: true, counts: { checked: 0 } });
      expect((await ticketRows()).every((t) => t.status === 'pending' && !t.checked)).toBe(true);
      await redis.del(lockKey);

      const later = await runReceipts(new Date(Date.now() + 16 * minute));
      expect(later).toEqual({
        ran: true,
        counts: { checked: 2, ok: 1, error: 1, noReceipt: 0, invalidated: 1, purged: 0 },
      });
      const rows = await ticketRows();
      expect(rows.find((t) => t.device_id === ok.device_id)).toMatchObject({
        status: 'ok',
        error: null,
        checked: true,
      });
      expect(rows.find((t) => t.device_id === gone.device_id)).toMatchObject({
        status: 'error',
        error: 'DeviceNotRegistered',
        checked: true,
      });
      expect(invalidated).toEqual([
        { accountId: account, deviceId: gone.device_id, reason: 'device_not_registered' },
      ]);
      expect(add).toHaveBeenCalledWith('push_receipts_total', 1, { status: 'error' });
      expect(add).toHaveBeenCalledWith('push_receipts_total', 1, { status: 'ok' });

      // A checked ticket is never asked about again: the device reaches the registry once.
      await redis.del(lockKey);
      expect(await runReceipts(new Date(Date.now() + 30 * minute))).toMatchObject({
        counts: { checked: 0, invalidated: 0 },
      });
      expect(invalidated).toHaveLength(1);
    });

    it('leaves a ticket without a receipt pending for a day, then marks it no_receipt', async () => {
      fresh();
      const device = { device_id: uuidv7(), push_token: token('silent') };
      await sendTo([device]);
      const silent: PushSender = {
        provider: 'stub',
        send: () => Promise.resolve([]),
        receipts: () => Promise.resolve([]),
      };
      expect(await runReceipts(new Date(Date.now() + 20 * 60 * minute), silent)).toMatchObject({
        counts: { checked: 0 },
      });
      expect((await ticketRows())[0]).toMatchObject({ status: 'pending', checked: false });
      await redis.del(lockKey);
      expect(
        await runReceipts(new Date(Date.now() + 24 * 60 * minute + minute), silent),
      ).toMatchObject({ counts: { checked: 1, noReceipt: 1 } });
      expect((await ticketRows())[0]).toMatchObject({
        status: 'error',
        error: 'no_receipt',
        checked: true,
      });
      expect(invalidated).toEqual([]);
    });

    it('keeps the tickets for the next run when the push service fails', async () => {
      fresh();
      await sendTo([{ device_id: uuidv7(), push_token: token('later') }]);
      const failing: PushSender = {
        provider: 'stub',
        send: () => Promise.resolve([]),
        receipts: () =>
          Promise.reject(
            new ProviderFailure('transient', 'the push service failed', { status: 503 }),
          ),
      };
      expect(await runReceipts(new Date(Date.now() + 16 * minute), failing)).toMatchObject({
        ran: true,
        counts: { checked: 0 },
      });
      expect((await ticketRows())[0]).toMatchObject({ status: 'pending', checked: false });
    });

    it('purges tickets after 7 days with one audit row of counts', async () => {
      fresh();
      await sendTo([
        { device_id: uuidv7(), push_token: token('old-1') },
        { device_id: uuidv7(), push_token: token('old-2') },
      ]);
      const run = await runReceipts(new Date(Date.now() + 7 * 24 * 60 * minute + minute));
      expect(run).toMatchObject({ ran: true, counts: { purged: 2 } });
      expect(await ticketRows()).toEqual([]);
      const audit = await owner<{ after: { deleted: number }; account_id: string | null }[]>`
        SELECT after, account_id FROM core_audit_log
        WHERE action = ${pushTicketsPurgedAction} AND occurred_at > now() - interval '1 minute'
        ORDER BY occurred_at DESC LIMIT 1`;
      expect(audit[0]).toEqual({ after: { deleted: 2, retention_days: 7 }, account_id: null });
      // A run with nothing to purge writes no audit row.
      await redis.del(lockKey);
      const before = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM core_audit_log WHERE action = ${pushTicketsPurgedAction}`;
      await runReceipts(new Date(Date.now() + 8 * 24 * 60 * minute));
      const after = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM core_audit_log WHERE action = ${pushTicketsPurgedAction}`;
      expect(after[0]?.n).toBe(before[0]?.n);
    });

    it('skips a run while another worker holds the lock', async () => {
      fresh();
      await sendTo([{ device_id: uuidv7(), push_token: token('locked') }]);
      await redis.set(lockKey, 'another-worker', 'PX', 60_000);
      expect(await runReceipts(new Date(Date.now() + 16 * minute))).toEqual({ ran: false });
      expect((await ticketRows())[0]).toMatchObject({ status: 'pending', checked: false });
    });
  });
});
