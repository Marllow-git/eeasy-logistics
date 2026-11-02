import { randomBytes } from 'node:crypto';
import type { DriverSession } from '@eeasy-logistics/contracts/driver/schemas';
import { operationSchemas as driverOps } from '@eeasy-logistics/contracts/driver/schemas';
import type { DriverShift } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testSigningKey } from '../support/access-tokens.js';
import { auditRowsOf } from './audit-rows.js';
import { driverAddress, plantDriver, signIn } from './driver-fixtures.js';
import type { PlantedDriver } from './driver-fixtures.js';
import type { SignedInMember, StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';

// DEL-5 item B over HTTP (plan 2.3, 2.4, 2.9, 2.10): the staff doors plan, list by business date,
// get, cancel and end; the driver starts a planned or ad hoc shift only when eligible (each typed
// reason), pauses, resumes and ends; the end replays by key and a new key is `409`; `driverGetMe`
// carries the live shift; the events and audit rows; another account's shift is invisible.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `shifts:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'shifts',
  TRUST_PROXY_HOPS: '1',
});

const planOp = operationSchemas.planShift;
const listOp = operationSchemas.listShifts;
const errorOf = (body: unknown) => planOp.responses['4XX'].parse(body);
const shiftOf = (body: unknown) => planOp.responses['201'].parse(body) as DriverShift;

