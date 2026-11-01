import { randomBytes } from 'node:crypto';
import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, sqlState } from './support.js';

// The append-only triggers of data §3.1 on scratch tables (PLAT-5 item D). The tables live in a
// schema of their own, so the tenancy schema test (public only) never sees them, and are dropped
// afterwards. Two lines of defence are shown: the runtime roles have no UPDATE, DELETE or TRUNCATE
// (42501), and even the owner, who has every privilege, is stopped by the trigger (EL001).

describe('append-only triggers (core_reject_mutation, core_outbox_envelope_immutable)', () => {
  const schema = `scratch_${randomBytes(4).toString('hex')}`;
  const accountId = uuidv7();
  let owner: postgres.Sql;
  let app: postgres.Sql;

  beforeAll(async () => {
    owner = connectAs('owner');
    app = connectAs('app');
    await owner`CREATE SCHEMA ${owner(schema)}`;
    await owner`GRANT USAGE ON SCHEMA ${owner(schema)} TO elx_app, elx_platform`;
    await owner`
      CREATE TABLE ${owner(schema)}.ledger (
        id uuid PRIMARY KEY, account_id uuid NOT NULL, amount bigint NOT NULL)`;
    await owner`SELECT core_make_append_only(${`${schema}.ledger`}::regclass)`;
    await app`
      INSERT INTO ${app(schema)}.ledger (id, account_id, amount) VALUES (${uuidv7()}, ${accountId}, 100)`;
  });

  afterAll(async () => {
    await owner`DROP SCHEMA IF EXISTS ${owner(schema)} CASCADE`;
    await Promise.all([owner.end(), app.end()]);
  });

  it('gives the runtime roles SELECT and INSERT only', async () => {
    const [grants] = await owner<{ privileges: string }[]>`
      SELECT string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
      WHERE table_schema = ${schema} AND table_name = 'ledger' AND grantee = 'elx_app'`;
    expect(grants?.privileges).toBe('INSERT,SELECT');
    expect(await sqlState(app`UPDATE ${app(schema)}.ledger SET amount = 1`)).toBe('42501');
    expect(await sqlState(app`DELETE FROM ${app(schema)}.ledger`)).toBe('42501');
    expect(await sqlState(app`TRUNCATE ${app(schema)}.ledger`)).toBe('42501');
  });

  it.each([
    ['UPDATE', (s: postgres.Sql) => s`UPDATE ${s(schema)}.ledger SET amount = 1`],
    ['DELETE', (s: postgres.Sql) => s`DELETE FROM ${s(schema)}.ledger`],
    ['TRUNCATE', (s: postgres.Sql) => s`TRUNCATE ${s(schema)}.ledger`],
  ])('rejects %s even for the owner with SQLSTATE EL001', async (operation, statement) => {
    let error: { code?: string; message?: string } | undefined;
    try {
      await statement(owner);
    } catch (caught) {
      error = caught as { code?: string; message?: string };
    }
    expect(error?.code).toBe('EL001');
    expect(error?.message).toBe(`${operation} on ledger is forbidden: append-only`);
  });

  it('still holds the row after every attempt', async () => {
    const [row] = await owner<{ n: number; amount: string }[]>`
      SELECT count(*)::int AS n, max(amount)::text AS amount FROM ${owner(schema)}.ledger`;
    expect(row).toEqual({ n: 1, amount: '100' });
  });

  it('keeps an outbox envelope immutable while its delivery state changes (K-10)', async () => {
    await owner`
      CREATE TABLE ${owner(schema)}.outbox (
        id uuid PRIMARY KEY, type text, event_version integer, occurred_at timestamptz,
        account_id uuid, aggregate_type text, aggregate_id uuid, sequence integer,
        causation_id uuid, correlation_id uuid, payload jsonb, kind text,
        status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0)`;
    await owner`
      CREATE TRIGGER outbox_envelope_immutable BEFORE UPDATE ON ${owner(schema)}.outbox
      FOR EACH ROW EXECUTE FUNCTION core_outbox_envelope_immutable()`;
    await owner`
      INSERT INTO ${owner(schema)}.outbox (id, type, event_version, occurred_at, account_id, payload, kind)
      VALUES (${uuidv7()}, 'test.event', 1, now(), ${accountId}, '{"a":1}', 'internal_event')`;

    expect(
      await sqlState(owner`UPDATE ${owner(schema)}.outbox SET status = 'done', attempts = 1`),
    ).toBe('none');
    expect(await sqlState(owner`UPDATE ${owner(schema)}.outbox SET payload = '{"a":2}'`)).toBe(
      'EL001',
    );
    expect(await sqlState(owner`UPDATE ${owner(schema)}.outbox SET kind = 'webhook'`)).toBe(
      'EL001',
    );
  });
});
