import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, integrationConfig, sqlState } from './support.js';

// core_audit_log on the real database (PLAT-7 item A; data §3.1, K-7): rows cannot be updated,
// deleted or truncated through the parent or through a partition, by a runtime role or by the
// owner, and the runtime roles cannot name a partition at all. Runs in both RLS lanes.

const config = integrationConfig();

describe('core_audit_log is append-only through the parent and every partition', () => {
  const accountId = uuidv7();
  const rowId = uuidv7();
  let owner: postgres.Sql;
  let app: postgres.Sql;
  let platform: postgres.Sql;
  let partition: string;

  beforeAll(async () => {
    owner = connectAs('owner', config);
    app = connectAs('app', config);
    platform = connectAs('platform', config);
    await owner`INSERT INTO core_accounts (id, name) VALUES (${accountId}, 'Audit table')`;
    // The tenant inserts its own row the way the unit of work does: account set in the transaction.
    await app.begin(async (tx) => {
      await tx`SELECT set_config('elx.account_id', ${accountId}, true)`;
      await tx`
        INSERT INTO core_audit_log (id, actor_type, actor_id, account_id, target_type, target_id,
                                    action, request_id)
        VALUES (${rowId}, 'user', ${uuidv7()}, ${accountId}, 'site', 's-1', 'core.site.created',
                ${uuidv7()})`;
    });
    const [row] = await owner<{ partition: string }[]>`
      SELECT tableoid::regclass::text AS partition FROM core_audit_log WHERE id = ${rowId}`;
    partition = row?.partition ?? '';
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end(), platform.end()]);
  });

  it('stores the row in the partition of the current month', () => {
    expect(partition).toMatch(/^core_audit_log_\d{6}$/);
  });

  it.each([
    ['app', () => app],
    ['platform', () => platform],
  ])('denies elx_%s UPDATE, DELETE and TRUNCATE on the parent (42501)', async (_, client) => {
    const sql = client();
    expect(await sqlState(sql`UPDATE core_audit_log SET reason = 'x' WHERE id = ${rowId}`)).toBe(
      '42501',
    );
    expect(await sqlState(sql`DELETE FROM core_audit_log WHERE id = ${rowId}`)).toBe('42501');
    expect(await sqlState(sql`TRUNCATE core_audit_log`)).toBe('42501');
  });

  it.each([
    ['app', () => app],
    ['platform', () => platform],
  ])('denies elx_%s every statement on a partition (42501)', async (_, client) => {
    const sql = client();
    expect(await sqlState(sql`SELECT count(*) FROM ${sql(partition)}`)).toBe('42501');
    expect(
      await sqlState(sql`
        INSERT INTO ${sql(partition)} (actor_type, target_type, target_id, action, request_id)
        VALUES ('system', 't', '1', 'platform.test.done', 'r')`),
    ).toBe('42501');
    expect(await sqlState(sql`UPDATE ${sql(partition)} SET reason = 'x'`)).toBe('42501');
    expect(await sqlState(sql`DELETE FROM ${sql(partition)}`)).toBe('42501');
    expect(await sqlState(sql`TRUNCATE ${sql(partition)}`)).toBe('42501');
  });

  it('stops even the owner with EL001 on the parent and on the partition', async () => {
    expect(await sqlState(owner`UPDATE core_audit_log SET reason = 'x' WHERE id = ${rowId}`)).toBe(
      'EL001',
    );
    expect(await sqlState(owner`DELETE FROM core_audit_log WHERE id = ${rowId}`)).toBe('EL001');
    expect(await sqlState(owner`TRUNCATE core_audit_log`)).toBe('EL001');
    expect(
      await sqlState(owner`UPDATE ${owner(partition)} SET reason = 'x' WHERE id = ${rowId}`),
    ).toBe('EL001');
    expect(await sqlState(owner`DELETE FROM ${owner(partition)} WHERE id = ${rowId}`)).toBe(
      'EL001',
    );
  });

  it('still holds the row, unchanged', async () => {
    const rows = await owner<{ reason: string | null }[]>`
      SELECT reason FROM core_audit_log WHERE id = ${rowId}`;
    expect(rows).toEqual([{ reason: null }]);
  });

  it('puts a row of a month without a partition into the DEFAULT partition (lead review round 1)', async () => {
    const id = uuidv7();
    // Ten years ahead: no monthly partition exists, and the three-month window never reaches it.
    await platform`
      INSERT INTO core_audit_log (id, occurred_at, actor_type, target_type, target_id, action,
                                  request_id)
      VALUES (${id}, now() + interval '10 years', 'system', 't', '1', 'platform.test.done', 'r')`;
    const [row] = await owner<{ partition: string }[]>`
      SELECT tableoid::regclass::text AS partition FROM core_audit_log WHERE id = ${id}`;
    expect(row?.partition).toBe('core_audit_log_default');
    expect(await sqlState(app`SELECT count(*) FROM core_audit_log_default`)).toBe('42501');
    expect(await sqlState(owner`DELETE FROM core_audit_log_default WHERE id = ${id}`)).toBe(
      'EL001',
    );
  });

  it('refuses a malformed action and a system-less missing actor', async () => {
    const insert = (action: string, actorType: string) =>
      platform`
        INSERT INTO core_audit_log (actor_type, target_type, target_id, action, request_id)
        VALUES (${actorType}, 't', '1', ${action}, 'r')`;
    expect(await sqlState(insert('Platform.Test', 'system'))).toBe('23514');
    expect(await sqlState(insert('platform.test.done', 'user'))).toBe('23514');
  });

  it('lets no runtime role run the partition functions', async () => {
    expect(await sqlState(app`SELECT core_ensure_audit_partitions(3)`)).toBe('42501');
    expect(await sqlState(platform`SELECT core_ensure_audit_partitions(3)`)).toBe('42501');
    expect(
      await sqlState(
        platform`SELECT * FROM core_drop_audit_partitions_before('2000-01-01', 'run')`,
      ),
    ).toBe('42501');
  });

  it('refuses a cutoff inside the 24-month retention, even for the owner', async () => {
    expect(
      await sqlState(owner`SELECT * FROM core_drop_audit_partitions_before(current_date, 'run')`),
    ).toBe('22023');
  });
});
