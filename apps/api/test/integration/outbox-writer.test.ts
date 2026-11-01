import type { AppDatabase, Pool, RequestContext } from '@eeasy-logistics/db';
import { createAppPool, uuidv7, withUnitOfWork } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import {
  createPlatformPool,
  withCrossTenantUnitOfWork,
  withPlatformUnitOfWork,
} from '@eeasy-logistics/db/platform';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OutboxEntry } from '../../src/modules/kernel/outbox/outbox-writer.js';
import { OutboxEntryError, OutboxWriter } from '../../src/modules/kernel/outbox/outbox-writer.js';
import { connectAs, integrationConfig } from './support.js';

// The outbox writer on the real database (PLAT-8 item B; plan 2.2; K-10; ADR-0024, ADR-0027): the
// row commits or rolls back with the business transaction, the account comes from the unit of work
// only, a supersede key keeps one pending row, and the insert wakes LISTEN elx_outbox on commit.

interface Row {
  id: string;
  account_id: string | null;
  type: string;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string;
  sequence: number;
  correlation_id: string | null;
  causation_id: string | null;
  payload: unknown;
  kind: string;
  status: string;
  supersede_key: string | null;
}

const config = integrationConfig();
const writer = new OutboxWriter();

const context = (accountId: string, extra: Partial<RequestContext> = {}): RequestContext => ({
  accountId,
  membershipId: null,
  userId: null,
  deviceId: null,
  actingCrossTenant: false,
  ...extra,
});

const entry = (aggregateId: string, extra: Partial<OutboxEntry> = {}): OutboxEntry => ({
  type: 'core.account.suspended',
  version: 1,
  aggregate: { type: 'account', id: aggregateId, version: 3 },
  payload: { reason: 'billing' },
  kind: 'internal_event',
  ...extra,
});

