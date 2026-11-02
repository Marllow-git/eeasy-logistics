import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoleBundle } from '../../src/modules/kernel/authz/permission-resolver.js';
import {
  PERMISSION_RESOLVER,
  PermissionResolver,
} from '../../src/modules/kernel/authz/permission-resolver.js';
import {
  createOrder,
  nextKey,
  olaya,
  orderBody,
  ordersConfig,
  orderWorld,
} from './order-fixtures.js';
import type { SignedInMember, StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs } from './support.js';
import { plantSite } from './zone-fixtures.js';

// DEL-2 adversary round 1, ruling 5 over HTTP: (a) the coverage is checked again under the row
// lock before `accepted`; (b) an `Idempotency-Key` another member's request already gave an
// order event is `422 idempotency_key_reused`, not a 500; (d) COD or the address edited after
// acceptance writes `delivery.order.updated` with the changed keys and no recipient data; (e) the
// three write doors answer `404` for another account's order and, for a site-scoped member, for
// another site's order. No system bundle that is site-scoped holds the write permissions, so (e)
// adds a test-only `site_dispatcher` bundle to the boot-time resolver.

const config = ordersConfig('orders-round1');
const errorOf = (body: unknown) => operationSchemas.updateOrder.responses['4XX'].parse(body);
const siteDispatcher = 'site_dispatcher';

