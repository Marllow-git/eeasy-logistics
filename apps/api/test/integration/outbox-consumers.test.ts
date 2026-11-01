import type { AppDatabase, Pool, UnitOfWork } from '@eeasy-logistics/db';
import { createAppPool, uuidv7 } from '@eeasy-logistics/db';
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
import { OutboxRepository } from '../../src/modules/kernel/outbox/outbox.repository.js';
import type { OutboxJobData } from '../../src/modules/kernel/outbox/queues.js';
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

/** Reads two rows through the unit of work it is given (adversary M-3). */
@OnDomainEvent('core.site.updated')
class Snooper implements DomainEventConsumer {
  readonly consumer = 'test.snooper';
  readonly found: Record<string, boolean> = {};
  accountSeen: string | undefined;
  constructor(private readonly ids: readonly string[]) {}
  async handle(_event: DomainEvent, uow?: UnitOfWork): Promise<void> {
    if (uow === undefined) throw new Error('no unit of work');
    this.accountSeen = uow.context.accountId;
    const rows = new OutboxRepository(uow);
    for (const id of this.ids) this.found[id] = (await rows.find(id)) !== undefined;
  }
}

describe('internal event dispatcher (plan 2.6)', () => {
  const account = uuidv7();
  const other = uuidv7();
  let owner: postgres.Sql;
  let pool: Pool<PlatformDatabase>;
  let app: Pool<AppDatabase>;
  const eventIds: string[] = [];

  const insert = async (
    aggregateId: string,
    sequence: number,
    type: DomainEventType = 'core.site.updated',
    attempts = 0,
    enqueuedAgoMs = 0,
    accountId: string = account,
  ) => {
    const id = nextOutboxId();
    eventIds.push(id);
    await owner`
      INSERT INTO core_outbox (id, type, event_version, account_id, aggregate_type, aggregate_id,
                               sequence, payload, kind, status, attempts, enqueued_at)
      VALUES (${id}, ${type}, 1, ${accountId}, 'site', ${aggregateId}, ${sequence}, '{}',
              'internal_event', 'enqueued', ${attempts},
              now() - make_interval(secs => ${enqueuedAgoMs / 1_000}))`;
    return id;
  };
  const row = async (id: string) =>
    (
      await owner<
        {
          status: string;
          attempts: number;
          next_attempt_at: Date;
          last_error: string;
          parked_consumers: string[] | null;
        }[]
      >`
        SELECT status, attempts, next_attempt_at, last_error, parked_consumers
        FROM core_outbox WHERE id = ${id}`
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

  /** The job data the last delivery left (a park writes `parkedSince` into it). */
  let lastJobData: OutboxJobData | undefined;

  /** Runs one delivery of `id` through the worker's processor with the dispatcher. */
  const deliver = async (
    consumers: DomainEventConsumer[],
    id: string,
    nowMs = Date.now(),
    parkedSinceMs?: number,
  ): Promise<JobResult | 'delayed'> => {
    const now = () => new Date(nowMs);
    const dispatcher = new InternalEventDispatcher({
      db: pool.db,
      app: app.db,
      consumers: new DomainEventConsumerRegistry(consumers),
      logger: quiet,
      now,
    });
    lastJobData =
      parkedSinceMs === undefined ? { outboxId: id } : { outboxId: id, parkedSince: parkedSinceMs };
    const job = {
      data: lastJobData,
      moveToDelayed: vi.fn(() => Promise.resolve()),
      updateData: vi.fn((data: OutboxJobData) => {
        lastJobData = data;
        return Promise.resolve();
      }),
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
    app = createAppPool(config.db, 'outbox-consumers-test-app');
    await owner`INSERT INTO core_accounts (id, name, status)
                VALUES (${account}, 'consumers', 'active'), (${other}, 'consumers other', 'active')`;
  });

  afterAll(async () => {
    await owner`DELETE FROM core_consumer_receipts WHERE event_id IN ${owner(eventIds)}`;
    await owner`DELETE FROM core_consumer_dead_letters WHERE event_id IN ${owner(eventIds)}`;
    await owner`DELETE FROM core_outbox WHERE id IN ${owner(eventIds)}`;
    await owner`DELETE FROM core_accounts WHERE id IN (${account}, ${other})`;
    await Promise.all([owner.end(), pool.close(), app.close()]);
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
    expect(parked).toMatchObject({
      status: 'enqueued',
      attempts: 0,
      last_error: 'parked: sequence gap',
      parked_consumers: ['test.recorder'],
    });
    expect((parked?.next_attempt_at.getTime() ?? 0) - before).toBe(30_000);
    // The first park stamps the job; a re-park keeps the stamp (lead review round 3).
    expect(lastJobData).toEqual({ outboxId: second, parkedSince: before });
    expect(await deliver([recorder, site], second, before + 30_000, before)).toBe('delayed');
    expect(lastJobData).toEqual({ outboxId: second, parkedSince: before });

    expect(await deliver([recorder, site], first)).toBe('done');
    expect(await deliver([recorder, site], second, Date.now(), before)).toBe('done');
    expect((await row(second))?.parked_consumers).toBeNull();
    expect(recorder.seen).toEqual([first, second]);
    expect(site.seen).toEqual([second]);
  });

  it('doubles the park delay with the time parked so far', async () => {
    const recorder = new Recorder();
    const aggregate = uuidv7();
    await insert(aggregate, 1);
    const second = await insert(aggregate, 2);
    const now = Date.now();
    const later = now + 4 * 60_000;
    // First parked at `now`, delivered again 4 minutes later.
    expect(await deliver([recorder], second, later, now)).toBe('delayed');
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
    // The clock advanced past the window since the job was first parked.
    const firstPark = Date.now();
    expect(await deliver([recorder, site], second, firstPark)).toBe('delayed');
    expect(
      await deliver([recorder, site], second, firstPark + parkWindowMs + 1_000, firstPark),
    ).toBe('dead');
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
    expect(await row(second)).toMatchObject({ status: 'dead', parked_consumers: null });
  });

  it('runs a consumer in a tenant unit of work on elx_app: it cannot read another account (adversary M-3)', async () => {
    const own = await insert(uuidv7(), 1, 'core.feature_flag.changed');
    const foreign = await insert(uuidv7(), 1, 'core.feature_flag.changed', 0, 0, other);
    const snooper = new Snooper([own, foreign]);
    const id = await insert(uuidv7(), 1);
    expect(await deliver([snooper], id)).toBe('done');
    expect(snooper.accountSeen).toBe(account);
    expect(snooper.found).toEqual({ [own]: true, [foreign]: false });
    // The receipt was written in that tenant transaction, with the event's account.
    expect(await receipts(id)).toEqual([{ consumer: 'test.snooper', account_id: account }]);
    await owner`UPDATE core_outbox SET status = 'done' WHERE id IN (${own}, ${foreign})`;
  });

  it('ends dead, never done, when a consumer is settled by a live dead letter (adversary L-5)', async () => {
    const recorder = new Recorder();
    const site = new SiteOnly();
    const id = await insert(uuidv7(), 1);
    await owner`
      INSERT INTO core_consumer_dead_letters (id, consumer, event_id, account_id, attempts, last_error)
      VALUES (${uuidv7()}, 'test.recorder', ${id}, ${account}, 10, 'recorder down')`;
    expect(await deliver([recorder, site], id)).toBe('dead');
    expect(recorder.seen).toEqual([]);
    expect(site.seen).toEqual([id]);
    expect(await row(id)).toMatchObject({
      status: 'dead',
      last_error: 'dead-lettered for test.recorder',
    });
  });

  it('measures the park window from the first park, not from enqueued_at (lead review round 3)', async () => {
    const recorder = new Recorder();
    const aggregate = uuidv7();
    await insert(aggregate, 1);
    // Enqueued 16 minutes ago (time spent retrying), parked for the first time now.
    const second = await insert(aggregate, 2, 'core.site.updated', 3, 16 * 60_000);
    const now = Date.now();
    expect(await deliver([recorder], second, now)).toBe('delayed');
    expect(await deadLetters(second)).toEqual([]);
    const parked = await row(second);
    expect(parked).toMatchObject({ status: 'enqueued', attempts: 3 });
    expect((parked?.next_attempt_at.getTime() ?? 0) - now).toBe(30_000);
    expect(lastJobData).toEqual({ outboxId: second, parkedSince: now });
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
