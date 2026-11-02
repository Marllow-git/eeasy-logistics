import { randomBytes } from 'node:crypto';
import type { Order } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { testSigningKey } from '../support/access-tokens.js';
import { insertAccount } from './identity-fixtures.js';
import type { SignedInMember, StaffApp } from './staff-sessions.js';
import { integrationConfig } from './support.js';
import { plantSite } from './zone-fixtures.js';

// DEL-2 leg 2: the account, branch, zone and members the order door tests share (the create tests
// of `orders.http.test.ts` keep their own copy).

export function ordersConfig(name: string) {
  const signing = testSigningKey();
  return integrationConfig({
    AUTH_SIGNING_KEY_ID: signing.keyId,
    AUTH_SIGNING_KEY: signing.key,
    CREDENTIALS_KEYS: `${name}:${randomBytes(32).toString('base64')}`,
    CREDENTIALS_ACTIVE_KEY_ID: name,
    TRUST_PROXY_HOPS: '1',
    GEOCODER_SOURCES: 'stub',
  });
}

/** Al Olaya in the geocoder fixture (short code REMA7572), inside the test zone. */
export const olaya = { lat: 24.695, lng: 46.685 };
/** Al Rawdah, Jeddah: outside every zone of these tests. */
export const jeddah = { lat: 21.5, lng: 39.2 };

let keySequence = 0;
/** A fresh `Idempotency-Key` (UUID v4 shape, unique per process). */
export const nextKey = (): string =>
  `00000000-0000-4000-9000-${String(++keySequence).padStart(12, '0')}`;

export interface OrderWorld {
  readonly accountId: string;
  readonly siteId: string;
  readonly zoneId: string;
  readonly dispatcher: SignedInMember;
}

/**
 * An account with a branch covering Al Olaya (a 4 km square), the intake rule given, the reason
 * codes `customer_request` and `no_answer`, and a dispatcher.
 */
export async function orderWorld(
  owner: postgres.Sql,
  staff: StaffApp,
  options: { rule?: 'auto_accept' | 'receive_as_pending' } = {},
): Promise<OrderWorld> {
  const accountId = await insertAccount(owner);
  const settings = {
    intake_rule: options.rule ?? 'receive_as_pending',
    max_attempts: 3,
    reason_codes: [
      { code: 'customer_request', label_ar: 'طلب العميل', label_en: 'Customer request' },
      { code: 'no_answer', label_ar: 'لا يرد', label_en: 'No answer' },
      { code: 'retired', label_ar: 'قديم', label_en: 'Retired', active: false },
    ],
  };
  await owner`UPDATE core_accounts SET settings = ${owner.json(settings)} WHERE id = ${accountId}`;
  const siteId = await plantSite(owner, accountId, 'branch');
  const zoneId = uuidv7();
  await owner`
    INSERT INTO del_zones (id, account_id, name_ar, name_en, boundary, source)
    VALUES (${zoneId}, ${accountId}, 'العليا', 'Olaya',
            ST_GeomFromText('MULTIPOLYGON(((46.66 24.68, 46.7 24.68, 46.7 24.72, 46.66 24.72, 46.66 24.68)))', 4326),
            'drawn')`;
  await owner`
    INSERT INTO del_coverage (id, account_id, site_id, zone_id)
    VALUES (${uuidv7()}, ${accountId}, ${siteId}, ${zoneId})`;
  const dispatcher = await staff.member(accountId, ['dispatcher']);
  return { accountId, siteId, zoneId, dispatcher };
}

export const orderBody = (siteId: string, overrides: Record<string, unknown> = {}) => ({
  kind: 'delivery',
  site_id: siteId,
  recipient: { name: 'سارة القحطاني', phone: '+966500000123', preferred_language: 'ar' },
  address: { text: 'شارع العليا', city: 'الرياض', point: olaya },
  items: [{ name_ar: 'قميص', name_en: 'Shirt', quantity: 2, sku: 'SH-1' }],
  ...overrides,
});

/** Creates an order through `createOrder` and parses the answer. */
export async function createOrder(
  staff: StaffApp,
  member: SignedInMember,
  body: object,
): Promise<Order> {
  const response = await staff
    .http()
    .post('/v1/staff/orders')
    .set(staff.writeHeaders())
    .set('Cookie', member.cookie)
    .set('Idempotency-Key', nextKey())
    .send(body)
    .expect(201);
  return operationSchemas.createOrder.responses['201'].parse(response.body);
}

/** Moves an order's status behind the doors' back (a driver's arrow DEL-7 will own). */
export async function forceStatus(
  owner: postgres.Sql,
  orderId: string,
  status: string,
): Promise<void> {
  await owner`UPDATE del_orders SET status = ${status}, version = version + 1 WHERE id = ${orderId}`;
}
