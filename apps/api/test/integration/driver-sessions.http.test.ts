import { randomBytes } from 'node:crypto';
import type { DriverSession } from '@eeasy-logistics/contracts/driver/schemas';
import { operationSchemas, schemas } from '@eeasy-logistics/contracts/driver/schemas';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testSigningKey } from '../support/access-tokens.js';
import { auditRowsOf } from './audit-rows.js';
import type { DeviceBody } from './driver-fixtures.js';
import { driverAddress, newDevice, plantDriver, signIn } from './driver-fixtures.js';
import type { StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';

// DEL-4 item E over HTTP (plan 2.8, 2.10, 2.15; lead ruling 8.2 #23): refresh rotates and its reuse
// revokes the family, the device verdict (another device id, a revoked device: `device_revoked` and
// the family dies), a suspended driver or account, suspension ending this membership's sessions only,
// logout, `driverGetMe`, the push token door and the app version guard.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `driver-sessions:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'driver-sessions',
  TRUST_PROXY_HOPS: '1',
  DRIVER_MIN_APP_VERSION_IOS: '1.4.0',
});
const errorOf = (body: unknown) => operationSchemas.driverRefresh.responses['4XX'].parse(body);

let keySequence = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

describe('driver sessions over HTTP (DEL-4 item E)', () => {
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

  const refresh = (refreshToken: string, deviceId: string, agent = 'EeasyDriver/1.0') =>
    http()
      .post('/v1/driver/auth/refresh')
      .set('X-Forwarded-For', driverAddress())
      .set('User-Agent', agent)
      .set('Accept-Language', 'en')
      .send({ refresh_token: refreshToken, device_id: deviceId });
  const bearer = (session: DriverSession) => `Bearer ${session.tokens?.access_token ?? ''}`;
  const signedIn = async (phone: string, device: DeviceBody = newDevice(), accountId?: string) => ({
    device,
    session: await signIn(http, owner, config, phone, device, accountId),
  });
  const familyRevoked = async (session: DriverSession) =>
    (
      await owner<{ live: number }[]>`
        SELECT count(*) FILTER (WHERE revoked_at IS NULL)::int AS live FROM core_refresh_tokens
        WHERE device_id = ${session.device?.id ?? ''}`
    )[0]?.live === 0;

  it('rotates the refresh token on the bound device, and a reuse outside the grace revokes the family', async () => {
    const driver = await plantDriver(owner);
    const { device, session } = await signedIn(driver.phone);
    const signedInToken = session.tokens?.refresh_token ?? '';
    // The grace compares the agent that stored the row: rotate once under the app's agent first.
    const first = schemas.DriverRefresh200Response.parse(
      (await refresh(signedInToken, device.device_id).expect(200)).body,
    ).refresh_token;
    expect(first).not.toBe(signedInToken);
    const rotated = schemas.DriverRefresh200Response.parse(
      (await refresh(first, device.device_id).expect(200)).body,
    );
    expect(rotated.refresh_token).not.toBe(first);
    expect(rotated.expires_in).toBe(900);
    // The same agent inside the grace gets the same successor back (two requests at once).
    const again = schemas.DriverRefresh200Response.parse(
      (await refresh(first, device.device_id).expect(200)).body,
    );
    expect(again.refresh_token).toBe(rotated.refresh_token);
    // Another agent is a reuse: the family dies, the successor with it.
    const reuse = await refresh(first, device.device_id, 'SomethingElse/1.0').expect(401);
    expect(errorOf(reuse.body).code).toBe('token_invalid');
    await refresh(rotated.refresh_token, device.device_id).expect(401);
    expect(await familyRevoked(session)).toBe(true);
  });

  it('refuses another device id as token_invalid and keeps the family', async () => {
    const driver = await plantDriver(owner);
    const { session } = await signedIn(driver.phone);
    const refused = await refresh(session.tokens?.refresh_token ?? '', 'another-device').expect(
      401,
    );
    expect(errorOf(refused.body).code).toBe('token_invalid');
    expect(await familyRevoked(session)).toBe(false);
  });

  it('answers device_revoked for a revoked device and revokes its family', async () => {
    const driver = await plantDriver(owner);
    const { device, session } = await signedIn(driver.phone);
    await owner`UPDATE del_driver_devices SET revoked_at = now() WHERE id = ${session.device?.id ?? ''}`;
    const refused = await refresh(session.tokens?.refresh_token ?? '', device.device_id).expect(
      401,
    );
    expect(errorOf(refused.body).code).toBe('device_revoked');
    expect(await familyRevoked(session)).toBe(true);
    const audit = await auditRowsOf(owner, String(refused.headers['x-request-id']));
    expect(audit.map((row) => [row.action, row.after])).toEqual([
      ['core.session.family_revoked', { surface: 'driver', reason: 'revoked' }],
    ]);
  });

  it("answers device_revoked after a dispatcher revokes the device, and the other device's session lives", async () => {
    const driver = await plantDriver(owner);
    const lost = await signedIn(driver.phone);
    const kept = await signedIn(driver.phone);
    const dispatcher = await staff.member(driver.accountId, ['dispatcher']);
    await http()
      .post(`/v1/staff/drivers/${driver.driverId}/devices/${lost.session.device?.id ?? ''}/revoke`)
      .set(staff.writeHeaders())
      .set('Cookie', dispatcher.cookie)
      .set('Idempotency-Key', nextKey())
      .expect(200);
    const refused = await refresh(
      lost.session.tokens?.refresh_token ?? '',
      lost.device.device_id,
    ).expect(401);
    expect(errorOf(refused.body).code).toBe('device_revoked');
    await refresh(kept.session.tokens?.refresh_token ?? '', kept.device.device_id).expect(200);
  });

  it('refuses a suspended driver as token_invalid and a suspended account as 403', async () => {
    const driver = await plantDriver(owner);
    const { device, session } = await signedIn(driver.phone);
    await owner`UPDATE del_drivers SET status = 'suspended' WHERE id = ${driver.driverId}`;
    const suspended = await refresh(session.tokens?.refresh_token ?? '', device.device_id).expect(
      401,
    );
    expect(errorOf(suspended.body).code).toBe('token_invalid');
    await owner`UPDATE del_drivers SET status = 'active' WHERE id = ${driver.driverId}`;
    await owner`UPDATE core_accounts SET status = 'suspended' WHERE id = ${driver.accountId}`;
    const account = await refresh(session.tokens?.refresh_token ?? '', device.device_id).expect(
      403,
    );
    expect(errorOf(account.body).code).toBe('account_suspended');
  });

  it("suspends a driver in one account without ending the person's session in another (ruling 8.2 #23)", async () => {
    const inA = await plantDriver(owner);
    const inB = await plantDriver(owner, { userId: inA.userId, phone: inA.phone });
    // The phone drives for two accounts: each sign-in names its account (adversary H-2).
    const b = await signedIn(inA.phone, newDevice(), inB.accountId);
    expect(b.session.driver?.id).toBe(inB.driverId);
    const a = await signedIn(inA.phone, newDevice(), inA.accountId);
    expect(a.session.driver?.id).toBe(inA.driverId);
    const [before] = await owner<{ v: number }[]>`
      SELECT token_version AS v FROM core_users WHERE id = ${inA.userId}`;

    const dispatcher = await staff.member(inB.accountId, ['dispatcher']);
    await http()
      .patch(`/v1/staff/drivers/${inB.driverId}`)
      .set(staff.writeHeaders())
      .set('Cookie', dispatcher.cookie)
      .set('Idempotency-Key', nextKey())
      .send({ status: 'suspended' })
      .expect(200);

    await refresh(b.session.tokens?.refresh_token ?? '', b.device.device_id).expect(401);
    await refresh(a.session.tokens?.refresh_token ?? '', a.device.device_id).expect(200);
    const [after] = await owner<{ v: number }[]>`
      SELECT token_version AS v FROM core_users WHERE id = ${inA.userId}`;
    expect(after?.v).toBe(before?.v);
  });

  it('logs this device out: its family ends, last_seen_at is marked, audited', async () => {
    const driver = await plantDriver(owner);
    const { device, session } = await signedIn(driver.phone);
    const response = await http()
      .post('/v1/driver/auth/logout')
      .set('Authorization', bearer(session))
      .expect(204);
    await refresh(session.tokens?.refresh_token ?? '', device.device_id).expect(401);
    const [seen] = await owner<{ seen: boolean }[]>`
      SELECT last_seen_at > now() - interval '1 minute' AS seen FROM del_driver_devices
      WHERE id = ${session.device?.id ?? ''}`;
    expect(seen?.seen).toBe(true);
    const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
    expect(audit.map((row) => [row.action, row.accountId])).toEqual([
      ['core.session.ended', driver.accountId],
    ]);
  });

  it('answers driverGetMe with the driver, this device, zero cash, the proof policy and the minimums', async () => {
    const driver = await plantDriver(owner);
    await owner`
      UPDATE core_accounts SET settings = ${owner.json({ proof_policy: { cod: ['photo'] } })}
      WHERE id = ${driver.accountId}`;
    const { session } = await signedIn(driver.phone, newDevice({ platform: 'ios' }));
    const me = schemas.DriverGetMe200Response.parse(
      (await http().get('/v1/driver/me').set('Authorization', bearer(session)).expect(200)).body,
    );
    expect(me).toMatchObject({
      driver: { id: driver.driverId, status: 'active', phone: driver.phone },
      device: { id: session.device?.id, platform: 'ios' },
      current_shift: null,
      cash: {
        cash_in_hand: { amount: 0, currency: 'SAR' },
        oldest_collected_business_date: null,
        liability_balance: { amount: 0, currency: 'SAR' },
        cash_blocked: false,
      },
      cash_pin_set: false,
      proof_policy: { delivery: [], cod: ['photo'] },
      min_app_version: { ios: '1.4.0' },
    });
  });

  it('answers 426 app_update_required below the platform minimum, and passes without headers', async () => {
    const driver = await plantDriver(owner);
    const { session } = await signedIn(driver.phone);
    const me = (version?: string, platform?: string) => {
      const call = http().get('/v1/driver/me').set('Authorization', bearer(session));
      if (version !== undefined) call.set('X-App-Version', version);
      if (platform !== undefined) call.set('X-App-Platform', platform);
      return call;
    };
    const old = await me('1.3.9', 'ios').expect(426);
    expect(operationSchemas.driverGetMe.responses['426'].parse(old.body)).toMatchObject({
      code: 'app_update_required',
      details: { min_app_version: '1.4.0' },
    });
    await me('1.4.0', 'ios').expect(200);
    await me('1.10.0', 'ios').expect(200);
    await me('0.0.1', 'android').expect(200);
    await me().expect(200);
    // The anonymous doors too.
    await http()
      .post('/v1/driver/auth/otp/request')
      .set('X-App-Version', '1.0.0')
      .set('X-App-Platform', 'ios')
      .send({ phone: driver.phone })
      .expect(426);
  });

  it('replaces the push token of this device, replays by key, and refuses a revoked device', async () => {
    const driver = await plantDriver(owner);
    const { session } = await signedIn(driver.phone);
    const put = (token: string, key = nextKey()) =>
      http()
        .put('/v1/driver/devices/current/push-token')
        .set('Authorization', bearer(session))
        .set('Idempotency-Key', key)
        .send({ push_token: token });
    const key = nextKey();
    const first = schemas.DriverUpdatePushToken200Response.parse(
      (await put('ExponentPushToken[new]', key).expect(200)).body,
    );
    expect(first).toMatchObject({ id: session.device?.id, push_token: 'ExponentPushToken[new]' });
    const replay = await put('ExponentPushToken[new]', key).expect(200);
    expect(replay.body).toEqual(first);
    await put('').expect(400);
    await owner`UPDATE del_driver_devices SET revoked_at = now(), push_token = NULL
                WHERE id = ${session.device?.id ?? ''}`;
    const refused = await put('ExponentPushToken[late]').expect(401);
    expect(errorOf(refused.body).code).toBe('device_revoked');
  });
});
