import { randomBytes } from 'node:crypto';
import type { DriverSession } from '@eeasy-logistics/contracts/driver/schemas';
import { operationSchemas as driverOps } from '@eeasy-logistics/contracts/driver/schemas';
import type { DriverPosition } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { uuidv7 } from '@eeasy-logistics/db';
import { Redis } from 'ioredis';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LOCATION_FANOUT,
  RedisLocationFanout,
} from '../../src/modules/delivery/locations/location-fanout.js';
import { testSigningKey } from '../support/access-tokens.js';
import { driverAddress, plantDriver, signIn } from './driver-fixtures.js';
import type { PlantedDriver } from './driver-fixtures.js';
import type { SignedInMember, StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';

// DEL-5 item C over HTTP (plan 2.6, 2.7, 2.10): the ingest into the ring of 240 (slots across the
// wrap), the head's latest point, the Redis hash and the per-account channel, `202` without Redis,
// `409 shift_not_active` off shift, the per-driver budget's `429`, out-of-order and future points
// dropped; the latest positions by site with the head as fallback; the day's trail; another
// account's positions and trails invisible.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `locations:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'locations',
  TRUST_PROXY_HOPS: '1',
  // An app below this minimum still posts its queued points (`@ReplayRoute()`, adversary L-c).
  DRIVER_MIN_APP_VERSION_IOS: '1.4.0',
});
const redisUrl = config.redis.url?.reveal() ?? '';

const errorOf = (body: unknown) => driverOps.driverPostLocations.responses['4XX'].parse(body);
const latestOp = operationSchemas.listLatestDriverPositions;
const trailOp = operationSchemas.getDriverTrail;

let keySequence = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

/** `count` points one second apart ending `endAgoS` seconds ago, around central Riyadh. */
const pointsEnding = (count: number, endAgoS: number, extra: object = {}) =>
  Array.from({ length: count }, (_, index) => ({
    client_ts: new Date(Date.now() - (endAgoS + count - 1 - index) * 1000).toISOString(),
    lat: 24.7 + index / 10_000,
    lng: 46.6 + index / 10_000,
    accuracy_m: 8,
    battery_pct: 80,
    is_charging: index % 2 === 0,
    power_saver: false,
    ...extra,
  }));

