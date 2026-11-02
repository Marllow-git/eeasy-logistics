// Drivers for the DEL-4 leg 2 suites: a driver planted as the owner (account, branch, person with a
// phone, `driver` membership, `del_drivers` row) and its sign-in through the real OTP doors, the code
// read back by decrypting the pending `message` row with the suite's credentials key.
import { randomInt } from 'node:crypto';
import type { Config } from '@eeasy-logistics/config';
import { createCredentialsCipher } from '@eeasy-logistics/config';
import type { DriverSession } from '@eeasy-logistics/contracts/driver/schemas';
import { schemas } from '@eeasy-logistics/contracts/driver/schemas';
import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import type request from 'supertest';
import { insertAccount } from './identity-fixtures.js';

export const saudiMobile = () => `+96655${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
/** A fresh documentation address (TEST-NET-3), so no address budget is shared between tests. */
export const driverAddress = () => `203.0.113.${randomInt(1, 255)}`;

export interface PlantedDriver {
  readonly accountId: string;
  readonly siteId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly driverId: string;
  readonly phone: string;
}

/** A driver of a new account (or of `accountId`), `active` unless told otherwise. */
export async function plantDriver(
  owner: postgres.Sql,
  options: {
    readonly accountId?: string;
    readonly accountStatus?: string;
    readonly driverStatus?: 'active' | 'suspended' | 'archived';
    readonly membershipStatus?: 'active' | 'revoked';
    readonly disabled?: boolean;
    readonly phone?: string;
    readonly userId?: string;
  } = {},
): Promise<PlantedDriver> {
  const accountId =
    options.accountId ??
    (await insertAccount(owner, { status: options.accountStatus ?? 'active' }));
  const siteId = uuidv7();
  await owner`
    INSERT INTO core_sites (id, account_id, kind, name_ar, name_en)
    VALUES (${siteId}, ${accountId}, 'branch', 'فرع', 'Branch')`;
  const phone = options.phone ?? saudiMobile();
  let userId = options.userId;
  if (userId === undefined) {
    userId = uuidv7();
    await owner`
      INSERT INTO core_users (id, name, phone, locale, disabled_at)
      VALUES (${userId}, 'Planted Driver', ${phone}, 'en',
              ${options.disabled === true ? new Date().toISOString() : null}::timestamptz)`;
  }
  const membershipId = uuidv7();
  await owner`
    INSERT INTO core_memberships (id, account_id, user_id, roles, site_ids, status)
    VALUES (${membershipId}, ${accountId}, ${userId}, ${['driver']}, ${[siteId]},
            ${options.membershipStatus ?? 'active'})`;
  const driverId = uuidv7();
  await owner`
    INSERT INTO del_drivers (id, account_id, user_id, membership_id, home_site_id, status)
    VALUES (${driverId}, ${accountId}, ${userId}, ${membershipId}, ${siteId},
            ${options.driverStatus ?? 'active'})`;
  return { accountId, siteId, userId, membershipId, driverId, phone };
}

/** The code of the newest pending OTP message to `phone` (the test holds the credentials key). */
export async function codeOf(owner: postgres.Sql, config: Config, phone: string): Promise<string> {
  const [row] = await owner<
    { payload: { challenge_id: string; params: { code: { encrypted: string } } } }[]
  >`
    SELECT payload FROM core_outbox
    WHERE kind = 'message' AND payload->>'to' = ${phone} AND payload->>'template_key' = 'auth_otp'
      AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1`;
  if (row === undefined) throw new Error('no pending OTP row');
  if (config.credentials === null) throw new Error('no credentials');
  return createCredentialsCipher(config.credentials).decrypt(
    Buffer.from(row.payload.params.code.encrypted, 'base64'),
    `core_otp_challenges:${row.payload.challenge_id}`,
  );
}

export interface DeviceBody {
  readonly device_id: string;
  readonly platform: 'ios' | 'android';
  readonly app_version: string;
  readonly push_token?: string;
}

export const newDevice = (overrides: Partial<DeviceBody> = {}): DeviceBody => ({
  device_id: `app-${uuidv7()}`,
  platform: 'android',
  app_version: '1.0.0',
  ...overrides,
});

/**
 * Asks for a code from a fresh address (`202` expected), after moving the phone's earlier challenges
 * out of the 60 s resend cooldown (a second device signs in at once in these suites).
 */
export async function requestCode(
  http: () => ReturnType<typeof request>,
  owner: postgres.Sql,
  phone: string,
): Promise<void> {
  await owner`
    UPDATE core_otp_challenges SET created_at = created_at - interval '61 seconds'
    WHERE phone = ${phone}`;
  await http()
    .post('/v1/driver/auth/otp/request')
    .set('X-Forwarded-For', driverAddress())
    .send({ phone, locale: 'en' })
    .expect(202);
}

/** Requests a code and verifies it on `device`; the raw response (any status). */
export async function verifyOn(
  http: () => ReturnType<typeof request>,
  owner: postgres.Sql,
  config: Config,
  phone: string,
  device: DeviceBody,
  accountId?: string,
): Promise<request.Response> {
  await requestCode(http, owner, phone);
  const code = await codeOf(owner, config, phone);
  return http()
    .post('/v1/driver/auth/otp/verify')
    .set('X-Forwarded-For', driverAddress())
    .set('Accept-Language', 'en')
    .send({ phone, code, device, ...(accountId === undefined ? {} : { account_id: accountId }) });
}

/** A signed-in driver session on `device` (`200` expected). */
export async function signIn(
  http: () => ReturnType<typeof request>,
  owner: postgres.Sql,
  config: Config,
  phone: string,
  device: DeviceBody = newDevice(),
  accountId?: string,
): Promise<DriverSession> {
  const response = await verifyOn(http, owner, config, phone, device, accountId);
  if (response.status !== 200) {
    throw new Error(`verify answered ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return schemas.DriverVerifyOtp200Response.parse(response.body);
}
