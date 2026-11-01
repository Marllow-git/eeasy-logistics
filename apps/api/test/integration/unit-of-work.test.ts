import { randomBytes } from 'node:crypto';
import type { SQL } from 'drizzle-orm';
import { eq, sql } from 'drizzle-orm';
import { pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AppDatabase,
  Pool,
  RequestContext,
  TenantInsert,
  UnitOfWork,
} from '@eeasy-logistics/db';
import {
  ScopedRepository,
  createAppPool,
  findContext,
  getContext,
  uuidv7,
  withUnitOfWork,
} from '@eeasy-logistics/db';
import { connectAs, integrationConfig } from './support.js';

// Real PostgreSQL as elx_app (plan item A; moved here from packages/db so the CI lanes run it). One
// connection (pool size 1), so "two sequential transactions on one connection" is literal. The
// table lives in a scratch schema the owner creates and drops (runtime roles may not create
// temporary tables, review L-3), outside public, so the schema test never sees it.

const schema = `scratch_${randomBytes(4).toString('hex')}`;
const table = sql.raw(`"${schema}".uow_rows`);
const rows = pgSchema(schema).table('uow_rows', {
  id: uuid('id').primaryKey(),
  accountId: uuid('account_id').notNull(),
  label: text('label').notNull(),
});

class RowRepository extends ScopedRepository<typeof rows> {
  constructor(uow: UnitOfWork) {
    super(uow, rows);
  }
  all() {
    return this.findMany();
  }
  byLabel(label: string) {
    return this.findMany(eq(rows.label, label));
  }
  add(...input: TenantInsert<typeof rows>[]) {
    return this.insertMany(input);
  }
  relabel(from: string, to: string) {
    return this.updateWhere({ label: to }, eq(rows.label, from));
  }
  moveToAccount(accountId: string) {
    return this.updateWhere({ accountId } as never);
  }
  removeAll() {
    return this.deleteWhere();
  }
  // Raw conditions, as a repository method could build them; the base must still bracket them.
  findRaw(condition: SQL) {
    return this.findMany(condition);
  }
  relabelRaw(condition: SQL, to: string) {
    return this.updateWhere({ label: to }, condition);
  }
  removeRaw(condition: SQL) {
    return this.deleteWhere(condition);
  }
}

const context = (accountId: string): RequestContext => ({
  accountId,
  membershipId: null,
  userId: null,
  deviceId: null,
  actingCrossTenant: false,
});

const currentAccountSetting = async (db: AppDatabase | UnitOfWork['tx']) => {
  const result = await db.execute<{ value: string | null }>(
    sql`SELECT current_setting('elx.account_id', true) AS value`,
  );
  return result[0]?.value ?? null;
};