let keySequence = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('the shift doors over HTTP (DEL-5 item B)', () => {
  let staff: StaffApp;
  let owner: postgres.Sql;
  const http = () => staff.http();

  beforeAll(async () => {
    owner = connectAs('owner', config);
    staff = await startStaffApp(config, owner);
  });

  afterAll(async () => {
    await staff?.close();
    await owner.end();
  });

  const staffGet = (member: SignedInMember, path: string) =>
    http().get(path).set('Cookie', member.cookie).set('Accept-Language', 'en');
  const staffPost = (member: SignedInMember, path: string, body: object, key = nextKey()) =>
    http()
      .post(path)
      .set(staff.writeHeaders())
      .set('Cookie', member.cookie)
      .set('Idempotency-Key', key)
      .set('Accept-Language', 'en')
      .send(body);
  const bearer = (session: DriverSession) => `Bearer ${session.tokens?.access_token ?? ''}`;
  const driverGet = (session: DriverSession, path: string) =>
    http()
      .get(path)
      .set('Authorization', bearer(session))
      .set('X-Forwarded-For', driverAddress())
      .set('Accept-Language', 'en');
  const driverPost = (session: DriverSession, path: string, body: object = {}, key = nextKey()) =>
    http()
      .post(path)
      .set('Authorization', bearer(session))
      .set('X-Forwarded-For', driverAddress())
      .set('Idempotency-Key', key)
      .set('Accept-Language', 'en')
      .send(body);

  async function insertVehicle(accountId: string, active = true): Promise<string> {
    const id = uuidv7();
    await owner`
      INSERT INTO del_vehicles (id, account_id, plate, kind, capacity_parcels, active)
      VALUES (${id}, ${accountId}, ${`P ${randomBytes(4).toString('hex')}`}, 'van', 40, ${active})`;
    return id;
  }

  /** A driver with a vehicle and a dispatcher of the same account; the driver signed in. */
  async function world(): Promise<{
    driver: PlantedDriver;
    session: DriverSession;
    dispatcher: SignedInMember;
    vehicleId: string;
  }> {
    const driver = await plantDriver(owner);
    const session = await signIn(http, owner, config, driver.phone);
    const dispatcher = await staff.member(driver.accountId, ['dispatcher']);
    return { driver, session, dispatcher, vehicleId: await insertVehicle(driver.accountId) };
  }

  const plan = (w: Awaited<ReturnType<typeof world>>, body: object = {}) =>
    staffPost(w.dispatcher, '/v1/staff/shifts', {
      driver_id: w.driver.driverId,
      site_id: w.driver.siteId,
      planned_start: minutes(10),
      planned_end: minutes(8 * 60),
      ...body,
    });

  const eventsOf = (shiftId: string) =>
    owner<{ type: string; kind: string; payload: Record<string, unknown> }[]>`
      SELECT type, kind, payload FROM core_outbox WHERE aggregate_id = ${shiftId}
      ORDER BY sequence`;

  it('plans a shift, audited; lists it by business date; another account cannot see it', async () => {
    const w = await world();
    const start = '2026-11-03T21:30:00Z'; // 2026-11-04 in Riyadh
    const response = await plan(w, {
      planned_start: start,
      planned_end: '2026-11-04T05:30:00Z',
      vehicle_id: w.vehicleId,
    }).expect(201);
    const shift = shiftOf(response.body);
    expect(shift).toMatchObject({
      driver_id: w.driver.driverId,
      site_id: w.driver.siteId,
      vehicle_id: w.vehicleId,
      status: 'planned',
      started_at: null,
      ended_at: null,
    });
    const audit = await auditRowsOf(owner, response.headers['x-request-id'] as string);
    expect(audit.map((row) => [row.action, row.actorType, row.targetId])).toEqual([
      ['delivery.shift.planned', 'user', shift.id],
    ]);

    const idsOf = (body: unknown) =>
      ((listOp.responses['200'].parse(body).data ?? []) as DriverShift[]).map((row) => row.id);
    const ids = async (query: string) =>
      idsOf((await staffGet(w.dispatcher, `/v1/staff/shifts${query}`).expect(200)).body);
    expect(await ids('?business_date=2026-11-04')).toEqual([shift.id]);
    expect(await ids('?business_date=2026-11-03')).toEqual([]);
    expect(await ids(`?driver_id=${w.driver.driverId}&status=planned`)).toEqual([shift.id]);
    expect(await ids('?status=active')).toEqual([]);
    await staffGet(w.dispatcher, `/v1/staff/shifts/${shift.id}`).expect(200);

    const stranger = await world();
    await staffGet(stranger.dispatcher, `/v1/staff/shifts/${shift.id}`).expect(404);
    expect(
      idsOf((await staffGet(stranger.dispatcher, '/v1/staff/shifts').expect(200)).body),
    ).not.toContain(shift.id);
  });

  it('refuses a bad window, a warehouse, a foreign driver and an overlap', async () => {
    const w = await world();
    const window = await plan(w, { planned_end: minutes(10) }).expect(400);
    expect(errorOf(window.body).details).toMatchObject({
      fields: [{ pointer: '/body/planned_end', code: 'invalid' }],
    });
    await plan(w, { planned_end: minutes(10 + 16 * 60 + 1) }).expect(400);
    await plan(w, {
      planned_start: minutes(15 * 24 * 60),
      planned_end: minutes(15 * 24 * 60 + 60),
    }).expect(400);
    const warehouse = uuidv7();
    await owner`
      INSERT INTO core_sites (id, account_id, kind, name_ar, name_en)
      VALUES (${warehouse}, ${w.driver.accountId}, 'warehouse', 'مستودع', 'Warehouse')`;
    expect(errorOf((await plan(w, { site_id: warehouse }).expect(422)).body).code).toBe(
      'site_kind_mismatch',
    );
    const stranger = await plantDriver(owner);
    expect(
      errorOf((await plan(w, { driver_id: stranger.driverId }).expect(400)).body).details,
    ).toMatchObject({ fields: [{ pointer: '/body/driver_id', code: 'invalid' }] });

    const first = shiftOf((await plan(w).expect(201)).body);
    const overlap = await plan(w, { planned_start: minutes(60), planned_end: minutes(120) }).expect(
      409,
    );
    expect(errorOf(overlap.body)).toMatchObject({
      code: 'invalid_transition',
      details: { shift_id: first.id, current_status: 'planned' },
    });
  });

  it('cancels a planned shift once; a second cancel is 409', async () => {
    const w = await world();
    const shift = shiftOf((await plan(w).expect(201)).body);
    const response = await staffPost(w.dispatcher, `/v1/staff/shifts/${shift.id}/cancel`, {
      note: 'Driver called in sick',
    }).expect(200);
    expect(shiftOf(response.body).status).toBe('cancelled');
    const audit = await auditRowsOf(owner, response.headers['x-request-id'] as string);
    expect(audit[0]).toMatchObject({ action: 'delivery.shift.cancelled' });
    expect(audit[0]?.after).toMatchObject({ status: 'cancelled', note: 'Driver called in sick' });
    const again = await staffPost(w.dispatcher, `/v1/staff/shifts/${shift.id}/cancel`, {}).expect(
      409,
    );
    expect(errorOf(again.body).details).toMatchObject({ current_status: 'cancelled' });
  });

  it('starts a planned shift with the vehicle, shows it on me, refuses a second live shift', async () => {
    const w = await world();
    const planned = shiftOf((await plan(w).expect(201)).body);
    const response = await driverPost(w.session, '/v1/driver/shifts/start', {
      vehicle_id: w.vehicleId,
      shift_id: planned.id,
    }).expect(200);
    const started = driverOps.driverStartShift.responses['200'].parse(response.body);
    expect(started).toMatchObject({ id: planned.id, status: 'active', vehicle_id: w.vehicleId });
    expect(started.started_at).not.toBeNull();
    const me = driverOps.driverGetMe.responses['200'].parse(
      (await driverGet(w.session, '/v1/driver/me').expect(200)).body,
    );
    expect(me.current_shift).toMatchObject({ id: planned.id, status: 'active' });
    expect(await eventsOf(planned.id)).toEqual([
      {
        type: 'delivery.shift.started',
        kind: 'internal_event',
        payload: {
          shift_id: planned.id,
          driver_id: w.driver.driverId,
          site_id: w.driver.siteId,
          vehicle_id: w.vehicleId,
          started_at: started.started_at,
          ad_hoc: false,
        },
      },
    ]);
    const audit = await auditRowsOf(owner, response.headers['x-request-id'] as string);
    expect(audit.map((row) => [row.action, row.actorType, row.actorId])).toEqual([
      ['delivery.shift.started', 'driver', w.driver.driverId],
    ]);

    const second = await driverPost(w.session, '/v1/driver/shifts/start', {
      vehicle_id: w.vehicleId,
    }).expect(422);
    expect(errorOf(second.body)).toMatchObject({
      code: 'driver_not_eligible',
      details: { reason: 'shift_live' },
    });
  });

  it('names every eligibility refusal', async () => {
    const w = await world();
    const reasonOf = async (body: object) =>
      errorOf((await driverPost(w.session, '/v1/driver/shifts/start', body).expect(422)).body)
        .details?.reason;
    expect(await reasonOf({ vehicle_id: uuidv7() })).toBe('vehicle_unknown');
    const stranger = await world();
    expect(await reasonOf({ vehicle_id: stranger.vehicleId })).toBe('vehicle_unknown');
    expect(await reasonOf({ vehicle_id: await insertVehicle(w.driver.accountId, false) })).toBe(
      'vehicle_inactive',
    );
    expect(await reasonOf({ vehicle_id: w.vehicleId, shift_id: uuidv7() })).toBe(
      'shift_not_planned',
    );
    const theirs = shiftOf((await plan(stranger).expect(201)).body);
    expect(await reasonOf({ vehicle_id: w.vehicleId, shift_id: theirs.id })).toBe(
      'shift_not_planned',
    );
    const later = shiftOf(
      (await plan(w, { planned_start: minutes(90), planned_end: minutes(180) }).expect(201)).body,
    );
    expect(await reasonOf({ vehicle_id: w.vehicleId, shift_id: later.id })).toBe('outside_window');
    await owner`
      UPDATE del_drivers SET cash_blocked_at = now(), cash_blocked_reason = 'test'
      WHERE id = ${w.driver.driverId}`;
    expect(await reasonOf({ vehicle_id: w.vehicleId })).toBe('cash_blocked');
  });

  it('starts ad hoc, pauses, resumes and ends; the end replays by key, a new key is 409', async () => {
    const w = await world();
    const started = driverOps.driverStartShift.responses['200'].parse(
      (
        await driverPost(w.session, '/v1/driver/shifts/start', { vehicle_id: w.vehicleId }).expect(
          200,
        )
      ).body,
    );
    expect(started).toMatchObject({ status: 'active', site_id: w.driver.siteId });
    expect(
      new Date(started.planned_end ?? '').getTime() -
        new Date(started.planned_start ?? '').getTime(),
    ).toBe(12 * 60 * 60 * 1000);
    const path = (action: string) => `/v1/driver/shifts/${started.id}/${action}`;
    expect(shiftOf((await driverPost(w.session, path('pause')).expect(200)).body).status).toBe(
      'paused',
    );
    // A driver may not end a paused shift (§3.17: the dispatcher may).
    const pausedEnd = await driverPost(w.session, path('end')).expect(409);
    expect(errorOf(pausedEnd.body).details).toMatchObject({ current_status: 'paused' });
    expect(shiftOf((await driverPost(w.session, path('resume')).expect(200)).body).status).toBe(
      'active',
    );

    const key = nextKey();
    const ended = await driverPost(w.session, path('end'), {}, key).expect(200);
    expect(ended.body).toMatchObject({ status: 'ended' });
    expect(shiftOf(ended.body).ended_at).not.toBeNull();
    const replay = await driverPost(w.session, path('end'), {}, key).expect(200);
    expect(replay.body).toEqual(ended.body);
    const fresh = await driverPost(w.session, path('end')).expect(409);
    expect(errorOf(fresh.body)).toMatchObject({
      code: 'invalid_transition',
      details: { current_status: 'ended' },
    });
    const events = await eventsOf(started.id);
    expect(events.map((event) => event.type)).toEqual([
      'delivery.shift.started',
      'delivery.shift.ended',
    ]);
    expect(events[1]?.payload).toMatchObject({ ended_by: 'driver', shift_id: started.id });
    const me = driverOps.driverGetMe.responses['200'].parse(
      (await driverGet(w.session, '/v1/driver/me').expect(200)).body,
    );
    expect(me.current_shift).toBeNull();
    // The driver lists their own shifts, newest first.
    const list = driverOps.driverListShifts.responses['200'].parse(
      (await driverGet(w.session, '/v1/driver/shifts?status=ended').expect(200)).body,
    );
    expect(((list.data ?? []) as DriverShift[]).map((row) => row.id)).toEqual([started.id]);
  });

  it('lets the dispatcher end a paused shift; another driver’s shift is 404 to the driver', async () => {
    const w = await world();
    const started = driverOps.driverStartShift.responses['200'].parse(
      (
        await driverPost(w.session, '/v1/driver/shifts/start', { vehicle_id: w.vehicleId }).expect(
          200,
        )
      ).body,
    );
    await driverPost(w.session, `/v1/driver/shifts/${started.id}/pause`).expect(200);
    const other = await world();
    await driverPost(other.session, `/v1/driver/shifts/${started.id}/resume`).expect(404);
    const response = await staffPost(w.dispatcher, `/v1/staff/shifts/${started.id}/end`, {
      note: 'Vehicle broke down',
    }).expect(200);
    expect(shiftOf(response.body).status).toBe('ended');
    const events = await eventsOf(started.id);
    expect(events.at(-1)).toMatchObject({
      type: 'delivery.shift.ended',
      payload: { ended_by: 'dispatcher' },
    });
    const audit = await auditRowsOf(owner, response.headers['x-request-id'] as string);
    expect(audit[0]).toMatchObject({ action: 'delivery.shift.ended', actorType: 'user' });
    expect(audit[0]?.after).toMatchObject({ note: 'Vehicle broke down' });
  });
});