describe('the location doors over HTTP (DEL-5 item C)', () => {
  let staff: StaffApp;
  let owner: postgres.Sql;
  let redis: Redis;
  const http = () => staff.http();

  beforeAll(async () => {
    owner = connectAs('owner', config);
    staff = await startStaffApp(config, owner);
    redis = new Redis(redisUrl);
  });

  afterAll(async () => {
    await staff?.close();
    redis?.disconnect();
    await owner.end();
  });

  const bearer = (session: DriverSession) => `Bearer ${session.tokens?.access_token ?? ''}`;
  const post = (app: StaffApp, session: DriverSession, points: object[]) =>
    app
      .http()
      .post('/v1/driver/locations')
      .set('Authorization', bearer(session))
      .set('X-Forwarded-For', driverAddress())
      .set('Accept-Language', 'en')
      .send({ points });
  const driverPost = (session: DriverSession, path: string, body: object = {}) =>
    http()
      .post(path)
      .set('Authorization', bearer(session))
      .set('X-Forwarded-For', driverAddress())
      .set('Idempotency-Key', nextKey())
      .set('Accept-Language', 'en')
      .send(body);
  const staffGet = (member: SignedInMember, path: string) =>
    http().get(path).set('Cookie', member.cookie).set('Accept-Language', 'en');

  async function insertVehicle(accountId: string): Promise<string> {
    const id = uuidv7();
    await owner`
      INSERT INTO del_vehicles (id, account_id, plate, kind, capacity_parcels)
      VALUES (${id}, ${accountId}, ${`P ${randomBytes(4).toString('hex')}`}, 'van', 40)`;
    return id;
  }

  /** A driver signed in and on an ad hoc shift at its home site; the shift id. */
  async function onShift(accountId?: string): Promise<{
    driver: PlantedDriver;
    session: DriverSession;
    shiftId: string;
  }> {
    const driver = await plantDriver(owner, accountId === undefined ? {} : { accountId });
    const session = await signIn(http, owner, config, driver.phone);
    const started = await driverPost(session, '/v1/driver/shifts/start', {
      vehicle_id: await insertVehicle(driver.accountId),
    }).expect(200);
    return {
      driver,
      session,
      shiftId: driverOps.driverStartShift.responses['200'].parse(started.body).id ?? '',
    };
  }

  const ringOf = (driverId: string) =>
    owner<{ n: number; min: number; max: number; misplaced: number }[]>`
      SELECT count(*)::int AS n, min(seq)::int AS min, max(seq)::int AS max,
             count(*) FILTER (WHERE slot <> seq % 240)::int AS misplaced
      FROM del_driver_locations WHERE driver_id = ${driverId}`;
  const headOf = async (driverId: string) =>
    (
      await owner<
        {
          last_seq: number;
          lat: number;
          lng: number;
          last_client_ts: Date;
          last_server_ts: Date;
        }[]
      >`
        SELECT last_seq::int, ST_Y(last_point) AS lat, ST_X(last_point) AS lng, last_client_ts,
               last_server_ts
        FROM del_driver_location_heads WHERE driver_id = ${driverId}`
    )[0];

  it('answers 409 shift_not_active off shift and 400 for a point out of range', async () => {
    const driver = await plantDriver(owner);
    const session = await signIn(http, owner, config, driver.phone);
    const off = await post(staff, session, pointsEnding(1, 5)).expect(409);
    expect(errorOf(off.body).code).toBe('shift_not_active');
    const bad = await post(staff, session, pointsEnding(1, 5, { lat: 91 })).expect(400);
    expect(errorOf(bad.body).details).toMatchObject({
      fields: [{ pointer: '/body/points/0/lat', code: 'invalid' }],
    });
  });

  it('writes a batch to the ring, the head, the latest hash and the channel', async () => {
    const { driver, session, shiftId } = await onShift();
    const subscriber = new Redis(redisUrl);
    const received: unknown[] = [];
    subscriber.on('message', (_channel: string, message: string) => {
      received.push(JSON.parse(message));
    });
    await subscriber.subscribe(`elx:loc:${driver.accountId}`);
    const points = pointsEnding(20, 2);
    await post(staff, session, points).expect(202);

    expect(await ringOf(driver.driverId)).toEqual([{ n: 20, min: 1, max: 20, misplaced: 0 }]);
    const [row] = await owner<{ shift_id: string; is_charging: boolean; battery_pct: number }[]>`
      SELECT shift_id, is_charging, battery_pct FROM del_driver_locations
      WHERE driver_id = ${driver.driverId} AND seq = 1`;
    expect(row).toEqual({ shift_id: shiftId, is_charging: true, battery_pct: 80 });
    const newest = points[19];
    const head = await headOf(driver.driverId);
    expect(head).toMatchObject({ last_seq: 20, lat: newest?.lat, lng: newest?.lng });
    expect(head?.last_client_ts.toISOString()).toBe(newest?.client_ts);

    const hash = await redis.hgetall(`elx:loc:latest:${driver.accountId}:${driver.driverId}`);
    expect(hash).toMatchObject({
      lat: String(newest?.lat),
      lng: String(newest?.lng),
      client_ts: newest?.client_ts,
      shift_status: 'active',
    });
    // The head's state as committed (adversary F3): its database time, not the API's clock.
    expect(hash.server_ts).toBe(head?.last_server_ts.toISOString());
    const ttl = await redis.ttl(`elx:loc:latest:${driver.accountId}:${driver.driverId}`);
    expect(ttl).toBeGreaterThan(590);
    for (let wait = 0; received.length < 20 && wait < 50; wait += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    subscriber.disconnect();
    expect(received).toHaveLength(20);
    expect(received[19]).toEqual({
      driver_id: driver.driverId,
      lat: newest?.lat,
      lng: newest?.lng,
      client_ts: newest?.client_ts,
      shift_status: 'active',
    });
    // No outbox row for a point (ADR-0028): only the shift's started event.
    const [outbox] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM core_outbox WHERE aggregate_id = ${driver.driverId}`;
    expect(outbox?.n).toBe(0);
  });

  it('keeps 240 points after 250, each in slot seq % 240; drops late and future points', async () => {
    const { driver, session, shiftId } = await onShift();
    // Ten points already in the ring (seq 1 to 10), as an earlier hour of the shift left them.
    await owner`
      INSERT INTO del_driver_location_heads (driver_id, account_id, last_seq, last_client_ts)
      VALUES (${driver.driverId}, ${driver.accountId}, 10, now() - interval '2 hours')`;
    await owner`
      INSERT INTO del_driver_locations (account_id, driver_id, slot, seq, shift_id, point,
                                        client_ts, server_ts)
      SELECT ${driver.accountId}, ${driver.driverId}, s, s, ${shiftId},
             ST_SetSRID(ST_MakePoint(46.6, 24.7), 4326), now() - interval '2 hours', now()
      FROM generate_series(1, 10) AS s`;
    for (let batch = 0; batch < 12; batch += 1) {
      await post(staff, session, pointsEnding(20, 600 - batch * 30)).expect(202);
    }
    expect(await ringOf(driver.driverId)).toEqual([{ n: 240, min: 11, max: 250, misplaced: 0 }]);
    const before = await headOf(driver.driverId);
    expect(before?.last_seq).toBe(250);
  });

  it('drops points not newer than the head, too far ahead or too old; refuses the 13th batch a minute', async () => {
    const { driver, session } = await onShift();
    await post(staff, session, pointsEnding(1, 60)).expect(202);
    const ahead = new Date(Date.now() + 6 * 60_000).toISOString();
    const stale = new Date(Date.now() - 120_000).toISOString();
    const old = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
    await post(staff, session, [
      { client_ts: ahead, lat: 24.7, lng: 46.6 },
      { client_ts: stale, lat: 24.7, lng: 46.6 },
      { client_ts: old, lat: 24.7, lng: 46.6 },
    ]).expect(202);
    expect((await headOf(driver.driverId))?.last_seq).toBe(1);

    // Two batches used; a fixed one-minute window may roll over once while the loop runs, so 25
    // more batches always meet the budget of 12 within one window.
    const statuses: number[] = [];
    for (let batch = 0; batch < 25; batch += 1) {
      const response = await post(staff, session, pointsEnding(1, 30 - batch));
      statuses.push(response.status);
      if (response.status === 429) {
        expect(errorOf(response.body).code).toBe('rate_limited');
        break;
      }
    }
    expect(statuses).toContain(429);
  });

  it('answers 409 after the shift ended and drops the latest key', async () => {
    const { driver, session, shiftId } = await onShift();
    await post(staff, session, pointsEnding(2, 5)).expect(202);
    const key = `elx:loc:latest:${driver.accountId}:${driver.driverId}`;
    expect(await redis.exists(key)).toBe(1);
    await driverPost(session, `/v1/driver/shifts/${shiftId}/end`).expect(200);
    expect(await redis.exists(key)).toBe(0);
    expect(errorOf((await post(staff, session, pointsEnding(1, 1)).expect(409)).body).code).toBe(
      'shift_not_active',
    );
  });

  it('keeps the newer latest point when two batches’ Redis writes overtake each other (F3)', async () => {
    // A client with the offline queue, so the first write waits for the connection.
    const fanout = new RedisLocationFanout(new Redis(redisUrl));
    const accountId = uuidv7();
    const driverId = uuidv7();
    const key = `elx:loc:latest:${accountId}:${driverId}`;
    const at = (seconds: number) => new Date(Date.UTC(2026, 10, 2, 8, 0, seconds)).toISOString();
    const write = (seconds: number, lat: number) =>
      fanout.publish(
        accountId,
        {
          driverId,
          lat,
          lng: 46.6,
          clientTs: at(seconds),
          serverTs: at(seconds + 1),
          shiftStatus: 'active',
        },
        [],
      );
    try {
      await write(30, 24.73); // the later batch's write lands first
      await write(10, 24.71); // the earlier batch's write arrives late: kept out
      expect(await redis.hgetall(key)).toMatchObject({ client_ts: at(30), lat: '24.73' });
      await write(30, 24.79); // the same device time: kept out too
      expect(await redis.hget(key, 'lat')).toBe('24.73');
      await write(40, 24.74);
      expect(await redis.hgetall(key)).toMatchObject({ client_ts: at(40), lat: '24.74' });
      expect(await redis.ttl(key)).toBeGreaterThan(590);
    } finally {
      await redis.del(key);
      fanout.onApplicationShutdown();
    }
  });

  it('takes points from an app below the minimum version, where other doors answer 426 (L-c)', async () => {
    const { driver, session } = await onShift();
    const outdated = <T extends { set(name: string, value: string): T }>(call: T): T =>
      call.set('X-App-Version', '1.3.9').set('X-App-Platform', 'ios');
    await outdated(post(staff, session, pointsEnding(1, 5))).expect(202);
    expect((await headOf(driver.driverId))?.last_seq).toBe(1);
    await outdated(http().get('/v1/driver/me').set('Authorization', bearer(session))).expect(426);
  });

  it('refuses a suspended driver and a revoked device with 401 (L-e)', async () => {
    const { driver, session } = await onShift();
    await owner`UPDATE del_drivers SET status = 'suspended' WHERE id = ${driver.driverId}`;
    const suspended = await post(staff, session, pointsEnding(1, 5)).expect(401);
    expect(errorOf(suspended.body).code).toBe('token_invalid');
    await owner`UPDATE del_drivers SET status = 'active' WHERE id = ${driver.driverId}`;
    await owner`
      UPDATE del_driver_devices SET revoked_at = now() WHERE id = ${session.device?.id ?? ''}`;
    const revoked = await post(staff, session, pointsEnding(1, 4)).expect(401);
    expect(errorOf(revoked.body).code).toBe('device_revoked');
    expect(await headOf(driver.driverId)).toBeUndefined();
  });

  it('accepts a batch with 202 when Redis is down; the head keeps the point', async () => {
    const { driver, session } = await onShift();
    // The fan-out's own connection points at a port nothing listens on (the rest of the app keeps
    // its Redis, which the suite's harness needs).
    const down = new RedisLocationFanout('redis://127.0.0.1:9/0');
    const app = await startStaffApp(config, owner, {
      configure: (builder) => builder.overrideProvider(LOCATION_FANOUT).useValue(down),
    });
    try {
      await post(app, session, pointsEnding(3, 5)).expect(202);
    } finally {
      await app.close();
      down.onApplicationShutdown();
    }
    expect((await headOf(driver.driverId))?.last_seq).toBe(3);
  });

  it('lists the latest position per driver on shift, by site, with the head as fallback', async () => {
    const first = await onShift();
    const second = await onShift(first.driver.accountId);
    await post(staff, first.session, pointsEnding(2, 5)).expect(202);
    // The second driver's point only in the head (its Redis key expired).
    await owner`
      INSERT INTO del_driver_location_heads (driver_id, account_id, last_seq, last_point,
                                             last_client_ts, last_server_ts)
      VALUES (${second.driver.driverId}, ${second.driver.accountId}, 1,
              ST_SetSRID(ST_MakePoint(46.71, 24.81), 4326), now() - interval '1 minute', now())`;
    const dispatcher = await staff.member(first.driver.accountId, ['dispatcher']);
    const positionsOf = async (query: string) =>
      (latestOp.responses['200'].parse(
        (await staffGet(dispatcher, `/v1/staff/driver-locations/latest${query}`).expect(200)).body,
      ).data ?? []) as DriverPosition[];

    const all = await positionsOf('');
    expect(all.map((position) => position.driver_id).sort()).toEqual(
      [first.driver.driverId, second.driver.driverId].sort(),
    );
    expect(all.find((p) => p.driver_id === second.driver.driverId)).toMatchObject({
      point: { lat: 24.81, lng: 46.71 },
      shift_status: 'active',
    });
    const atFirst = await positionsOf(`?site_id=${first.driver.siteId}`);
    expect(atFirst.map((position) => position.driver_id)).toEqual([first.driver.driverId]);

    const stranger = await plantDriver(owner);
    const other = await staff.member(stranger.accountId, ['viewer']);
    const theirs = latestOp.responses['200'].parse(
      (await staffGet(other, '/v1/staff/driver-locations/latest').expect(200)).body,
    );
    expect(theirs.data).toEqual([]);
  });

  it('answers the trail of a day as a GeoJSON line; another account and a missing day are 404', async () => {
    const driver = await plantDriver(owner);
    await owner`
      INSERT INTO del_driver_trails (id, account_id, driver_id, business_date, path, point_count,
                                     first_ts, last_ts)
      VALUES (${uuidv7()}, ${driver.accountId}, ${driver.driverId}, '2026-11-01',
              ST_GeomFromText('LINESTRING M (46.6 24.7 1761980000, 46.61 24.71 1761980015)', 4326),
              2, to_timestamp(1761980000), to_timestamp(1761980015))`;
    const dispatcher = await staff.member(driver.accountId, ['dispatcher']);
    const trail = trailOp.responses['200'].parse(
      (
        await staffGet(
          dispatcher,
          `/v1/staff/drivers/${driver.driverId}/trail?business_date=2026-11-01`,
        ).expect(200)
      ).body,
    );
    expect(trail).toEqual({
      driver_id: driver.driverId,
      business_date: '2026-11-01',
      line: {
        type: 'LineString',
        coordinates: [
          [46.6, 24.7],
          [46.61, 24.71],
        ],
      },
    });
    await staffGet(
      dispatcher,
      `/v1/staff/drivers/${driver.driverId}/trail?business_date=2026-11-02`,
    ).expect(404);
    const stranger = await plantDriver(owner);
    const other = await staff.member(stranger.accountId, ['dispatcher']);
    await staffGet(
      other,
      `/v1/staff/drivers/${driver.driverId}/trail?business_date=2026-11-01`,
    ).expect(404);
  });
});
