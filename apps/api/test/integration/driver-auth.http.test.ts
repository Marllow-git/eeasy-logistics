import { randomBytes } from 'node:crypto';
import { operationSchemas, schemas } from '@eeasy-logistics/contracts/driver/schemas';
import { decodeJwt } from 'jose';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DriverSignIn } from '../../src/modules/kernel/auth/driver-sign-in.js';
import { OtpService } from '../../src/modules/kernel/messaging/otp.service.js';
import { testSigningKey } from '../support/access-tokens.js';
import { auditRowsOf } from './audit-rows.js';
import {
  codeOf,
  driverAddress,
  newDevice,
  plantDriver,
  requestCode,
  saudiMobile,
  signIn,
  verifyOn,
} from './driver-fixtures.js';
import type { StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';

// DEL-4 item D over HTTP (plan 2.7, 2.12, 2.15): a driver signs in with a WhatsApp code on a device
// (bearer pair, `dev` claim, `amr: ['otp']`, the refresh row bound to the device row), a second
// device works and a third is `409`; a stranger's phone, a suspended driver, a disabled person and a
// suspended account all meet the same `otp_invalid`; the request door costs one OTP request either
// way and sends nothing to a stranger; verifications are budgeted per address.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `driver-auth:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'driver-auth',
  TRUST_PROXY_HOPS: '1',
});
const errorOf = (body: unknown) => operationSchemas.driverVerifyOtp.responses['4XX'].parse(body);

