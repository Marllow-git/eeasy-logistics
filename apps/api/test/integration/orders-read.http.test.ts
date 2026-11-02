import type { Order, OrderEvent } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas, schemas } from '@eeasy-logistics/contracts/staff/schemas';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditRowsOf } from './audit-rows.js';
import {
  createOrder,
  forceStatus,
  jeddah,
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

// DEL-2 item D over HTTP (plan 2.7, 2.8, 2.11 list and update cases): `listOrders` with its
// filters, sorts and cursor in SQL and the site scope of a site-scoped member; `getOrder` with its
// `ETag`; `listOrderEvents`; `updateOrder` under `If-Match` (428, 400, 409 `version_conflict`,
// `order_locked`), the address located again with the intake rule re-applied, the note event and
// the audit row without recipient values; and PLAT-12's `open_orders` site-use reason.

const config = ordersConfig('orders-read');
const errorOf = (body: unknown) => operationSchemas.getOrder.responses['4XX'].parse(body);
const pageOf = (body: unknown) => {
  const page = operationSchemas.listOrders.responses['200'].parse(body) as {
    data: unknown[];
    next_cursor: string | null;
  };
  return {
    orders: page.data.map((item) => schemas.GetOrder200Response.parse(item) as Order),
    next: page.next_cursor,
  };
};

describe('order reads and edits over HTTP (DEL-2 item D)', () => {
  let staff: StaffApp;
  let owner: postgres.Sql;

  beforeAll(async () => {
    owner = connectAs('owner', config);
    staff = await startStaffApp(config, owner);
  });

  afterAll(async () => {
    await staff?.close();
    await owner?.end();
  });

  const get = (member: SignedInMember, path: string) =>
    staff.http().get(path).set('Cookie', member.cookie).set('Accept-Language', 'en');
  const patch = (member: SignedInMember, id: string, body: object, ifMatch?: string) => {
    const call = staff
      .http()
      .patch(`/v1/staff/orders/${id}`)
      .set(staff.writeHeaders())
      .set('Cookie', member.cookie)
      .set('Idempotency-Key', nextKey());
    return (ifMatch === undefined ? call : call.set('If-Match', ifMatch)).send(body);
  };
  const list = async (member: SignedInMember, query: string) =>
    pageOf((await get(member, `/v1/staff/orders?${query}`).expect(200)).body);

  it('lists with every filter and sort in SQL, pages by cursor, and keeps a site-scoped member to its sites', async () => {
    const { accountId, siteId, zoneId, dispatcher } = await orderWorld(owner, staff);
    const other = await plantSite(owner, accountId, 'branch');
    const first = await createOrder(
      staff,
      dispatcher,
      orderBody(siteId, {
        source_ref: 'SO-77',
        recipient: { name: 'Mona Saleh', phone: '+966511112222' },
      }),
    );
    const second = await createOrder(
      staff,
      dispatcher,
      orderBody(siteId, {
        kind: 'return_pickup',
        address: { text: 'x', city: 'Jeddah', point: jeddah },
      }),
    );
    const third = await createOrder(staff, dispatcher, orderBody(other));
    // Another account's order never shows.
    const stranger = await orderWorld(owner, staff);
    const foreign = await createOrder(staff, stranger.dispatcher, orderBody(stranger.siteId));

    const all = await list(dispatcher, '');
    expect(all.orders.map((order) => order.id)).toEqual([third.id, second.id, first.id]);
    expect(all.orders[0]).not.toHaveProperty('items');
    expect(all.next).toBeNull();

    const ids = async (query: string) => (await list(dispatcher, query)).orders.map((o) => o.id);
    expect(await ids(`site_id=${siteId}`)).toEqual([second.id, first.id]);
    expect(await ids('kind=return_pickup')).toEqual([second.id]);
    expect(await ids('status=pending')).toEqual([third.id, second.id, first.id]);
    expect(await ids('status=accepted,cancelled')).toEqual([]);
    // The other branch covers no zone, and Jeddah is in none.
    expect(await ids(`zone_id=${zoneId}`)).toEqual([first.id]);
    expect(await ids(`number=${first.number}`)).toEqual([first.id]);
    expect(await ids('number=1')).toEqual([first.id]);
    expect(await ids('source_ref=SO-77')).toEqual([first.id]);
    expect(await ids('q=mona')).toEqual([first.id]);
    expect(await ids('q=1112222')).toEqual([first.id]);
    expect(await ids('q=D-000002')).toEqual([second.id]);
    expect(await ids(`driver_id=${dispatcher.userId}`)).toEqual([]);
    expect(await ids('sort=number')).toEqual([first.id, second.id, third.id]);
    expect(await ids('sort=-updated_at')).toEqual([third.id, second.id, first.id]);
    const created = new Date(second.created_at);
    expect(await ids(`created_from=${encodeURIComponent(created.toISOString())}`)).toEqual([
      third.id,
      second.id,
    ]);
    expect(await ids(`created_to=${encodeURIComponent(created.toISOString())}`)).toEqual([
      first.id,
    ]);

    const page1 = await list(dispatcher, 'limit=2');
    expect(page1.orders.map((o) => o.id)).toEqual([third.id, second.id]);
    const page2 = await list(dispatcher, `limit=2&cursor=${page1.next ?? ''}`);
    expect(page2.orders.map((o) => o.id)).toEqual([first.id]);
    expect(page2.next).toBeNull();

    for (const bad of ['status=lost', 'number=X-1', 'sort=recipient_name']) {
      const response = await get(dispatcher, `/v1/staff/orders?${bad}`).expect(400);
      expect(errorOf(response.body).code).toBe('validation_failed');
    }

    // A site-scoped member reads its own site's orders only; another site is not found.
    const siteStaff = await staff.member(accountId, ['site_staff'], { siteIds: [other] });
    expect((await list(siteStaff, '')).orders.map((o) => o.id)).toEqual([third.id]);
    await get(siteStaff, `/v1/staff/orders?site_id=${siteId}`).expect(404);
    await get(siteStaff, `/v1/staff/orders/${first.id}`).expect(404);
    await get(siteStaff, `/v1/staff/orders/${first.id}/events`).expect(404);
    await get(siteStaff, `/v1/staff/orders/${third.id}`).expect(200);
    // Another account's order is not found either.
    await get(dispatcher, `/v1/staff/orders/${foreign.id}`).expect(404);
  });

  it('reads an order with its items and ETag, and its events oldest first', async () => {
    const { siteId, dispatcher } = await orderWorld(owner, staff);
    const order = await createOrder(staff, dispatcher, orderBody(siteId));
    const response = await get(dispatcher, `/v1/staff/orders/${order.id}`).expect(200);
    expect(response.headers.etag).toBe('"1"');
    const read = operationSchemas.getOrder.responses['200'].parse(response.body) as Order;
    expect(read).toEqual(order);

    await patch(dispatcher, order.id, { notes: 'اتصل قبل الوصول' }, '"1"').expect(200);
    const events = operationSchemas.listOrderEvents.responses['200'].parse(
      (await get(dispatcher, `/v1/staff/orders/${order.id}/events`).expect(200)).body,
    ) as { data: OrderEvent[] };
    expect(events.data.map((event) => [event.type, event.from_status, event.to_status])).toEqual([
      ['transition', null, 'pending'],
      ['note', null, null],
    ]);
    expect(events.data[0]).toMatchObject({
      actor_type: 'user',
      actor_id: dispatcher.userId,
      proof_ids: [],
      collection_ids: [],
    });
    const newest = await get(
      dispatcher,
      `/v1/staff/orders/${order.id}/events?sort=-server_ts&limit=1`,
    ).expect(200);
    expect((newest.body as { data: OrderEvent[] }).data.map((event) => event.type)).toEqual([
      'note',
    ]);
  });

  it('edits under If-Match: 428 without it, 400 for a bad one, 409 for a stale one', async () => {
    const { siteId, dispatcher } = await orderWorld(owner, staff);
    const order = await createOrder(
      staff,
      dispatcher,
      orderBody(siteId, { cod_amount: { amount: 10_000 } }),
    );

    expect(errorOf((await patch(dispatcher, order.id, { notes: 'x' }).expect(428)).body).code).toBe(
      'version_required',
    );
    const bad = await patch(dispatcher, order.id, { notes: 'x' }, 'W/"1"').expect(400);
    expect(errorOf(bad.body)).toMatchObject({
      code: 'validation_failed',
      details: { fields: [{ pointer: '/header/if-match' }] },
    });

    const response = await patch(
      dispatcher,
      order.id,
      {
        recipient: { name: 'نورة', phone: '+966522223333', preferred_language: 'en' },
        cod_amount: { amount: 12_500 },
        items: [
          { name_ar: 'حذاء', name_en: 'Shoes', quantity: 1 },
          { name_ar: 'حقيبة', name_en: 'Bag', quantity: 3 },
        ],
      },
      '"1"',
    ).expect(200);
    const updated = operationSchemas.updateOrder.responses['200'].parse(response.body) as Order;
    expect(updated).toMatchObject({
      version: 2,
      recipient: { name: 'نورة', phone: '+966522223333', preferred_language: 'en' },
      cod_amount: { amount: 12_500 },
      status: 'pending',
    });
    expect(updated.items?.map((item) => [item.name_en, item.quantity])).toEqual([
      ['Shoes', 1],
      ['Bag', 3],
    ]);
    const audit = await auditRowsOf(owner, response.headers['x-request-id'] as string);
    expect(audit.map((row) => row.action)).toEqual(['delivery.order.updated']);
    expect(audit[0]?.before).toEqual({ version: 1, cod_amount: 10_000 });
    expect(audit[0]?.after).toEqual({
      changed: ['recipient', 'items', 'cod_amount'],
      version: 2,
      cod_amount: 12_500,
    });
    expect(JSON.stringify(audit)).not.toMatch(/نورة|522223333/);
    const [event] = await owner<{ type: string; payload: unknown }[]>`
      SELECT type, payload FROM del_order_events WHERE order_id = ${order.id} AND type = 'note'`;
    expect(event).toEqual({
      type: 'note',
      payload: { changed: ['recipient', 'items', 'cod_amount'] },
    });

    const stale = await patch(dispatcher, order.id, { notes: 'late' }, '"1"').expect(409);
    expect(errorOf(stale.body)).toMatchObject({
      code: 'version_conflict',
      details: { current_status: 'pending', version: 2 },
    });
    const cod = await patch(dispatcher, order.id, { cod_amount: { amount: 1 } }, '"2"');
    expect(cod.status).toBe(200);
    // COD on a kind that collects nothing (D-4).
    const pickup = await createOrder(
      staff,
      dispatcher,
      orderBody(siteId, { kind: 'pickup_request' }),
    );
    const refused = await patch(
      dispatcher,
      pickup.id,
      { cod_amount: { amount: 100 } },
      '"1"',
    ).expect(422);
    expect(errorOf(refused.body).code).toBe('cod_not_allowed');
    await patch(dispatcher, '0192f100-1111-7222-8333-444455556666', { notes: 'x' }, '"1"').expect(
      404,
    );
  });

  it('locates a new address again and re-applies the intake rule to a pending order', async () => {
    const { siteId, zoneId, dispatcher } = await orderWorld(owner, staff, { rule: 'auto_accept' });
    const lost = await createOrder(
      staff,
      dispatcher,
      orderBody(siteId, { address: { text: 'Nowhere Street', city: 'Riyadh' } }),
    );
    expect(lost).toMatchObject({
      status: 'pending',
      pending_reason: 'needs_location',
      zone_id: null,
    });

    const outside = await patch(
      dispatcher,
      lost.id,
      { address: { text: 'x', city: 'Jeddah', point: jeddah } },
      '"1"',
    ).expect(200);
    expect(outside.body).toMatchObject({
      status: 'pending',
      pending_reason: 'outside_coverage',
      zone_id: null,
      version: 2,
      address: { point: jeddah, pin_source: 'manual' },
    });
    // A dispatcher's pin is never replaced by the geocoder: a text-only edit keeps the point.
    const kept = await patch(
      dispatcher,
      lost.id,
      { address: { text: 'Al Olaya district', city: 'Riyadh' } },
      '"2"',
    ).expect(200);
    expect(kept.body).toMatchObject({
      pending_reason: 'outside_coverage',
      address: { point: jeddah, pin_source: 'manual' },
    });

    // An order located by the geocoder is located again; covered under auto_accept, it is accepted.
    const geocoded = await createOrder(
      staff,
      dispatcher,
      orderBody(siteId, { address: { text: 'Nowhere Street', city: 'Riyadh' } }),
    );
    const fixed = await patch(
      dispatcher,
      geocoded.id,
      { address: { text: 'Al Olaya district', city: 'Riyadh' } },
      '"1"',
    ).expect(200);
    expect(fixed.body).toMatchObject({
      status: 'accepted',
      pending_reason: null,
      zone_id: zoneId,
      version: 3,
      address: { point: olaya, pin_source: 'geocoded', geocode_confidence: 0.8 },
    });
    const events = await owner<{ type: string; to_status: string | null; actor_type: string }[]>`
      SELECT type, to_status, actor_type FROM del_order_events
      WHERE order_id = ${geocoded.id} ORDER BY server_ts, id`;
    expect(events.map((row) => ({ ...row }))).toEqual([
      { type: 'transition', to_status: 'pending', actor_type: 'user' },
      { type: 'note', to_status: null, actor_type: 'user' },
      { type: 'transition', to_status: 'accepted', actor_type: 'system' },
    ]);
  });

  it('locks recipient, address, items and COD from picked_up and everything once terminal', async () => {
    const { siteId, dispatcher } = await orderWorld(owner, staff);
    const order = await createOrder(staff, dispatcher, orderBody(siteId));
    await forceStatus(owner, order.id, 'picked_up');
    const locked = await patch(
      dispatcher,
      order.id,
      { recipient: { name: 'x', phone: '+966500000001' }, notes: 'n' },
      '"2"',
    ).expect(409);
    expect(errorOf(locked.body)).toMatchObject({
      code: 'order_locked',
      details: { current_status: 'picked_up', version: 2, locked: ['recipient'] },
    });
    await patch(dispatcher, order.id, { notes: 'الباب الخلفي' }, '"2"').expect(200);
    await forceStatus(owner, order.id, 'delivered');
    const terminal = await patch(dispatcher, order.id, { notes: 'late' }, '"4"').expect(409);
    expect(errorOf(terminal.body)).toMatchObject({
      code: 'order_locked',
      details: { locked: ['notes'] },
    });
  });

  it('keeps a branch with an open order in use (site_in_use names open_orders)', async () => {
    const { accountId, siteId, dispatcher } = await orderWorld(owner, staff);
    const order = await createOrder(staff, dispatcher, orderBody(siteId));
    const siteOwner = await staff.member(accountId, ['owner']);
    const deactivate = () =>
      staff
        .http()
        .post(`/v1/staff/sites/${siteId}/deactivate`)
        .set(staff.writeHeaders())
        .set('Cookie', siteOwner.cookie)
        .set('Idempotency-Key', nextKey())
        .send();
    const refused = await deactivate().expect(409);
    expect(errorOf(refused.body)).toMatchObject({
      code: 'site_in_use',
      details: { reasons: ['open_orders'] },
    });
    // `failed` still holds the site (the parcel comes back); a terminal order does not.
    await forceStatus(owner, order.id, 'failed');
    await deactivate().expect(409);
    await forceStatus(owner, order.id, 'returned');
    await deactivate().expect(200);
  });
});
