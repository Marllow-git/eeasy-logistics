import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, sqlState } from './support.js';

// Migration 0007 on the real core_outbox (PLAT-8 item A; data §3.1, §5.2; K-10): the envelope
// trigger rejects any envelope change with EL001, even for the owner, while the delivery-state
// columns stay writable for the platform pool; an insert wakes LISTEN elx_outbox only on commit.

describe('core_outbox (migration 0007)', () => {
  const accountId = uuidv7();
  let owner: postgres.Sql;
  let platform: postgres.Sql;

  const insertRow = async (sql: postgres.Sql, id = uuidv7()) => {
    await sql`
      INSERT INTO core_outbox (id, type, event_version, account_id, aggregate_type, aggregate_id,
                               sequence, payload, kind)
      VALUES (${id}, 'core.account.suspended', 1, ${accountId}, 'account', ${accountId}, 1,
              ${sql.json({ reason: 'test' })}, 'internal_event')`;
    return id;
  };

  beforeAll(async () => {
    owner = connectAs('owner');
    platform = connectAs('platform');
    await owner`INSERT INTO core_accounts (id, name) VALUES (${accountId}, 'outbox table test')`;
  });

  afterAll(async () => {
    await owner`DELETE FROM core_outbox WHERE account_id = ${accountId}`;
    await owner`DELETE FROM core_accounts WHERE id = ${accountId}`;
    await Promise.all([owner.end(), platform.end()]);
  });

  it.each([
    [
      'type',
      (s: postgres.Sql, id: string) =>
        s`UPDATE core_outbox SET type = 'core.account.provisioned' WHERE id = ${id}`,
    ],
    [
      'event_version',
      (s: postgres.Sql, id: string) => s`UPDATE core_outbox SET event_version = 2 WHERE id = ${id}`,
    ],
    [
      'occurred_at',
      (s: postgres.Sql, id: string) =>
        s`UPDATE core_outbox SET occurred_at = now() - interval '1 day' WHERE id = ${id}`,
    ],
    [
      'account_id',
      (s: postgres.Sql, id: string) => s`UPDATE core_outbox SET account_id = NULL WHERE id = ${id}`,
    ],
    [
      'aggregate_id',
      (s: postgres.Sql, id: string) =>
        s`UPDATE core_outbox SET aggregate_id = ${uuidv7()} WHERE id = ${id}`,
    ],
    [
      'sequence',
      (s: postgres.Sql, id: string) => s`UPDATE core_outbox SET sequence = 2 WHERE id = ${id}`,
    ],
    [
      'causation_id',
      (s: postgres.Sql, id: string) =>
        s`UPDATE core_outbox SET causation_id = ${uuidv7()} WHERE id = ${id}`,
    ],
    [
      'payload',
      (s: postgres.Sql, id: string) =>
        s`UPDATE core_outbox SET payload = '{"reason":"other"}' WHERE id = ${id}`,
    ],
    [
      'kind',
      (s: postgres.Sql, id: string) => s`UPDATE core_outbox SET kind = 'webhook' WHERE id = ${id}`,
    ],
  ])(
    'rejects a change to %s with EL001, for the platform pool and the owner',
    async (_column, change) => {
      const id = await insertRow(platform);
      expect(await sqlState(change(platform, id))).toBe('EL001');
      expect(await sqlState(change(owner, id))).toBe('EL001');
    },
  );

  it('lets the delivery state change', async () => {
    const id = await insertRow(platform);
    await platform`
      UPDATE core_outbox
      SET status = 'enqueued', enqueued_at = now(), attempts = attempts + 1, last_error = '503'
      WHERE id = ${id}`;
    const [row] = await platform<{ status: string; attempts: number }[]>`
      SELECT status, attempts FROM core_outbox WHERE id = ${id}`;
    expect(row).toEqual({ status: 'enqueued', attempts: 1 });
  });

  it('refuses an unknown kind or status, and a type outside <context>.<aggregate>.<verb>', async () => {
    const id = uuidv7();
    expect(
      await sqlState(platform`
        INSERT INTO core_outbox (id, type, event_version, aggregate_type, aggregate_id, sequence, payload, kind)
        VALUES (${id}, 'core.account.suspended', 1, 'account', ${id}, 1, '{}', 'fax')`),
    ).toBe('23514');
    expect(
      await sqlState(platform`
        INSERT INTO core_outbox (id, type, event_version, aggregate_type, aggregate_id, sequence, payload, kind)
        VALUES (${id}, 'Core.Account', 1, 'account', ${id}, 1, '{}', 'internal_event')`),
    ).toBe('23514');
    const row = await insertRow(platform);
    expect(await sqlState(platform`UPDATE core_outbox SET status = 'lost' WHERE id = ${row}`)).toBe(
      '23514',
    );
  });

  it('keeps one pending row per supersede_key', async () => {
    const key = `test:${uuidv7()}`;
    const first = await insertRow(platform);
    await platform`UPDATE core_outbox SET supersede_key = ${key} WHERE id = ${first}`;
    const second = await insertRow(platform);
    expect(
      await sqlState(platform`UPDATE core_outbox SET supersede_key = ${key} WHERE id = ${second}`),
    ).toBe('23505');
    await platform`UPDATE core_outbox SET status = 'superseded' WHERE id = ${first}`;
    expect(
      await sqlState(platform`UPDATE core_outbox SET supersede_key = ${key} WHERE id = ${second}`),
    ).toBe('none');
  });

  it('notifies elx_outbox on commit only, once per transaction, with the transaction id only', async () => {
    // Suites run in parallel on this database: notifications are told apart by transaction id.
    const listener = connectAs('platform');
    const received: string[] = [];
    const txid = async (tx: postgres.Sql) =>
      (await tx<{ id: string }[]>`SELECT txid_current()::text AS id`)[0]?.id ?? '';
    try {
      await listener.listen('elx_outbox', (payload) => received.push(payload));
      let rolledBack = '';
      await platform
        .begin(async (tx) => {
          await insertRow(tx as unknown as postgres.Sql);
          rolledBack = await txid(tx as unknown as postgres.Sql);
          throw new Error('roll back');
        })
        .catch(() => undefined);

      let committed = '';
      await platform.begin(async (tx) => {
        await insertRow(tx as unknown as postgres.Sql);
        await insertRow(tx as unknown as postgres.Sql);
        committed = await txid(tx as unknown as postgres.Sql);
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(received).not.toContain(committed); // not before the commit
      });
      await expect.poll(() => received.includes(committed), { timeout: 3000 }).toBe(true);
      expect(received.filter((payload) => payload === committed)).toHaveLength(1);
      expect(received).not.toContain(rolledBack);
      expect(received.every((payload) => /^\d+$/.test(payload))).toBe(true);
    } finally {
      await listener.end();
    }
  });
});