describe('OutboxWriter (plan 2.2)', () => {
  const accountA = uuidv7();
  const accountB = uuidv7();
  let owner: postgres.Sql;
  let app: Pool<AppDatabase>;
  let platform: Pool<PlatformDatabase>;

  const rowsOf = (aggregateId: string) =>
    owner<Row[]>`SELECT * FROM core_outbox WHERE aggregate_id = ${aggregateId} ORDER BY id`;

  beforeAll(async () => {
    owner = connectAs('owner', config);
    app = createAppPool(config.db, 'outbox-writer-test');
    platform = createPlatformPool(config.db, 'outbox-writer-test');
    await owner`
      INSERT INTO core_accounts (id, name) VALUES (${accountA}, 'writer A'), (${accountB}, 'writer B')`;
  });

  afterAll(async () => {
    await owner`DELETE FROM core_outbox WHERE account_id IN (${accountA}, ${accountB})`;
    await owner`DELETE FROM core_accounts WHERE id IN (${accountA}, ${accountB})`;
    await Promise.all([owner.end(), app.close(), platform.close()]);
  });

  it('writes the envelope in the business transaction, for the context account', async () => {
    const aggregateId = uuidv7();
    const requestId = uuidv7();
    const event = await withUnitOfWork(app.db, context(accountA, { requestId }), (uow) =>
      writer.enqueue(uow, entry(aggregateId)),
    );
    const rows = await rowsOf(aggregateId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: event.id,
      account_id: accountA,
      type: 'core.account.suspended',
      event_version: 1,
      aggregate_type: 'account',
      sequence: 3,
      correlation_id: requestId,
      causation_id: null,
      payload: { reason: 'billing' },
      kind: 'internal_event',
      status: 'pending',
    });
    expect(event).toMatchObject({ accountId: accountA, sequence: 3, correlationId: requestId });
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it('leaves nothing behind when the business transaction rolls back', async () => {
    const aggregateId = uuidv7();
    await expect(
      withUnitOfWork(app.db, context(accountA), async (uow) => {
        await writer.enqueue(uow, entry(aggregateId));
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow('business rule failed');
    expect(await rowsOf(aggregateId)).toEqual([]);
  });

  it('ignores an account passed in the entry: the account comes from the context only', async () => {
    const aggregateId = uuidv7();
    const smuggled = { ...entry(aggregateId), accountId: accountB, account_id: accountB };
    await withUnitOfWork(app.db, context(accountA), (uow) =>
      writer.enqueue(uow, smuggled as unknown as OutboxEntry),
    );
    const rows = await rowsOf(aggregateId);
    expect(rows.map((row) => row.account_id)).toEqual([accountA]);
  });

  it('writes a platform-only row with no account, whatever the entry carries', async () => {
    const aggregateId = uuidv7();
    const smuggled = { ...entry(aggregateId), accountId: accountB };
    await withPlatformUnitOfWork(platform.db, (uow) =>
      writer.enqueue(uow, smuggled as unknown as OutboxEntry),
    );
    const rows = await rowsOf(aggregateId);
    expect(rows.map((row) => row.account_id)).toEqual([null]);
    await owner`DELETE FROM core_outbox WHERE aggregate_id = ${aggregateId}`;
  });

  it("writes for the door's target account under the cross-tenant door", async () => {
    const aggregateId = uuidv7();
    await withCrossTenantUnitOfWork(
      platform.db,
      context(accountB, { actingCrossTenant: true, userId: uuidv7() }),
      (uow) => writer.enqueue(uow, entry(aggregateId)),
    );
    expect((await rowsOf(aggregateId)).map((row) => row.account_id)).toEqual([accountB]);
  });

  it('supersedes the pending row of the same key, in the same transaction or a later one', async () => {
    const aggregateId = uuidv7();
    const supersedeKey = `msg:${aggregateId}:status`;
    const keyed = (version: number) =>
      entry(aggregateId, {
        kind: 'message',
        supersedeKey,
        aggregate: { type: 'account', id: aggregateId, version },
      });
    await withUnitOfWork(app.db, context(accountA), (uow) => writer.enqueue(uow, keyed(1)));
    await withUnitOfWork(app.db, context(accountA), async (uow) => {
      await writer.enqueue(uow, keyed(2));
      await writer.enqueue(uow, keyed(3));
    });
    const rows = await rowsOf(aggregateId);
    expect(rows.map((row) => [row.sequence, row.status])).toEqual([
      [1, 'superseded'],
      [2, 'superseded'],
      [3, 'pending'],
    ]);
  });

  it('rolls a supersede back with the transaction', async () => {
    const aggregateId = uuidv7();
    const keyed = entry(aggregateId, { kind: 'message', supersedeKey: `msg:${aggregateId}:x` });
    await withUnitOfWork(app.db, context(accountA), (uow) => writer.enqueue(uow, keyed));
    await withUnitOfWork(app.db, context(accountA), async (uow) => {
      await writer.enqueue(uow, keyed);
      throw new Error('roll back');
    }).catch(() => undefined);
    expect((await rowsOf(aggregateId)).map((row) => row.status)).toEqual(['pending']);
  });

  it.each([
    ['an unknown type', { type: 'core.account.vanished' }],
    ['a zero version', { version: 0 }],
    ['an unknown kind', { kind: 'fax' }],
    ['an aggregate id that is not a UUID', { aggregate: { type: 'account', id: 'x', version: 1 } }],
    ['an aggregate version below 1', { aggregate: { type: 'account', id: uuidv7(), version: 0 } }],
    ['an array payload', { payload: [] }],
    ['a correlation id that is not a UUID', { correlationId: 'abc' }],
  ])('refuses %s and writes nothing', async (_name, change) => {
    const aggregateId = uuidv7();
    await expect(
      withUnitOfWork(app.db, context(accountA), (uow) =>
        writer.enqueue(uow, { ...entry(aggregateId), ...change } as unknown as OutboxEntry),
      ),
    ).rejects.toBeInstanceOf(OutboxEntryError);
    expect(await rowsOf(aggregateId)).toEqual([]);
  });

  it('wakes LISTEN elx_outbox when the transaction commits, not before and not on rollback', async () => {
    const listener = connectAs('platform', config);
    let received = 0;
    try {
      await listener.listen('elx_outbox', () => {
        received += 1;
      });
      await withUnitOfWork(app.db, context(accountA), async (uow) => {
        await writer.enqueue(uow, entry(uuidv7()));
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(received).toBe(0); // written, not yet committed
        throw new Error('roll back');
      }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(received).toBe(0);
      await withUnitOfWork(app.db, context(accountA), (uow) =>
        writer.enqueue(uow, entry(uuidv7())),
      );
      await expect.poll(() => received, { timeout: 3000 }).toBe(1);
    } finally {
      await listener.end();
    }
  });
});
