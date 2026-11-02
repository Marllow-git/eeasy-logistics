import { randomBytes } from 'node:crypto';
import type { DriverSession } from '@eeasy-logistics/contracts/driver/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/driver/schemas';
import type { AppDatabase, Pool } from '@eeasy-logistics/db';
import { createAppPool } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { driverPushInvalidation } from '../../src/modules/delivery/public/index.js';
import { PushTokenInvalidations } from '../../src/modules/kernel/public/index.js';
import { testSigningKey } from '../support/access-tokens.js';
import { auditRowsOf } from './audit-rows.js';
import {
  codeOf,
  driverAddress,
  newDevice,
  plantDriver,
  requestCode,
  signIn,
} from './driver-fixtures.js';
import type { PlantedDriver } from './driver-fixtures.js';
import type { StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';

// DEL-4 item F over HTTP (plan 2.9, 2.11, 2.15; ADR-0034): the first cash PIN with a fresh code, a
// change with the current PIN, four wrong then the fifth locks (the count survives each 403),
// `driverVerifyCashPin` 423 while locked, the dispatcher's reset and a new PIN with a code; the PIN
// never reaches an audit row, the idempotency store or a response; and INT-4's registry clears a
// device's push token through Delivery's handler.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `cash-pin:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'cash-pin',
  TRUST_PROXY_HOPS: '1',
});
const errorOf = (body: unknown) => operationSchemas.driverSetCashPin.responses['4XX'].parse(body);

let keySequence = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

