import type { Order } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditRowsOf } from './audit-rows.js';
import {
  createOrder,
  forceStatus,
  jeddah,
  nextKey,
  orderBody,
  ordersConfig,
  orderWorld,
} from './order-fixtures.js';
import type { SignedInMember, StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs } from './support.js';

// DEL-2 item E over HTTP (plan 2.9, 2.10, 2.11 transition cases): `transitionOrder` accepts a
// covered order and refuses an uncovered or unlocated one (`422 outside_coverage` naming the
// reason), fails an order out for delivery with one of the account's active reason codes;
// `cancelOrder` cancels before pickup and fails after it (Q-6); illegal arrows, terminal orders
// and stale versions answer the documented `409`; every arrow writes its event, its audit row and
// its `delivery.order.<status>` outbox row without recipient data; a replay answers the original.

const config = ordersConfig('orders-transitions');
const errorOf = (body: unknown) => operationSchemas.transitionOrder.responses['4XX'].parse(body);
const orderOf = (body: unknown) =>
  operationSchemas.transitionOrder.responses['200'].parse(body) as Order;

describe('order transitions over HTTP (DEL-2 item E)', () => {
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

  const post = (
    member: SignedInMember,
    path: string,
    body: object,
    ifMatch: string | undefined,
    key = nextKey(),
  ) => {
    const call = staff
      .http()
      .post(path)
      .set(staff.writeHeaders())
      .set('Cookie', member.cookie)
      .set('Idempotency-Key', key);
    return (ifMatch === undefined ? call : call.set('If-Match', ifMatch)).send(body);
  };
  const transition = (
    member: SignedInMember,
    id: string,
    body: object,
    ifMatch?: string,
    key?: string,
  ) => post(member, `/v1/staff/orders/${id}/transitions`, body, ifMatch, key);
  const cancel = (member: SignedInMember, id: string, body: object, ifMatch?: string) =>
    post(member, `/v1/staff/orders/${id}/cancel`, body, ifMatch);

  const eventsOf = async (orderId: string) =>
    (
      await owner<
        {
          type: string;
          from_status: string | null;
          to_status: string | null;
          actor_type: string;
          reason_code: string | null;
          note: string | null;
        }[]
      >`
        SELECT type, from_status, to_status, actor_type, reason_code, note FROM del_order_events
        WHERE order_id = ${orderId} ORDER BY server_ts, id`
    ).map((row) => ({ ...row }));

  it('accepts a covered pending order with its event, audit and outbox rows, and replays it', async () => {
    const { accountId, siteId, zoneId, dispatcher } = await orderWorld(owner, staff);
    const order = await createOrder(
      staff,
      dispatcher,
      orderBody(siteId, { cod_amount: { amount: 5_000 } }),
    );
    const key = nextKey();
    const response = await transition(
      dispatcher,
      order.id,
      { to_status: 'accepted', note: ' تم ' },
      '"1"',
      key,
    ).expect(200);
    const accepted = orderOf(response.body);
    expect(accepted).toMatchObject({
      status: 'accepted',
      pending_reason: null,
      version: 2,
      zone_id: zoneId,
    });
    expect(accepted.items).toHaveLength(1);
    expect((await eventsOf(order.id)).at(-1)).toEqual({
      type: 'transition',
      from_status: 'pending',
      to_status: 'accepted',
      actor_type: 'user',
      reason_code: null,
      note: 'تم',
    });
    const audit = await auditRowsOf(owner, response.headers['x-request-id'] as string);
    expect(audit.map((row) => row.action)).toEqual(['delivery.order.transitioned']);
    expect(audit[0]).toMatchObject({
      accountId,
      actorId: dispatcher.userId,
      before: { status: 'pending', version: 1 },
      after: { status: 'accepted', version: 2, reason_code: null },
    });
    const outbox = await owner<{ type: string; kind: string; payload: Record<string, unknown> }[]>`
      SELECT type, kind, payload FROM core_outbox
      WHERE aggregate_id = ${order.id} AND type <> 'delivery.order.created'`;
    expect(outbox.map((row) => ({ ...row }))).toEqual([
      {
        type: 'delivery.order.accepted',
        kind: 'internal_event',
        payload: {
          order_id: order.id,
          number: 1,
          from_status: 'pending',
          to_status: 'accepted',
          reason_code: null,
          actor_type: 'user',
          site_id: siteId,
          zone_id: zoneId,
        },
      },
    ]);
    expect(JSON.stringify([audit, outbox])).not.toMatch(/سارة|500000123|العليا/);

    // The same key answers the original result; no second event.
    const replay = await transition(
      dispatcher,
      order.id,
      { to_status: 'accepted', note: ' تم ' },
      '"1"',
      key,
    ).expect(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(orderOf(replay.body)).toEqual(accepted);
    expect(await eventsOf(order.id)).toHaveLength(2);
  });

  it('refuses to accept an uncovered or unlocated order and names the reason (D-3)', async () => {
    const { siteId, dispatcher } = await orderWorld(owner, staff);
    const outside = await createOrder(
      staff,
      dispatcher,
      orderBody(siteId, { address: { text: 'x', city: 'Jeddah', point: jeddah } }),
    );
    const unlocated = await createOrder(
      staff,
      dispatcher,
      orderBody(siteId, { address: { text: 'Nowhere Street', city: 'Riyadh' } }),
    );
    for (const [order, reason] of [
      [outside, 'outside_coverage'],
      [unlocated, 'needs_location'],
    ] as const) {
      const refused = await transition(
        dispatcher,
        order.id,
        { to_status: 'accepted' },
        '"1"',
      ).expect(422);
      expect(errorOf(refused.body)).toMatchObject({
        code: 'outside_coverage',
        details: { pending_reason: reason },
      });
    }
    const [row] = await owner<{ status: string; version: number }[]>`
      SELECT status, version FROM del_orders WHERE id = ${outside.id}`;
    expect(row).toEqual({ status: 'pending', version: 1 });
  });

  it('answers 428, 409 version_conflict and 409 invalid_transition with the current status and version', async () => {
    const { siteId, dispatcher } = await orderWorld(owner, staff);
    const order = await createOrder(staff, dispatcher, orderBody(siteId));
    expect(
      errorOf((await transition(dispatcher, order.id, { to_status: 'accepted' }).expect(428)).body)
        .code,
    ).toBe('version_required');
    await transition(dispatcher, order.id, { to_status: 'accepted' }, '"1"').expect(200);
    const stale = await transition(dispatcher, order.id, { to_status: 'accepted' }, '"1"').expect(
      409,
    );
    expect(errorOf(stale.body)).toMatchObject({
      code: 'version_conflict',
      details: { current_status: 'accepted', version: 2 },
    });
    const illegal = await transition(dispatcher, order.id, { to_status: 'accepted' }, '"2"').expect(
      409,
    );
    expect(errorOf(illegal.body)).toMatchObject({
      code: 'invalid_transition',
      details: { current_status: 'accepted', version: 2 },
    });
    // `accepted → failed` is no dispatcher arrow.
    const noArrow = await transition(
      dispatcher,
      order.id,
      { to_status: 'failed', reason_code: 'no_answer' },
      '"2"',
    ).expect(409);
    expect(errorOf(noArrow.body).code).toBe('invalid_transition');
    await transition(
      dispatcher,
      '0192f100-1111-7222-8333-444455556666',
      { to_status: 'accepted' },
      '"1"',
    ).expect(404);
  });

  it('fails an order out for delivery with an active reason code of the account', async () => {
    const { siteId, dispatcher } = await orderWorld(owner, staff);
    const order = await createOrder(staff, dispatcher, orderBody(siteId));
    await forceStatus(owner, order.id, 'out_for_delivery');
    for (const body of [
      { to_status: 'failed' },
      { to_status: 'failed', reason_code: 'lost' },
      { to_status: 'failed', reason_code: 'retired' },
    ]) {
      const refused = await transition(dispatcher, order.id, body, '"2"').expect(400);
      expect(errorOf(refused.body)).toMatchObject({
        code: 'validation_failed',
        details: { fields: [{ pointer: '/body/reason_code' }] },
      });
    }
    const failed = orderOf(
      (
        await transition(
          dispatcher,
          order.id,
          { to_status: 'failed', reason_code: 'no_answer' },
          '"2"',
        ).expect(200)
      ).body,
    );
    expect(failed).toMatchObject({ status: 'failed', version: 3 });
    expect((await eventsOf(order.id)).at(-1)).toMatchObject({
      from_status: 'out_for_delivery',
      to_status: 'failed',
      reason_code: 'no_answer',
    });
    const [outbox] = await owner<{ type: string }[]>`
      SELECT type FROM core_outbox WHERE aggregate_id = ${order.id} AND type = 'delivery.order.failed'`;
    expect(outbox).toEqual({ type: 'delivery.order.failed' });
  });

  it('cancels before pickup, fails after it, and never moves a terminal order', async () => {
    const { siteId, dispatcher } = await orderWorld(owner, staff);
    const early = await createOrder(staff, dispatcher, orderBody(siteId));
    const missing = await cancel(dispatcher, early.id, { reason_code: 'nope' }, '"1"').expect(400);
    expect(errorOf(missing.body).code).toBe('validation_failed');
    const cancelled = orderOf(
      (
        await cancel(
          dispatcher,
          early.id,
          { reason_code: 'customer_request', note: 'غيّر رأيه' },
          '"1"',
        ).expect(200)
      ).body,
    );
    expect(cancelled).toMatchObject({ status: 'cancelled', version: 2 });
    const [row] = await owner<{ terminal_at: Date | null }[]>`
      SELECT terminal_at FROM del_orders WHERE id = ${early.id}`;
    expect(row?.terminal_at).toBeInstanceOf(Date);
    const again = await cancel(
      dispatcher,
      early.id,
      { reason_code: 'customer_request' },
      '"2"',
    ).expect(409);
    expect(errorOf(again.body)).toMatchObject({
      code: 'invalid_transition',
      details: { current_status: 'cancelled', version: 2 },
    });
    await transition(dispatcher, early.id, { to_status: 'accepted' }, '"2"').expect(409);

    // After pickup the cancel is `failed` with the reason (Q-6); a failed order cannot be cancelled.
    const late = await createOrder(staff, dispatcher, orderBody(siteId));
    await forceStatus(owner, late.id, 'picked_up');
    const failed = orderOf(
      (await cancel(dispatcher, late.id, { reason_code: 'customer_request' }, '"2"').expect(200))
        .body,
    );
    expect(failed).toMatchObject({ status: 'failed', version: 3 });
    expect((await eventsOf(late.id)).at(-1)).toMatchObject({
      from_status: 'picked_up',
      to_status: 'failed',
      reason_code: 'customer_request',
    });
    await cancel(dispatcher, late.id, { reason_code: 'customer_request' }, '"3"').expect(409);
  });

  it('refuses a member without the dispatch or cancel permission', async () => {
    const { accountId, siteId, dispatcher } = await orderWorld(owner, staff);
    const order = await createOrder(staff, dispatcher, orderBody(siteId));
    const viewer = await staff.member(accountId, ['viewer']);
    expect(
      errorOf(
        (await transition(viewer, order.id, { to_status: 'accepted' }, '"1"').expect(403)).body,
      ).code,
    ).toBe('forbidden');
    await cancel(viewer, order.id, { reason_code: 'customer_request' }, '"1"').expect(403);
  });

  it('never accepts an assigned order through the door: that arrow is DEL-6s (round 1, ruling 3)', async () => {
    const { siteId, dispatcher } = await orderWorld(owner, staff);
    const order = await createOrder(staff, dispatcher, orderBody(siteId));
    await transition(dispatcher, order.id, { to_status: 'accepted' }, '"1"').expect(200);
    await forceStatus(owner, order.id, 'assigned');
    const refused = await transition(dispatcher, order.id, { to_status: 'accepted' }, '"3"').expect(
      409,
    );
    expect(errorOf(refused.body)).toMatchObject({
      code: 'invalid_transition',
      details: { current_status: 'assigned', version: 3 },
    });
    expect((await eventsOf(order.id)).map((event) => event.to_status)).toEqual([
      'pending',
      'accepted',
    ]);
  });

  it('clears the current assignment on cancel, fail and accept (round 1, ruling 4)', async () => {
    const { siteId, dispatcher } = await orderWorld(owner, staff);
    /** An order in `status` with an assignment, at version 2. */
    const held = async (status: string) => {
      const order = await createOrder(staff, dispatcher, orderBody(siteId));
      await forceStatus(owner, order.id, status);
      await owner`
        UPDATE del_orders SET current_assignment_id = ${'0192f100-1111-7222-8333-444455556666'}
        WHERE id = ${order.id}`;
      return order.id;
    };
    const assignmentOf = async (id: string) =>
      (
        await owner<{ current_assignment_id: string | null }[]>`
          SELECT current_assignment_id FROM del_orders WHERE id = ${id}`
      )[0]?.current_assignment_id;

    const cancelled = await held('assigned');
    expect(
      orderOf(
        (
          await cancel(dispatcher, cancelled, { reason_code: 'customer_request' }, '"2"').expect(
            200,
          )
        ).body,
      ),
    ).toMatchObject({ status: 'cancelled', current_assignment_id: null });
    expect(await assignmentOf(cancelled)).toBeNull();

    const failed = await held('out_for_delivery');
    await transition(
      dispatcher,
      failed,
      { to_status: 'failed', reason_code: 'no_answer' },
      '"2"',
    ).expect(200);
    expect(await assignmentOf(failed)).toBeNull();

    const rescheduled = await held('attempted');
    await transition(dispatcher, rescheduled, { to_status: 'accepted' }, '"2"').expect(200);
    expect(await assignmentOf(rescheduled)).toBeNull();
  });
});
