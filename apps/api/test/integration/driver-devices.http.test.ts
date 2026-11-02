import { randomBytes, randomInt } from 'node:crypto';
import type { Driver } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas, schemas } from '@eeasy-logistics/contracts/staff/schemas';
import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testSigningKey } from '../support/access-tokens.js';
import { auditRowsOf } from './audit-rows.js';
import { insertAccount } from './identity-fixtures.js';
import type { SignedInMember, StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';

// DEL-4 item C over HTTP (plan 2.5): a dispatcher lists a driver's devices (revoked included,
// newest first, no push token shown), revokes a lost phone (its refresh families end, the push
// token is cleared, a second revoke is 409) and resets a locked cash PIN; audited, account-bound.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `devices:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'devices',
  TRUST_PROXY_HOPS: '1',
});

const devicesOp = operationSchemas.listDriverDevices;
const revokeOp = operationSchemas.revokeDriverDevice;
const errorOf = (body: unknown) => revokeOp.responses['4XX'].parse(body);

let keySequence = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;
const saudiMobile = () => `+96655${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;

describe('driver devices and the cash PIN reset over HTTP (DEL-4 item C)', () => {
  let staff: StaffApp;
  let owner: postgres.Sql;

  beforeAll(async () => {
    owner = connectAs('owner', config);
    staff = await startStaffApp(config, owner);
  });

  afterAll(async () => {
    await staff?.close();
    await owner.end();
  });

  const get = (member: SignedInMember, path: string) =>
    staff.http().get(path).set('Cookie', member.cookie).set('Accept-Language', 'en');
  const post = (member: SignedInMember, path: string, body?: object, key = nextKey()) => {
    const call = staff
      .http()
      .post(path)
      .set(staff.writeHeaders())
      .set('Cookie', member.cookie)
      .set('Idempotency-Key', key);
    return body === undefined ? call : call.send(body);
  };

  /** An account, a branch, a dispatcher and one driver created through the door. */
  async function withDriver() {
    const accountId = await insertAccount(owner);
    const siteId = uuidv7();
    await owner`
      INSERT INTO core_sites (id, account_id, kind, name_ar, name_en)
      VALUES (${siteId}, ${accountId}, 'branch', 'فرع', 'Branch')`;
    const dispatcher = await staff.member(accountId, ['dispatcher']);
    const driver: Driver = schemas.GetDriver200Response.parse(
      (
        await post(dispatcher, '/v1/staff/drivers', {
          name: 'Device Owner',
          phone: saudiMobile(),
          home_site_id: siteId,
        }).expect(201)
      ).body,
    );
    const [row] = await owner<{ user_id: string; membership_id: string }[]>`
      SELECT user_id, membership_id FROM del_drivers WHERE id = ${driver.id}`;
    if (row === undefined) throw new Error('no driver row');
    return { accountId, dispatcher, driver, ...row };
  }

  /** A device row as leg 2's sign-in writes it, `minutesAgo` old. */
  async function plantDevice(
    accountId: string,
    driverId: string,
    options: { minutesAgo: number; revoked?: boolean },
  ): Promise<string> {
    const id = uuidv7();
    await owner`
      INSERT INTO del_driver_devices (id, account_id, driver_id, device_id, platform, app_version,
                                      push_token, revoked_at, created_at)
      VALUES (${id}, ${accountId}, ${driverId}, ${`app-${id.slice(-8)}`}, 'ios', '1.2.0',
              ${`ExponentPushToken[${id.slice(-6)}]`},
              ${options.revoked === true ? new Date().toISOString() : null}::timestamptz,
              now() - make_interval(mins => ${options.minutesAgo}))`;
    return id;
  }

  async function plantSession(userId: string, membershipId: string, deviceId: string) {
    const id = uuidv7();
    await owner`
      INSERT INTO core_refresh_tokens (id, surface, user_id, membership_id, device_id, family_id,
                                       token_hash, token_version, expires_at)
      VALUES (${id}, 'driver', ${userId}, ${membershipId}, ${deviceId}, ${uuidv7()},
              ${randomBytes(32)}, 1, now() + interval '90 days')`;
    return id;
  }
  const revoked = async (sessionId: string) =>
    (
      await owner<{ revoked: boolean }[]>`
        SELECT revoked_at IS NOT NULL AS revoked FROM core_refresh_tokens WHERE id = ${sessionId}`
    )[0]?.revoked;

  it('lists the devices newest first, revoked included, without push tokens, in pages', async () => {
    const { accountId, dispatcher, driver } = await withDriver();
    const oldest = await plantDevice(accountId, driver.id, { minutesAgo: 30, revoked: true });
    const middle = await plantDevice(accountId, driver.id, { minutesAgo: 20 });
    const newest = await plantDevice(accountId, driver.id, { minutesAgo: 10 });
    const first = devicesOp.responses['200'].parse(
      (await get(dispatcher, `/v1/staff/drivers/${driver.id}/devices?limit=2`).expect(200)).body,
    );
    const items = (first.data ?? []).map((item) =>
      schemas.RevokeDriverDevice200Response.parse(item),
    );
    expect(items.map((device) => device.id)).toEqual([newest, middle]);
    expect(items[0]).toMatchObject({ platform: 'ios', app_version: '1.2.0', revoked_at: null });
    expect(JSON.stringify(first)).not.toContain('ExponentPushToken');
    // Nor the app's own install id (adversary M-3).
    for (const item of items) expect(item).not.toHaveProperty('device_id');
    const second = devicesOp.responses['200'].parse(
      (
        await get(
          dispatcher,
          `/v1/staff/drivers/${driver.id}/devices?limit=2&cursor=${first.next_cursor ?? ''}`,
        ).expect(200)
      ).body,
    );
    const rest = (second.data ?? []).map((item) =>
      schemas.RevokeDriverDevice200Response.parse(item),
    );
    expect(rest.map((device) => device.id)).toEqual([oldest]);
    expect(rest[0]?.revoked_at).not.toBeNull();
    expect(second.next_cursor).toBeNull();
    await get(dispatcher, `/v1/staff/drivers/${uuidv7()}/devices`).expect(404);
  });

  it('revokes a device: its sessions end, the other device keeps its own, the token is cleared; again is 409', async () => {
    const { accountId, dispatcher, driver, user_id, membership_id } = await withDriver();
    const lost = await plantDevice(accountId, driver.id, { minutesAgo: 5 });
    const kept = await plantDevice(accountId, driver.id, { minutesAgo: 4 });
    const lostSession = await plantSession(user_id, membership_id, lost);
    const keptSession = await plantSession(user_id, membership_id, kept);
    const path = `/v1/staff/drivers/${driver.id}/devices/${lost}/revoke`;
    const response = await post(dispatcher, path).expect(200);
    const device = revokeOp.responses['200'].parse(response.body);
    expect(device.id).toBe(lost);
    expect(device.revoked_at).not.toBeNull();
    expect(device).not.toHaveProperty('device_id');
    expect(await revoked(lostSession)).toBe(true);
    expect(await revoked(keptSession)).toBe(false);
    const [stored] = await owner<{ push_token: string | null; version: number }[]>`
      SELECT push_token, version FROM del_driver_devices WHERE id = ${lost}`;
    expect(stored).toEqual({ push_token: null, version: 2 });
    const audit = await auditRowsOf(owner, response.headers['x-request-id'] as string);
    expect(audit.map((row) => row.action)).toEqual(['delivery.driver_device.revoked']);
    expect(audit[0]).toMatchObject({ targetType: 'driver_device', targetId: lost });
    expect(audit[0]?.after).toMatchObject({
      revoked: true,
      driver_id: driver.id,
      families_ended: 1,
    });
    expect(JSON.stringify(audit[0])).not.toContain('ExponentPushToken');

    const again = await post(dispatcher, path).expect(409);
    expect(errorOf(again.body)).toMatchObject({
      code: 'invalid_transition',
      details: { current_status: 'revoked' },
    });
    await post(dispatcher, `/v1/staff/drivers/${driver.id}/devices/${uuidv7()}/revoke`).expect(404);
    const theirs = await withDriver();
    await post(dispatcher, `/v1/staff/drivers/${theirs.driver.id}/devices/${kept}/revoke`).expect(
      404,
    );
    expect(await revoked(keptSession)).toBe(false);
  });

  it('resets a locked cash PIN: no hash, no failures, no lock, the token version unchanged, audited without the hash', async () => {
    const { dispatcher, driver, user_id } = await withDriver();
    await owner`
      UPDATE del_drivers SET cash_pin_hash = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA',
                             cash_pin_failures = 5, cash_pin_locked_at = now()
      WHERE id = ${driver.id}`;
    const locked = schemas.GetDriver200Response.parse(
      (await get(dispatcher, `/v1/staff/drivers/${driver.id}`).expect(200)).body,
    );
    expect(locked.cash_pin_locked).toBe(true);
    const [before] = await owner<{ v: number }[]>`
      SELECT token_version AS v FROM core_users WHERE id = ${user_id}`;
    const response = await post(dispatcher, `/v1/staff/drivers/${driver.id}/cash-pin/reset`).expect(
      204,
    );
    const [row] = await owner<
      { cash_pin_hash: string | null; cash_pin_failures: number; locked: boolean }[]
    >`SELECT cash_pin_hash, cash_pin_failures, cash_pin_locked_at IS NOT NULL AS locked
      FROM del_drivers WHERE id = ${driver.id}`;
    expect(row).toEqual({ cash_pin_hash: null, cash_pin_failures: 0, locked: false });
    const [after] = await owner<{ v: number }[]>`
      SELECT token_version AS v FROM core_users WHERE id = ${user_id}`;
    expect(after?.v).toBe(before?.v);
    const audit = await auditRowsOf(owner, response.headers['x-request-id'] as string);
    expect(audit.map((entry) => entry.action)).toEqual(['delivery.driver.cash_pin_reset']);
    expect(audit[0]?.before).toEqual({ was_set: true, locked: true, failures: 5 });
    expect(audit[0]?.after).toEqual({ was_set: false, locked: false, failures: 0 });
    expect(JSON.stringify(audit[0])).not.toContain('argon2id');
    expect(
      schemas.GetDriver200Response.parse(
        (await get(dispatcher, `/v1/staff/drivers/${driver.id}`).expect(200)).body,
      ).cash_pin_locked,
    ).toBe(false);
    await post(dispatcher, `/v1/staff/drivers/${uuidv7()}/cash-pin/reset`).expect(404);
    const viewer = await staff.member((await withDriver()).accountId, ['viewer']);
    await post(viewer, `/v1/staff/drivers/${driver.id}/cash-pin/reset`).expect(403);
  });
});