describe('the driver cash PIN over HTTP (DEL-4 item F)', () => {
  let staff: StaffApp;
  let owner: postgres.Sql;
  let appPool: Pool<AppDatabase>;
  const http = () => staff.http();

  beforeAll(async () => {
    owner = connectAs('owner', config);
    staff = await startStaffApp(config, owner);
    appPool = createAppPool(config.db, 'del4-push-invalidation-test');
  });

  afterAll(async () => {
    await appPool?.close();
    await staff?.close();
    await owner.end();
  });

  const bearer = (session: DriverSession) => `Bearer ${session.tokens?.access_token ?? ''}`;
  const setPin = (session: DriverSession, body: object, key = nextKey()) =>
    http()
      .put('/v1/driver/cash-pin')
      .set('Authorization', bearer(session))
      .set('X-Forwarded-For', driverAddress())
      .set('Idempotency-Key', key)
      .set('Accept-Language', 'en')
      .send(body);
  const verifyPin = (session: DriverSession, pin: string) =>
    http()
      .post('/v1/driver/cash-pin/verify')
      .set('Authorization', bearer(session))
      .set('X-Forwarded-For', driverAddress())
      .set('Accept-Language', 'en')
      .send({ cash_pin: pin });
  const freshCode = async (driver: PlantedDriver) => {
    await requestCode(http, owner, driver.phone);
    return codeOf(owner, config, driver.phone);
  };
  const pinState = async (driverId: string) =>
    (
      await owner<{ hash: string | null; failures: number; locked: boolean }[]>`
        SELECT cash_pin_hash AS hash, cash_pin_failures AS failures,
               cash_pin_locked_at IS NOT NULL AS locked
        FROM del_drivers WHERE id = ${driverId}`
    )[0];
  const withSession = async () => {
    const driver = await plantDriver(owner);
    const session = await signIn(http, owner, config, driver.phone, newDevice());
    return { driver, session };
  };

  it('sets the first PIN with a fresh code, Argon2id, audited without the PIN', async () => {
    const { driver, session } = await withSession();
    expect((await setPin(session, { pin: '4821' }).expect(401)).body).toMatchObject({
      code: 'otp_invalid',
    });
    await setPin(session, { pin: '4821', otp_code: '000000' }).expect(401);
    const response = await setPin(session, {
      pin: '958371',
      otp_code: await freshCode(driver),
    }).expect(204);
    expect(response.text).toBe('');
    const state = await pinState(driver.driverId);
    expect(state?.hash).toMatch(/^\$argon2id\$/);
    expect(state?.hash).not.toContain('958371');
    const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
    expect(audit.map((row) => [row.action, row.after])).toEqual([
      ['delivery.driver.cash_pin_set', { was_set: true, failures: 0, method: 'otp' }],
    ]);
    const leaks = await owner<{ n: number }[]>`
      SELECT (SELECT count(*) FROM core_audit_log WHERE after::text LIKE '%958371%'
                OR before::text LIKE '%958371%')::int
           + (SELECT count(*) FROM core_idempotency_keys
              WHERE response_body::text LIKE '%958371%')::int AS n`;
    expect(leaks[0]?.n).toBe(0);
    const me = await http().get('/v1/driver/me').set('Authorization', bearer(session)).expect(200);
    expect(me.body).toMatchObject({ cash_pin_set: true });
  });

  it('changes the PIN with the current one; a wrong current PIN is counted', async () => {
    const { driver, session } = await withSession();
    await setPin(session, { pin: '1111', otp_code: await freshCode(driver) }).expect(204);
    const wrong = await setPin(session, { pin: '2222', current_pin: '9999' }).expect(403);
    expect(errorOf(wrong.body).code).toBe('cash_pin_invalid');
    expect((await pinState(driver.driverId))?.failures).toBe(1);
    // A code does not stand in for the current PIN once one is set.
    await setPin(session, { pin: '2222', otp_code: '123456' }).expect(403);
    await setPin(session, { pin: '2222', current_pin: '1111' }).expect(204);
    expect((await pinState(driver.driverId))?.failures).toBe(0);
    await verifyPin(session, '2222').expect(204);
  });

  it('locks on the fifth wrong PIN, answers 423 until the dispatcher resets, then a code sets a new one', async () => {
    const { driver, session } = await withSession();
    const none = await verifyPin(session, '1234').expect(403);
    await setPin(session, { pin: '1234', otp_code: await freshCode(driver) }).expect(204);
    const bodies: unknown[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      bodies.push((await verifyPin(session, '0000').expect(403)).body);
    }
    expect((await pinState(driver.driverId))?.failures).toBe(4);
    const fifth = await verifyPin(session, '0000').expect(403);
    for (const body of [none.body, ...bodies, fifth.body].map(errorOf)) {
      expect(body.code).toBe('cash_pin_invalid');
      expect(Object.keys(body).sort()).toEqual(['code', 'message', 'request_id']);
    }
    expect(await pinState(driver.driverId)).toMatchObject({ failures: 5, locked: true });
    const locked = await auditRowsOf(owner, String(fifth.headers['x-request-id']));
    expect(locked.map((row) => [row.action, row.after])).toEqual([
      ['delivery.driver.cash_pin_locked', { locked: true, failures: 5 }],
    ]);
    expect(errorOf((await verifyPin(session, '1234').expect(423)).body).code).toBe(
      'cash_pin_locked',
    );
    await setPin(session, { pin: '5678', current_pin: '1234' }).expect(423);

    const dispatcher = await staff.member(driver.accountId, ['dispatcher']);
    await http()
      .post(`/v1/staff/drivers/${driver.driverId}/cash-pin/reset`)
      .set(staff.writeHeaders())
      .set('Cookie', dispatcher.cookie)
      .set('Idempotency-Key', nextKey())
      .expect(204);
    await setPin(session, { pin: '5678', current_pin: '1234' }).expect(401);
    await setPin(session, { pin: '5678', otp_code: await freshCode(driver) }).expect(204);
    await verifyPin(session, '5678').expect(204);
  });

  it('budgets PIN calls at 30 an hour per address (driver_pin_ip)', async () => {
    const { session } = await withSession();
    const address = '198.18.0.2';
    const call = () =>
      http()
        .post('/v1/driver/cash-pin/verify')
        .set('Authorization', bearer(session))
        .set('X-Forwarded-For', address)
        .send({ cash_pin: '1234' });
    for (let attempt = 0; attempt < 30; attempt += 1) await call().expect(403);
    expect(errorOf((await call().expect(429)).body).code).toBe('rate_limited');
  });

  it("clears a device's push token through INT-4's registry; an unknown device is a no-op", async () => {
    const { driver, session } = await withSession();
    await owner`UPDATE del_driver_devices SET push_token = 'ExponentPushToken[gone]'
                WHERE id = ${session.device?.id ?? ''}`;
    const registry = new PushTokenInvalidations({ log: () => undefined, warn: () => undefined });
    registry.register(driverPushInvalidation(appPool.db));
    const invalidation = {
      accountId: driver.accountId,
      deviceId: session.device?.id ?? '',
      reason: 'device_not_registered' as const,
    };
    expect(await registry.invalidate(invalidation)).toBe(1);
    const [row] = await owner<{ push_token: string | null }[]>`
      SELECT push_token FROM del_driver_devices WHERE id = ${session.device?.id ?? ''}`;
    expect(row?.push_token).toBeNull();
    expect(await registry.invalidate(invalidation)).toBe(1);
    expect(
      await registry.invalidate({
        ...invalidation,
        deviceId: '00000000-0000-7000-8000-000000000000',
      }),
    ).toBe(1);
    // Another account's id never reaches this device.
    await owner`UPDATE del_driver_devices SET push_token = 'ExponentPushToken[kept]'
                WHERE id = ${session.device?.id ?? ''}`;
    await registry.invalidate({
      ...invalidation,
      accountId: '00000000-0000-7000-8000-000000000001',
    });
    const [kept] = await owner<{ push_token: string | null }[]>`
      SELECT push_token FROM del_driver_devices WHERE id = ${session.device?.id ?? ''}`;
    expect(kept?.push_token).toBe('ExponentPushToken[kept]');
  });
});
