import type { Pool } from '@eeasy-logistics/db';
import { uuidv7 } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool, withPlatformAccountTransaction } from '@eeasy-logistics/db/platform';
import { DelayedError } from 'bullmq';
import { sql } from 'drizzle-orm';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { kernelConsumers } from '../../src/modules/kernel/outbox/account-suspended.consumer.js';
import type { DomainEvent, DomainEventType } from '../../src/modules/kernel/outbox/domain-event.js';
import type { DomainEventConsumer } from '../../src/modules/kernel/outbox/domain-event-consumers.js';
import {
  DomainEventConsumerRegistry,
  OnDomainEvent,
} from '../../src/modules/kernel/outbox/domain-event-consumers.js';
import { KindHandlerRegistry } from '../../src/modules/kernel/outbox/kind-handlers.js';
import { nextOutboxId } from '../../src/modules/kernel/outbox/outbox-id.js';
import { InternalEventDispatcher, parkWindowMs } from '../../src/worker/system/internal-events.js';
import type { JobResult, OutboxJob } from '../../src/worker/system/outbox-workers.js';
import { processOutboxJob } from '../../src/worker/system/outbox-workers.js';
import { connectAs, integrationConfig } from './support.js';

// Internal consumers on the real database (PLAT-8 item F; plan 2.6, 2.12; domain model §6.2;
// data §5.3): receipts, sequence-gap parking, dead letters, and the row done only when every
// consumer has a receipt or a dead letter. Each test uses aggregates of its own, so the suites
// writing `internal_event` rows in parallel never meet these.

const config = integrationConfig();
const quiet = { log: () => undefined, warn: () => undefined };

/** Records the events it handled; fails while `failing` is set. */
@OnDomainEvent('core.site.updated')
@OnDomainEvent('core.feature_flag.changed')
class Recorder implements DomainEventConsumer {
  readonly consumer = 'test.recorder';
  readonly seen: string[] = [];
  failing = false;
  handle(event: DomainEvent): Promise<void> {
    if (this.failing) return Promise.reject(new Error('recorder down'));
    this.seen.push(event.id);
    return Promise.resolve();
  }
}

@OnDomainEvent('core.site.updated')
class SiteOnly implements DomainEventConsumer {
  readonly consumer = 'test.site_only';
  readonly seen: string[] = [];
  handle(event: DomainEvent): Promise<void> {
    this.seen.push(event.id);
    return Promise.resolve();
  }
}

