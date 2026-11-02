import type { AppDatabase, Pool, RequestContext } from '@eeasy-logistics/db';
import { createAppPool, uuidv7, withUnitOfWork } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SequenceAllocator } from '../../src/modules/kernel/public/index.js';
import { insertAccount } from './identity-fixtures.js';
import { connectAs, integrationConfig, sqlState } from './support.js';
import { plantSite } from './zone-fixtures.js';

const config = integrationConfig();
const rls = config.db.rls;

// Migration <timestamp>_del_orders on the real database (DEL-2 item A, plan 2.1, 2.2; data §2.1,
// §2.2, §3.1, §7; D-1, D-2, D-4, D-15): the order checks (D-1 executor NULL, D-4 COD by kind, the
// statuses and pending reasons, E.164 phones, a point in SRID 4326 with its GiST index), the number
// unique per account, the events append-only (EL001 for the owner, 42501 for the runtime roles)
// and unique per idempotency key forever, the tenant policy, the grants (elx_platform reads only)
// and `core_sequences` through `SequenceAllocator`: twenty parallel allocations give twenty
// consecutive numbers, and a rolled-back one gives its number back.

const context = (accountId: string): RequestContext => ({
  accountId,
  membershipId: null,
  userId: null,
  deviceId: null,
  actingCrossTenant: false,
});