describe('withUnitOfWork on the elx_app pool', () => {
  let pool: Pool<AppDatabase>;
  let owner: postgres.Sql;
  const accountA = uuidv7();
  const accountB = uuidv7();

  beforeAll(async () => {
    const config = integrationConfig();
    pool = createAppPool({ ...config.db, poolSize: { app: 1 } }, 'elx-db-test');
    owner = connectAs('owner', config);
    await owner`CREATE SCHEMA ${owner(schema)}`;
    await owner`
      CREATE TABLE ${owner(schema)}.uow_rows (
        id uuid PRIMARY KEY,
        account_id uuid NOT NULL,
        label text NOT NULL
      )`;
    await owner`GRANT USAGE ON SCHEMA ${owner(schema)} TO elx_app`;
    await owner`GRANT SELECT, INSERT, UPDATE, DELETE ON ${owner(schema)}.uow_rows TO elx_app`;
  });

  afterAll(async () => {
    await pool?.close();
    await owner`DROP SCHEMA IF EXISTS ${owner(schema)} CASCADE`;
    await owner.end();
  });

  it('runs as elx_app', async () => {
    const result = await pool.db.execute<{ who: string }>(sql`SELECT current_user AS who`);
    expect(result[0]?.who).toBe('elx_app');
  });

  it('sets elx.account_id inside the transaction only: nothing leaks to the next one', async () => {
    const inside = await withUnitOfWork(pool.db, context(accountA), ({ tx }) =>
      currentAccountSetting(tx),
    );
    expect(inside).toBe(accountA);

    // Same connection, next transaction without a unit of work: the setting is gone. PostgreSQL
    // returns '' (not NULL) once a transaction-local setting has been used on a connection, which
    // is why the policies wrap it in NULLIF (data §4.3).
    const next = await pool.db.transaction((tx) => currentAccountSetting(tx));
    expect(next === '' || next === null).toBe(true);
    const autocommit = await currentAccountSetting(pool.db);
    expect(autocommit === '' || autocommit === null).toBe(true);

    const other = await withUnitOfWork(pool.db, context(accountB), ({ tx }) =>
      currentAccountSetting(tx),
    );
    expect(other).toBe(accountB);
  });

  it('does not leak the setting after a rollback either', async () => {
    await expect(
      withUnitOfWork(pool.db, context(accountA), () => Promise.reject(new Error('rolled back'))),
    ).rejects.toThrow('rolled back');
    const after = await currentAccountSetting(pool.db);
    expect(after === '' || after === null).toBe(true);
  });

  it('exposes the context through getContext() inside, and nowhere else', async () => {
    const seen = await withUnitOfWork(pool.db, context(accountA), () =>
      Promise.resolve(getContext()),
    );
    expect(seen.accountId).toBe(accountA);
    expect(Object.isFrozen(seen)).toBe(true);
    expect(findContext()).toBeUndefined();
    expect(() => getContext()).toThrow('No request context');
  });

  it('refuses a context without a valid account id', async () => {
    await expect(
      withUnitOfWork(pool.db, context("x', true); DROP TABLE uow_rows; --"), () =>
        Promise.resolve(1),
      ),
    ).rejects.toThrow('no valid account id');
  });

  it('sets account_id from the context on insert, whatever the input says', async () => {
    const inserted = await withUnitOfWork(pool.db, context(accountA), (uow) =>
      new RowRepository(uow).add(
        { id: uuidv7(), label: 'a-1' },
        // A caller cannot pick the account: an accountId in the input is replaced.
        { id: uuidv7(), label: 'a-2', accountId: accountB } as TenantInsert<typeof rows>,
      ),
    );
    expect(inserted.map((row) => row.accountId)).toEqual([accountA, accountA]);
    await withUnitOfWork(pool.db, context(accountB), (uow) =>
      new RowRepository(uow).add({ id: uuidv7(), label: 'b-1' }),
    );

    const stored = await pool.db.execute<{ account_id: string; label: string }>(
      sql`SELECT account_id, label FROM ${table} ORDER BY label`,
    );
    expect(stored.map((row) => [row.label, row.account_id])).toEqual([
      ['a-1', accountA],
      ['a-2', accountA],
      ['b-1', accountB],
    ]);
  });

  it('adds the account predicate to reads, updates and deletes', async () => {
    const seenByA = await withUnitOfWork(pool.db, context(accountA), (uow) =>
      new RowRepository(uow).all(),
    );
    expect(seenByA.map((row) => row.label).sort()).toEqual(['a-1', 'a-2']);

    // B asks for A's label: the predicate still limits it to B.
    const crossRead = await withUnitOfWork(pool.db, context(accountB), (uow) =>
      new RowRepository(uow).byLabel('a-1'),
    );
    expect(crossRead).toEqual([]);

    const crossUpdate = await withUnitOfWork(pool.db, context(accountB), (uow) =>
      new RowRepository(uow).relabel('a-1', 'taken'),
    );
    expect(crossUpdate).toEqual([]);

    await expect(
      withUnitOfWork(pool.db, context(accountA), (uow) =>
        new RowRepository(uow).moveToAccount(accountB),
      ),
    ).rejects.toThrow('cannot change account_id');

    const deletedByB = await withUnitOfWork(pool.db, context(accountB), (uow) =>
      new RowRepository(uow).removeAll(),
    );
    expect(deletedByB.map((row) => row.label)).toEqual(['b-1']);

    const left = await pool.db.execute<{ label: string }>(
      sql`SELECT label FROM ${table} ORDER BY label`,
    );
    expect(left.map((row) => row.label)).toEqual(['a-1', 'a-2']);
  });

  it('keeps the account predicate when a caller condition contains OR (review H-1)', async () => {
    // Without brackets, `account_id = $1 and label = 'none' OR true` matches every account.
    const escape = sql`${rows.label} = 'none' OR true`;
    const read = await withUnitOfWork(pool.db, context(accountB), (uow) =>
      new RowRepository(uow).findRaw(escape),
    );
    expect(read).toEqual([]);
    const updated = await withUnitOfWork(pool.db, context(accountB), (uow) =>
      new RowRepository(uow).relabelRaw(escape, 'taken'),
    );
    expect(updated).toEqual([]);
    const deleted = await withUnitOfWork(pool.db, context(accountB), (uow) =>
      new RowRepository(uow).removeRaw(escape),
    );
    expect(deleted).toEqual([]);
    const left = await pool.db.execute<{ label: string }>(
      sql`SELECT label FROM ${table} ORDER BY label`,
    );
    expect(left.map((row) => row.label)).toEqual(['a-1', 'a-2']);
  });
});