describe('internal event dispatcher (plan 2.6)', () => {
  const account = uuidv7();
  let owner: postgres.Sql;
  let pool: Pool<PlatformDatabase>;
  const eventIds: string[] = [];

  const insert = async (
    aggregateId: string,
    sequence: number,
    type: DomainEventType = 'core.site.updated',
    attempts = 0,
  ) => {
    const id = nextOutboxId();
    eventIds.push(id);
    await owner`
      INSERT INTO core_outbox (id, type, event_version, account_id, aggregate_type, aggregate_id,
                               sequence, payload, kind, status, attempts, enqueued_at)
      VALUES (${id}, ${type}, 1, ${account}, 'site', ${aggregateId}, ${sequence}, '{}',
              'internal_event', 'enqueued', ${attempts}, now())`;
    return id;
  };
  const row = async (id: string) =>
    (
      await owner<
        { status: string; attempts: number; next_attempt_at: Date; last_error: string }[]
      >`
        SELECT status, attempts, next_attempt_at, last_error FROM core_outbox WHERE id = ${id}`
    )[0];
  const receipts = async (id: string) =>
    (
      await owner<{ consumer: string; account_id: string }[]>`
        SELECT consumer, account_id FROM core_consumer_receipts WHERE event_id = ${id}
        ORDER BY consumer`
    ).map((r) => ({ ...r }));
  const deadLetters = async (id: string) =>
    (
      await owner<{ consumer: string; account_id: string; attempts: number; last_error: string }[]>`
        SELECT consumer, account_id, attempts, last_error FROM core_consumer_dead_letters
        WHERE event_id = ${id}`
    ).map((r) => ({ ...r }));

  /** Runs one delivery of `id` through the worker's processor with the dispatcher. */
  const deliver = async (
    consumers: DomainEventConsumer[],
    id: string,
    nowMs = Date.now(),
  ): Promise<JobResult | 'delayed'> => {
    const now = () => new Date(nowMs);
    const dispatcher = new InternalEventDispatcher({
      db: pool.db,
      consumers: new DomainEventConsumerRegistry(consumers),
      logger: quiet,
      now,
    });
    const job = {
      data: { outboxId: id },
      moveToDelayed: vi.fn(() => Promise.resolve()),
    } as unknown as OutboxJob;
    const deps = {
      db: pool.db,
      registry: new KindHandlerRegistry([dispatcher]),
      logger: quiet,
      now,
    };
    try {
      return await processOutboxJob(deps, 'internal_event', job, 'token');
    } catch (error) {
      if (error instanceof DelayedError) return 'delayed';
      throw error;
    }
  };

  beforeAll(async () => {
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'outbox-consumers-test');
    await owner`INSERT INTO core_accounts (id, name, status) VALUES (${account}, 'consumers', 'active')`;
  });

  afterAll(async () => {
    await owner`DELETE FROM core_consumer_receipts WHERE event_id IN ${owner(eventIds)}`;
    await owner`DELETE FROM core_consumer_dead_letters WHERE event_id IN ${owner(eventIds)}`;
    await owner`DELETE FROM core_outbox WHERE id IN ${owner(eventIds)}`;
    await owner`DELETE FROM core_accounts WHERE id = ${account}`;
    await Promise.all([owner.end(), pool.close()]);
  });

  it("runs receipts in a platform transaction set to the event's account (none without one)", async () => {
    const setting = (accountId: string | null) =>
      withPlatformAccountTransaction(pool.db, accountId, async (tx) => {
        const [result] = await tx.execute<{ value: string | null }>(
          sql`SELECT current_setting('elx.account_id', true) AS value`,
        );
        return result?.value ?? '';
      });
    expect(await setting(account)).toBe(account);
    expect(await setting(null)).toBe('');
    // Transaction-local: the pooled connection keeps nothing afterwards.
    const [after] = await pool.db.execute<{ value: string | null }>(
      sql`SELECT current_setting('elx.account_id', true) AS value`,
    );
    expect(after?.value ?? '').toBe('');
    expect(() =>
      withPlatformAccountTransaction(pool.db, 'not-a-uuid', () => Promise.resolve()),
    ).toThrow('needs a valid account id or null');
  });

  it('records a receipt per consumer first; a redelivery is a no-op', async () => {
    const recorder = new Recorder();
    const site = new SiteOnly();
    const id = await insert(uuidv7(), 1);
    expect(await deliver([recorder, site], id)).toBe('done');
    expect(await receipts(id)).toEqual([
      { consumer: 'test.recorder', account_id: account },
      { consumer: 'test.site_only', account_id: account },
    ]);
    // Redelivered (a stalled job, a sweeper re-enqueue): the receipts make it a no-op.
    await owner`UPDATE core_outbox SET status = 'enqueued', done_at = NULL WHERE id = ${id}`;
    expect(await deliver([recorder, site], id)).toBe('done');
    expect(recorder.seen).toEqual([id]);
    expect(site.seen).toEqual([id]);
  });

  it('a consumer failure rolls its receipt back; the row is done only when every consumer has one', async () => {
    const recorder = new Recorder();
    const site = new SiteOnly();
    recorder.failing = true;
    const id = await insert(uuidv7(), 1);
    expect(await deliver([recorder, site], id)).toBe('delayed');
    expect(await row(id)).toMatchObject({ status: 'enqueued', attempts: 1 });
    expect((await row(id))?.last_error).toContain('test.recorder: Error: recorder down');
    expect((await receipts(id)).map((r) => r.consumer)).toEqual(['test.site_only']);
    recorder.failing = false;
    expect(await deliver([recorder, site], id)).toBe('done');
    expect(site.seen).toEqual([id]);
    expect(recorder.seen).toEqual([id]);
    expect((await receipts(id)).map((r) => r.consumer)).toEqual([
      'test.recorder',
      'test.site_only',
    ]);
  });

  it('parks an event behind an open earlier one (30 s, no attempt), then delivers in order', async () => {
    const recorder = new Recorder();
    const site = new SiteOnly();
    const aggregate = uuidv7();
    const first = await insert(aggregate, 1, 'core.feature_flag.changed');
    const second = await insert(aggregate, 2);
    const before = Date.now();
    expect(await deliver([recorder, site], second, before)).toBe('delayed');
    // The recorder subscribes to the earlier type and parks; the site consumer does not, and runs.
    expect(recorder.seen).toEqual([]);
    expect(site.seen).toEqual([second]);
    const parked = await row(second);
    expect(parked).toMatchObject({ status: 'enqueued', attempts: 0 });
    expect(parked?.last_error).toContain('parked: sequence gap for test.recorder');
    expect((parked?.next_attempt_at.getTime() ?? 0) - before).toBe(30_000);

    expect(await deliver([recorder, site], first)).toBe('done');
    expect(await deliver([recorder, site], second)).toBe('done');
    expect(recorder.seen).toEqual([first, second]);
    expect(site.seen).toEqual([second]);
  });

  it('doubles the park delay with the time parked so far', async () => {
    const recorder = new Recorder();
    const aggregate = uuidv7();
    await insert(aggregate, 1);
    const second = await insert(aggregate, 2);
    const later = Date.now() + 4 * 60_000;
    expect(await deliver([recorder], second, later)).toBe('delayed');
    const delay = ((await row(second))?.next_attempt_at.getTime() ?? 0) - later;
    expect(delay).toBeGreaterThanOrEqual(4 * 60_000 - 2_000);
    expect(delay).toBeLessThanOrEqual(4 * 60_000 + 2_000);
  });

  it('dead-letters a consumer parked past 15 minutes; the row is dead', async () => {
    const recorder = new Recorder();
    const site = new SiteOnly();
    const aggregate = uuidv7();
    await insert(aggregate, 1, 'core.feature_flag.changed');
    const second = await insert(aggregate, 2);
    // The clock advanced past the window since the row was enqueued.
    expect(await deliver([recorder, site], second, Date.now() + parkWindowMs + 1_000)).toBe('dead');
    expect(await deadLetters(second)).toEqual([
      {
        consumer: 'test.recorder',
        account_id: account,
        attempts: 0,
        last_error: 'parked past 15 min: sequence gap',
      },
    ]);
    expect((await receipts(second)).map((r) => r.consumer)).toEqual(['test.site_only']);
    expect(recorder.seen).toEqual([]);
    expect(await row(second)).toMatchObject({ status: 'dead' });
  });

  it('dead-letters the failing consumers at the 10th failure; the row is dead with 10 attempts', async () => {
    const recorder = new Recorder();
    const site = new SiteOnly();
    recorder.failing = true;
    const id = await insert(uuidv7(), 1, 'core.site.updated', 9);
    expect(await deliver([recorder, site], id)).toBe('dead');
    expect(await deadLetters(id)).toEqual([
      expect.objectContaining({ consumer: 'test.recorder', account_id: account, attempts: 10 }),
    ]);
    expect(await row(id)).toMatchObject({ status: 'dead', attempts: 10 });
    expect((await receipts(id)).map((r) => r.consumer)).toEqual(['test.site_only']);
  });

  it('runs the kernel sample consumer of core.account.suspended', async () => {
    const id = await insert(uuidv7(), 1, 'core.account.suspended');
    expect(await deliver(kernelConsumers(), id)).toBe('done');
    expect(await receipts(id)).toEqual([
      { consumer: 'kernel.account_suspended_log', account_id: account },
    ]);
  });
});