describe('del_orders, del_order_items, del_order_events, core_sequences', () => {
  let owner: postgres.Sql;
  let app: postgres.Sql;
  let platform: postgres.Sql;
  let pool: Pool<AppDatabase>;

  beforeAll(() => {
    owner = connectAs('owner', config);
    app = connectAs('app', config);
    platform = connectAs('platform', config);
    pool = createAppPool({ ...config.db, poolSize: { app: 20 } }, 'elx-orders-table-test');
  });

  afterAll(async () => {
    await pool?.close();
    await Promise.all([owner.end(), app.end(), platform.end()]);
  });

  const asTenant = <T>(accountId: string, statement: (tx: postgres.TransactionSql) => T) =>
    app.begin(async (tx) => {
      await tx`SELECT set_config('elx.account_id', ${accountId}, true)`;
      return statement(tx);
    });

  async function world() {
    const accountId = await insertAccount(owner);
    const siteId = await plantSite(owner, accountId, 'branch');
    return { accountId, siteId };
  }

  interface OrderValues {
    id?: string;
    number?: number;
    kind?: string;
    status?: string;
    pendingReason?: string | null;
    codAmount?: number;
    executor?: string | null;
    phone?: string;
    srid?: number;
  }

  const insertOrder = (accountId: string, siteId: string, values: OrderValues = {}) =>
    sqlState(
      asTenant(
        accountId,
        (tx) => tx`
          INSERT INTO del_orders (
            id, account_id, number, kind, status, pending_reason, site_id, source,
            recipient_name, recipient_phone, address_text, address_city, address_point,
            cod_amount, executor_account_id, max_attempts)
          VALUES (
            ${values.id ?? uuidv7()}, ${accountId}, ${values.number ?? Math.floor(Math.random() * 1e9) + 1},
            ${values.kind ?? 'delivery'}, ${values.status ?? 'pending'},
            ${values.pendingReason === undefined ? null : values.pendingReason}, ${siteId}, 'manual',
            'سارة', ${values.phone ?? '+966500000001'}, 'Olaya St', 'Riyadh',
            ST_SetSRID(ST_MakePoint(46.685, 24.695), ${values.srid ?? 4326}),
            ${values.codAmount ?? 0}, ${values.executor ?? null}, 3)`,
      ),
    );

  it('keeps the order checks (D-1, D-4, statuses, reasons, phones, point) and the GiST index', async () => {
    const { accountId, siteId } = await world();
    const id = uuidv7();
    expect(await insertOrder(accountId, siteId, { id, codAmount: 1500 })).toBe('none');
    const [row] = await owner<
      {
        version: number;
        attempt_count: number;
        currency: string;
        type: string;
        srid: number;
      }[]
    >`SELECT version, attempt_count, currency, GeometryType(address_point) AS type,
             ST_SRID(address_point) AS srid
      FROM del_orders WHERE id = ${id}`;
    expect(row).toEqual({
      version: 1,
      attempt_count: 0,
      currency: 'SAR',
      type: 'POINT',
      srid: 4326,
    });

    expect(await insertOrder(accountId, siteId, { kind: 'exchange', codAmount: 10 })).toBe('none');
    for (const kind of ['return_pickup', 'pickup_request']) {
      expect(await insertOrder(accountId, siteId, { kind, codAmount: 0 })).toBe('none');
      expect(await insertOrder(accountId, siteId, { kind, codAmount: 1 })).toBe('23514');
    }
    expect(await insertOrder(accountId, siteId, { codAmount: -1 })).toBe('23514');
    expect(await insertOrder(accountId, siteId, { executor: uuidv7() })).toBe('23514');
    expect(await insertOrder(accountId, siteId, { kind: 'parcel' })).toBe('23514');
    expect(await insertOrder(accountId, siteId, { status: 'lost' })).toBe('23514');
    expect(await insertOrder(accountId, siteId, { pendingReason: 'needs_location' })).toBe('none');
    expect(await insertOrder(accountId, siteId, { pendingReason: 'unknown' })).toBe('23514');
    expect(await insertOrder(accountId, siteId, { phone: '0500000001' })).toBe('23514');
    expect(await insertOrder(accountId, siteId, { srid: 3857 })).toBe('22023');
    expect(await insertOrder(accountId, siteId, { number: 0 })).toBe('23514');
    const [index] = await owner<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'del_orders_address_point_idx'`;
    expect(index?.indexdef).toMatch(/USING gist \(address_point\)$/);
  });

  it('keys the number per account (D-2)', async () => {
    const a = await world();
    const b = await world();
    expect(await insertOrder(a.accountId, a.siteId, { number: 7 })).toBe('none');
    expect(await insertOrder(a.accountId, a.siteId, { number: 7 })).toBe('23505');
    expect(await insertOrder(b.accountId, b.siteId, { number: 7 })).toBe('none');
  });

  it('keeps items in bounds and events append-only, unique per idempotency key (D-15)', async () => {
    const { accountId, siteId } = await world();
    const orderId = uuidv7();
    expect(await insertOrder(accountId, siteId, { id: orderId })).toBe('none');
    const item = (quantity: number, direction = 'out') =>
      sqlState(
        asTenant(
          accountId,
          (tx) => tx`
            INSERT INTO del_order_items (id, account_id, order_id, position, name_ar, name_en,
                                         quantity, direction)
            VALUES (${uuidv7()}, ${accountId}, ${orderId}, 0, 'قميص', 'Shirt', ${quantity},
                    ${direction})`,
        ),
      );
    expect(await item(1)).toBe('none');
    expect(await item(9999, 'in')).toBe('none');
    expect(await item(0)).toBe('23514');
    expect(await item(10_000)).toBe('23514');
    expect(await item(1, 'sideways')).toBe('23514');

    const key = uuidv7();
    const event = (values: { key?: string | null; type?: string; to?: string | null } = {}) =>
      sqlState(
        asTenant(
          accountId,
          (tx) => tx`
            INSERT INTO del_order_events (id, account_id, order_id, type, from_status, to_status,
                                          actor_type, idempotency_key, point)
            VALUES (${uuidv7()}, ${accountId}, ${orderId}, ${values.type ?? 'transition'}, NULL,
                    ${values.to === undefined ? 'pending' : values.to}, 'user',
                    ${values.key === undefined ? key : values.key},
                    ST_SetSRID(ST_MakePoint(46.685, 24.695), 4326))`,
        ),
      );
    expect(await event()).toBe('none');
    expect(await event()).toBe('23505');
    expect(await event({ key: null })).toBe('none');
    expect(await event({ key: null })).toBe('none');
    expect(await event({ key: uuidv7(), type: 'note', to: 'pending' })).toBe('23514');
    expect(await event({ key: uuidv7(), type: 'note', to: null })).toBe('none');
    expect(await event({ key: uuidv7(), type: 'transition', to: null })).toBe('23514');

    // The runtime roles hold no UPDATE, DELETE or TRUNCATE; the owner is stopped by the trigger.
    const runtime = (sql: postgres.Sql) => [
      sql`UPDATE del_order_events SET reason_code = 'x' WHERE order_id = ${orderId}`,
      sql`DELETE FROM del_order_events WHERE order_id = ${orderId}`,
      sql`TRUNCATE del_order_events`,
    ];
    for (const statement of runtime(app)) expect(await sqlState(statement)).toBe('42501');
    for (const statement of runtime(platform)) expect(await sqlState(statement)).toBe('42501');
    for (const statement of runtime(owner)) expect(await sqlState(statement)).toBe('EL001');
    const [count] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM del_order_events WHERE order_id = ${orderId}`;
    expect(count?.n).toBe(4);
  });

  it('shows elx_app its own account only and lets elx_platform read, never write', async () => {
    const mine = await world();
    const theirs = await world();
    expect(await insertOrder(mine.accountId, mine.siteId)).toBe('none');
    expect(await insertOrder(theirs.accountId, theirs.siteId)).toBe('none');
    const seen = await asTenant(
      mine.accountId,
      (tx) => tx<{ account_id: string }[]>`SELECT account_id FROM del_orders`,
    );
    if (rls) {
      expect([...new Set(seen.map((row) => row.account_id))]).toEqual([mine.accountId]);
    } else {
      expect(seen.map((row) => row.account_id)).toContain(theirs.accountId);
    }
    expect(
      await sqlState(
        asTenant(
          mine.accountId,
          (tx) => tx`
            INSERT INTO core_sequences (account_id, name) VALUES (${theirs.accountId}, 'delivery_order')`,
        ),
      ),
    ).toBe(rls ? '42501' : 'none');

    const grants = await owner<{ table_name: string; grantee: string; privileges: string }[]>`
      SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
      WHERE table_name IN ('del_orders', 'del_order_items', 'del_order_events', 'core_sequences')
        AND grantee IN ('elx_app', 'elx_platform', 'elx_maintenance')
      GROUP BY table_name, grantee ORDER BY table_name, grantee`;
    const writes = 'DELETE,INSERT,SELECT,UPDATE';
    expect(grants.map((row) => ({ ...row }))).toEqual([
      { table_name: 'core_sequences', grantee: 'elx_app', privileges: writes },
      { table_name: 'core_sequences', grantee: 'elx_platform', privileges: 'SELECT' },
      { table_name: 'del_order_events', grantee: 'elx_app', privileges: 'INSERT,SELECT' },
      { table_name: 'del_order_events', grantee: 'elx_platform', privileges: 'SELECT' },
      { table_name: 'del_order_items', grantee: 'elx_app', privileges: writes },
      { table_name: 'del_order_items', grantee: 'elx_platform', privileges: 'SELECT' },
      { table_name: 'del_orders', grantee: 'elx_app', privileges: writes },
      { table_name: 'del_orders', grantee: 'elx_platform', privileges: 'SELECT' },
    ]);
  });

  it('allocates twenty parallel numbers consecutively, per account, and gives a rolled-back one back', async () => {
    const { accountId } = await world();
    const other = await world();
    const sequences = new SequenceAllocator();
    const next = (account: string) =>
      withUnitOfWork(pool.db, context(account), (uow) => sequences.next(uow, 'delivery_order'));
    const numbers = await Promise.all(Array.from({ length: 20 }, () => next(accountId)));
    expect([...numbers].sort((x, y) => x - y)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(await next(other.accountId)).toBe(1);

    await expect(
      withUnitOfWork(pool.db, context(accountId), async (uow) => {
        expect(await sequences.next(uow, 'delivery_order')).toBe(21);
        throw new Error('the business write failed');
      }),
    ).rejects.toThrow('the business write failed');
    expect(await next(accountId)).toBe(21);
    expect(
      await withUnitOfWork(pool.db, context(accountId), (uow) =>
        sequences.block(uow, 'delivery_order', 5),
      ),
    ).toBe(22);
    expect(await next(accountId)).toBe(27);
    const [row] = await owner<{ next_value: string }[]>`
      SELECT next_value FROM core_sequences
      WHERE account_id = ${accountId} AND name = 'delivery_order'`;
    expect(Number(row?.next_value)).toBe(28);
  });
});