describe('driver sign-in over HTTP (DEL-4 item D)', () => {
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

  it('signs a driver in on a device: bearer pair, dev claim, device-bound refresh row, audited', async () => {
    const driver = await plantDriver(owner);
    const device = newDevice({ platform: 'ios', push_token: 'ExponentPushToken[first]' });
    const response = await verifyOn(http, owner, config, driver.phone, device);
    expect(response.status).toBe(200);
    const session = schemas.DriverVerifyOtp200Response.parse(response.body);
    expect(session).toMatchObject({
      driver: { id: driver.driverId, status: 'active', phone: driver.phone },
      device: {
        device_id: device.device_id,
        platform: 'ios',
        app_version: '1.0.0',
        push_token: 'ExponentPushToken[first]',
        revoked_at: null,
      },
      cash_pin_set: false,
      tokens: { expires_in: 900 },
    });
    expect(response.headers['set-cookie']).toBeUndefined();
    const claims = decodeJwt(session.tokens?.access_token ?? '');
    expect(claims).toMatchObject({
      aud: 'driver',
      sub: driver.userId,
      acc: driver.accountId,
      mem: driver.membershipId,
      dev: session.device?.id,
      amr: ['otp'],
      roles: ['driver'],
    });
    const [row] = await owner<{ device_id: string; surface: string; days: number }[]>`
      SELECT device_id, surface,
             round(extract(epoch from (expires_at - now())) / 86400)::int AS days
      FROM core_refresh_tokens WHERE user_id = ${driver.userId}`;
    expect(row).toEqual({ device_id: session.device?.id, surface: 'driver', days: 90 });
    const actions = (await auditRowsOf(owner, String(response.headers['x-request-id']))).map(
      (audit) => [audit.action, audit.accountId],
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        ['core.session.started', driver.accountId],
        ['delivery.driver_device.registered', driver.accountId],
      ]),
    );
  });

  it('binds two devices, refuses a third with 409, and lets a bound device sign in again', async () => {
    const driver = await plantDriver(owner);
    const first = newDevice();
    await signIn(http, owner, config, driver.phone, first);
    await signIn(http, owner, config, driver.phone, newDevice());
    const third = await verifyOn(http, owner, config, driver.phone, newDevice());
    expect(third.status).toBe(409);
    expect(errorOf(third.body).code).toBe('device_limit_reached');
    const again = await verifyOn(http, owner, config, driver.phone, {
      ...first,
      app_version: '1.1.0',
    });
    expect(again.status).toBe(200);
    expect(schemas.DriverVerifyOtp200Response.parse(again.body).device).toMatchObject({
      device_id: first.device_id,
      app_version: '1.1.0',
    });
    const registered = (await auditRowsOf(owner, String(again.headers['x-request-id']))).filter(
      (audit) => audit.action === 'delivery.driver_device.registered',
    );
    expect(registered).toHaveLength(0);
    const [{ active } = { active: -1 }] = await owner<{ active: number }[]>`
      SELECT count(*)::int AS active FROM del_driver_devices
      WHERE driver_id = ${driver.driverId} AND revoked_at IS NULL`;
    expect(active).toBe(2);
  });

  it('never brings a revoked app id back (401 device_revoked); new ids register up to the cap (adversary M-1)', async () => {
    const driver = await plantDriver(owner);
    const device = newDevice();
    const session = await signIn(http, owner, config, driver.phone, device);
    await owner`UPDATE del_driver_devices SET revoked_at = now() WHERE id = ${session.device?.id ?? ''}`;
    const again = await verifyOn(http, owner, config, driver.phone, device);
    expect(again.status).toBe(401);
    expect(errorOf(again.body).code).toBe('device_revoked');
    const [row] = await owner<{ revoked: boolean }[]>`
      SELECT revoked_at IS NOT NULL AS revoked FROM del_driver_devices
      WHERE id = ${session.device?.id ?? ''}`;
    expect(row?.revoked).toBe(true);
    // The revoked row does not count: two new app ids fit, a third does not.
    await signIn(http, owner, config, driver.phone, newDevice());
    await signIn(http, owner, config, driver.phone, newDevice());
    const third = await verifyOn(http, owner, config, driver.phone, newDevice());
    expect(third.status).toBe(409);
  });

  it('withdraws a session when the driver is suspended or the device revoked during the sign-in (adversary M-2)', async () => {
    // The original, called with the instance the app built (`apply` below).
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const start = DriverSignIn.prototype.start;
    const liveFamilies = async (deviceRowId: string) =>
      (
        await owner<{ live: number }[]>`
          SELECT count(*) FILTER (WHERE revoked_at IS NULL)::int AS live FROM core_refresh_tokens
          WHERE device_id = ${deviceRowId}`
      )[0]?.live;
    const cases = [
      { change: 'suspended', code: 'otp_invalid' },
      { change: 'revoked', code: 'device_revoked' },
    ] as const;
    for (const { change, code } of cases) {
      const driver = await plantDriver(owner);
      let deviceRowId = '';
      const spy = vi.spyOn(DriverSignIn.prototype, 'start').mockImplementationOnce(async function (
        this: DriverSignIn,
        ...args
      ) {
        const issued = await start.apply(this, args);
        deviceRowId = args[1];
        if (change === 'suspended') {
          await owner`UPDATE del_drivers SET status = 'suspended' WHERE id = ${driver.driverId}`;
        } else {
          await owner`UPDATE del_driver_devices SET revoked_at = now() WHERE id = ${deviceRowId}`;
        }
        return issued;
      });
      try {
        const response = await verifyOn(http, owner, config, driver.phone, newDevice());
        expect(response.status).toBe(401);
        expect(errorOf(response.body).code).toBe(code);
      } finally {
        spy.mockRestore();
      }
      expect(deviceRowId).not.toBe('');
      expect(await liveFamilies(deviceRowId)).toBe(0);
    }
  });

  it('asks a phone that drives for two accounts to choose, without spending the code (adversary H-2)', async () => {
    const inA = await plantDriver(owner);
    const inB = await plantDriver(owner, { userId: inA.userId, phone: inA.phone });
    const names = await owner<{ id: string; name: string }[]>`
      SELECT id, name FROM core_accounts WHERE id IN (${inA.accountId}, ${inB.accountId})`;
    await requestCode(http, owner, inA.phone);
    const code = await codeOf(owner, config, inA.phone);
    const verify = (body: object) =>
      http()
        .post('/v1/driver/auth/otp/verify')
        .set('X-Forwarded-For', driverAddress())
        .set('Accept-Language', 'en')
        .send({ phone: inA.phone, code, device: newDevice(), ...body });

    const choice = await verify({}).expect(409);
    const body = errorOf(choice.body);
    expect(body.code).toBe('account_choice_required');
    const accounts = (body.details as { accounts: { account_id: string; name: string }[] })
      .accounts;
    expect([...accounts].sort((x, y) => x.account_id.localeCompare(y.account_id))).toEqual(
      names
        .map((row) => ({ account_id: row.id, name: row.name }))
        .sort((x, y) => x.account_id.localeCompare(y.account_id)),
    );
    // No session, no device row yet; the same code then signs into the chosen account, once.
    const [devices] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM del_driver_devices
      WHERE driver_id IN (${inA.driverId}, ${inB.driverId})`;
    expect(devices?.n).toBe(0);
    const chosen = await verify({ account_id: inB.accountId }).expect(200);
    expect(schemas.DriverVerifyOtp200Response.parse(chosen.body).driver?.id).toBe(inB.driverId);
    expect(errorOf((await verify({ account_id: inB.accountId }).expect(401)).body).code).toBe(
      'otp_invalid',
    );
  });

  it("answers otp_invalid for an account_id that names none of the phone's active drivers", async () => {
    const driver = await plantDriver(owner);
    const suspended = await plantDriver(owner, {
      userId: driver.userId,
      phone: driver.phone,
      driverStatus: 'suspended',
    });
    const other = await plantDriver(owner);
    for (const accountId of [suspended.accountId, other.accountId]) {
      const response = await verifyOn(http, owner, config, driver.phone, newDevice(), accountId);
      expect(response.status).toBe(401);
      expect(errorOf(response.body).code).toBe('otp_invalid');
    }
    // One active row: no choice needed, and naming it works too.
    const session = await signIn(http, owner, config, driver.phone, newDevice(), driver.accountId);
    expect(session.driver?.id).toBe(driver.driverId);
    expect((await signIn(http, owner, config, driver.phone)).driver?.id).toBe(driver.driverId);
  });

  it('answers 400 for a device the table would refuse, before the code is spent', async () => {
    const driver = await plantDriver(owner);
    await requestCode(http, owner, driver.phone);
    const code = await codeOf(owner, config, driver.phone);
    const refused = await http()
      .post('/v1/driver/auth/otp/verify')
      .set('X-Forwarded-For', driverAddress())
      .send({ phone: driver.phone, code, device: newDevice({ device_id: '' }) })
      .expect(400);
    expect(
      errorOf(refused.body).details?.fields?.map(({ pointer, code }) => ({ pointer, code })),
    ).toEqual([{ pointer: '/body/device/device_id', code: 'invalid' }]);
    await http()
      .post('/v1/driver/auth/otp/verify')
      .set('X-Forwarded-For', driverAddress())
      .send({ phone: driver.phone, code, device: newDevice() })
      .expect(200);
  });

  it('answers one otp_invalid body to a stranger, a suspended driver, a disabled person and a suspended account', async () => {
    const bodies: unknown[] = [];
    const verifyWith = async (phone: string, code: string): Promise<unknown> =>
      (
        await http()
          .post('/v1/driver/auth/otp/verify')
          .set('X-Forwarded-For', driverAddress())
          .set('Accept-Language', 'en')
          .send({ phone, code, device: newDevice() })
          .expect(401)
      ).body;
    bodies.push(await verifyWith(saudiMobile(), '123456'));
    for (const change of ['suspend', 'disable', 'account'] as const) {
      const driver = await plantDriver(owner);
      await requestCode(http, owner, driver.phone);
      const code = await codeOf(owner, config, driver.phone);
      if (change === 'suspend') {
        await owner`UPDATE del_drivers SET status = 'suspended' WHERE id = ${driver.driverId}`;
      } else if (change === 'disable') {
        await owner`UPDATE core_users SET disabled_at = now() WHERE id = ${driver.userId}`;
      } else {
        await owner`UPDATE core_accounts SET status = 'suspended' WHERE id = ${driver.accountId}`;
      }
      bodies.push(await verifyWith(driver.phone, code));
      const sessions = await owner`
        SELECT id FROM core_refresh_tokens WHERE user_id = ${driver.userId}`;
      expect(sessions).toHaveLength(0);
    }
    const [first] = bodies.map(errorOf);
    for (const body of bodies.map(errorOf)) {
      expect(body.code).toBe('otp_invalid');
      expect(body.message).toBe(first?.message);
      expect(Object.keys(body).sort()).toEqual(['code', 'message', 'request_id']);
    }
  });

  it('runs one OTP request and one verification for any phone, and sends a stranger nothing', async () => {
    const otp = staff.app.get(OtpService, { strict: false });
    const requests = vi.spyOn(otp, 'request');
    const verifications = vi.spyOn(otp, 'verify');
    try {
      const stranger = saudiMobile();
      const driver = await plantDriver(owner);
      await requestCode(http, owner, stranger);
      await requestCode(http, owner, driver.phone);
      expect(requests.mock.calls.map(([input]) => input.deliver)).toEqual([false, true]);
      const sent = await owner<{ to: string }[]>`
        SELECT payload->>'to' AS to FROM core_outbox
        WHERE kind = 'message' AND payload->>'to' IN ${owner([stranger, driver.phone])}`;
      expect(sent.map((row) => row.to)).toEqual([driver.phone]);
      expect(
        await owner`SELECT id FROM core_otp_challenges WHERE phone = ${stranger}`,
      ).toHaveLength(1);
      await http()
        .post('/v1/driver/auth/otp/verify')
        .set('X-Forwarded-For', driverAddress())
        .send({ phone: stranger, code: '123456', device: newDevice() })
        .expect(401);
      expect(verifications).toHaveBeenCalledTimes(1);
    } finally {
      requests.mockRestore();
      verifications.mockRestore();
    }
  });

  it('budgets verifications at 20 an hour per address (driver_verify_ip)', async () => {
    // An address no other test of this run uses (the random ones are 203.0.113.0/24).
    const address = '198.18.0.1';
    const phone = saudiMobile();
    const verify = () =>
      http()
        .post('/v1/driver/auth/otp/verify')
        .set('X-Forwarded-For', address)
        .send({ phone, code: '000000', device: newDevice() });
    for (let attempt = 0; attempt < 20; attempt += 1) await verify().expect(401);
    const refused = await verify().expect(429);
    expect(errorOf(refused.body).code).toBe('rate_limited');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
  });
});