describe('order doors, adversary round 1 lows (DEL-2 ruling 5)', () => {
  let staff: StaffApp;
  let owner: postgres.Sql;

  beforeAll(async () => {
    owner = connectAs('owner', config);
    const rows = await owner<
      { key: string; surface: RoleBundle['surface']; site_scoped: boolean; permissions: string[] }[]
    >`SELECT key, surface, site_scoped, permissions FROM core_roles WHERE NOT custom`;
    const resolver = new PermissionResolver([
      ...rows.map((row) => ({
        key: row.key,
        surface: row.surface,
        siteScoped: row.site_scoped,
        permissions: new Set(row.permissions),
      })),
      {
        key: siteDispatcher,
        surface: 'staff',
        siteScoped: true,
        permissions: new Set([
          'delivery.orders.read',
          'delivery.orders.create',
          'delivery.orders.dispatch',
          'delivery.orders.cancel',
        ]),
      },
    ]);
    staff = await startStaffApp(config, owner, {
      configure: (builder) => builder.overrideProvider(PERMISSION_RESOLVER).useValue(resolver),
    });
  });

  afterAll(async () => {
    await staff?.close();
    await owner?.end();
  });

  const write = (
    member: SignedInMember,
    method: 'patch' | 'post',
    path: string,
    body: object,
    version: number,
    key = nextKey(),
  ) =>
    staff
      .http()
      [method](path)
      .set(staff.writeHeaders())
      .set('Cookie', member.cookie)
      .set('Idempotency-Key', key)
      .set('If-Match', `"${version}"`)
      .send(body);
  const update = (member: SignedInMember, id: string, body: object, version: number) =>
    write(member, 'patch', `/v1/staff/orders/${id}`, body, version);
  const transition = (
    member: SignedInMember,
    id: string,
    body: object,
    version: number,
    key?: string,
  ) => write(member, 'post', `/v1/staff/orders/${id}/transitions`, body, version, key);
  const cancel = (member: SignedInMember, id: string, version: number) =>
    write(member, 'post', `/v1/staff/orders/${id}/cancel`, { reason_code: 'no_answer' }, version);

  it('checks the coverage again under the lock before accepting (5a)', async () => {
    const { siteId, zoneId, dispatcher } = await orderWorld(owner, staff);
    const order = await createOrder(staff, dispatcher, orderBody(siteId));
    expect(order).toMatchObject({ status: 'pending', zone_id: zoneId });
    await owner`DELETE FROM del_coverage WHERE site_id = ${siteId}`;
    const refused = await transition(dispatcher, order.id, { to_status: 'accepted' }, 1).expect(
      422,
    );
    expect(errorOf(refused.body)).toMatchObject({
      code: 'outside_coverage',
      details: { pending_reason: 'outside_coverage' },
    });
    const [row] = await owner<{ status: string; version: number }[]>`
      SELECT status, version FROM del_orders WHERE id = ${order.id}`;
    expect(row).toEqual({ status: 'pending', version: 1 });
  });

  it("answers 422 idempotency_key_reused for a key another member's event holds (5b)", async () => {
    const { accountId, siteId, dispatcher } = await orderWorld(owner, staff);
    const colleague = await staff.member(accountId, ['dispatcher']);
    const first = await createOrder(staff, dispatcher, orderBody(siteId));
    const second = await createOrder(staff, dispatcher, orderBody(siteId));
    const key = nextKey();
    await transition(dispatcher, first.id, { to_status: 'accepted' }, 1, key).expect(200);
    const reused = await transition(colleague, second.id, { to_status: 'accepted' }, 1, key).expect(
      422,
    );
    expect(errorOf(reused.body).code).toBe('idempotency_key_reused');
    const [row] = await owner<{ status: string }[]>`
      SELECT status FROM del_orders WHERE id = ${second.id}`;
    expect(row?.status).toBe('pending');
  });

  it('announces COD and address edits after acceptance, keys only (5d)', async () => {
    const { siteId, dispatcher } = await orderWorld(owner, staff);
    const order = await createOrder(staff, dispatcher, orderBody(siteId));
    const updatedRows = async () =>
      (
        await owner<{ payload: Record<string, unknown> }[]>`
          SELECT payload FROM core_outbox
          WHERE aggregate_id = ${order.id} AND type = 'delivery.order.updated'
          ORDER BY id`
      ).map((row) => row.payload);

    // Pending: nobody dispatches it yet, so an edit is not announced.
    await update(dispatcher, order.id, { cod_amount: { amount: 1000 } }, 1).expect(200);
    expect(await updatedRows()).toEqual([]);

    await transition(dispatcher, order.id, { to_status: 'accepted' }, 2).expect(200);
    await update(dispatcher, order.id, { notes: 'ring twice' }, 3).expect(200);
    expect(await updatedRows()).toEqual([]);
    await update(
      dispatcher,
      order.id,
      {
        cod_amount: { amount: 2500 },
        address: { text: 'Olaya 2', city: 'Riyadh', point: olaya },
      },
      4,
    ).expect(200);
    expect(await updatedRows()).toEqual([
      { order_id: order.id, number: 1, changed: ['address', 'cod_amount'] },
    ]);
  });

  it('answers 404 for another account and, for a site-scoped member, another site (5e)', async () => {
    const mine = await orderWorld(owner, staff);
    const theirs = await orderWorld(owner, staff);
    const foreign = await createOrder(staff, theirs.dispatcher, orderBody(theirs.siteId));
    const notFound = async (call: Promise<{ status: number; body: unknown }>) => {
      const response = await call;
      expect(response.status).toBe(404);
      expect(errorOf(response.body).code).toBe('not_found');
    };
    await notFound(update(mine.dispatcher, foreign.id, { notes: 'x' }, 1));
    await notFound(transition(mine.dispatcher, foreign.id, { to_status: 'accepted' }, 1));
    await notFound(cancel(mine.dispatcher, foreign.id, 1));

    const otherSite = await plantSite(owner, mine.accountId, 'branch');
    const scoped = await staff.member(mine.accountId, [siteDispatcher], { siteIds: [otherSite] });
    const elsewhere = await createOrder(staff, mine.dispatcher, orderBody(mine.siteId));
    await notFound(update(scoped, elsewhere.id, { notes: 'x' }, 1));
    await notFound(transition(scoped, elsewhere.id, { to_status: 'accepted' }, 1));
    await notFound(cancel(scoped, elsewhere.id, 1));
    // The same member writes its own site's order (the bundle is not simply refused).
    await owner`
      INSERT INTO del_coverage (id, account_id, site_id, zone_id)
      VALUES (${uuidv7()}, ${mine.accountId}, ${otherSite}, ${mine.zoneId})`;
    const own = await createOrder(staff, mine.dispatcher, orderBody(otherSite));
    await update(scoped, own.id, { notes: 'gate 3' }, 1).expect(200);
    await cancel(scoped, own.id, 2).expect(200);
    // Nothing of the refused calls changed the other orders.
    const rows = await owner<{ version: number }[]>`
      SELECT version FROM del_orders WHERE id IN (${foreign.id}, ${elsewhere.id})`;
    expect(rows.map((row) => row.version)).toEqual([1, 1]);
  });
});
