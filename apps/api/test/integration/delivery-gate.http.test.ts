import { randomBytes } from 'node:crypto';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_RESOLVER } from '../../src/modules/kernel/features/feature-gate.js';
import { FeatureResolver } from '../../src/modules/kernel/features/feature-resolver.js';
import { featureStoreOnPool } from '../../src/modules/kernel/platform/features.repository.js';
import { PLATFORM_POOL } from '../../src/modules/kernel/platform/tokens.js';
import { testSigningKey } from '../support/access-tokens.js';
import { insertAccount } from './identity-fixtures.js';
import type { SignedInPlatformStaff } from './platform-sessions.js';
import { platformStaff, platformWriteHeaders } from './platform-sessions.js';
import type { StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';
import { plantSite } from './zone-fixtures.js';

// DEL-1 item D (plan 2.9; ADR-0006; K-6): the Delivery staff doors are gated by the `delivery`
// module. The harness runs with the mode `all` (global-setup.ts), so this suite's app reads the
// rollout mode as `allowlist` (its resolver's store answers so, without a cache) and the account's
// flag from the table: without the flag every staff Delivery door answers `403
// feature_not_enabled`; after `platformSetFeatureFlag` they answer; the driver surface and the
// platform provisioning doors are not gated.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `gate:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'gate',
  TRUST_PROXY_HOPS: '1',
});

const errorOf = (body: unknown) => operationSchemas.listZones.responses['4XX'].parse(body);
let keySequence = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

describe('the delivery feature gate (DEL-1 item D)', () => {
  let staff: StaffApp;
  let owner: postgres.Sql;
  let admin: SignedInPlatformStaff;

  beforeAll(async () => {
    owner = connectAs('owner', config);
    staff = await startStaffApp(config, owner, {
      configure: (builder) =>
        builder.overrideProvider(FEATURE_RESOLVER).useFactory({
          inject: [PLATFORM_POOL],
          factory: (pool: Parameters<typeof featureStoreOnPool>[0]) => {
            const store = featureStoreOnPool(pool);
            if (store === null) throw new Error('the platform pool is required');
            return new FeatureResolver(
              {
                mode: async (key) => (key === 'delivery' ? 'allowlist' : await store.mode(key)),
                flag: (accountId, key) => store.flag(accountId, key),
              },
              null,
            );
          },
        }),
    });
    admin = await platformStaff(staff.app, config, owner, 'admin');
  });

  afterAll(async () => {
    await staff?.close();
    await owner?.end();
  });

  it('refuses the staff Delivery doors without the flag and opens them with it', async () => {
    const accountId = await insertAccount(owner);
    const member = await staff.member(accountId, ['admin']);
    const site = await plantSite(owner, accountId);
    // Each door is built when it is sent (supertest binds a request to the server on creation).
    const doors = [
      () => staff.http().get('/v1/staff/zones'),
      () => staff.http().get('/v1/staff/coverage'),
      () => staff.http().get('/v1/staff/drivers'),
      () => staff.http().get('/v1/staff/vehicles'),
      () =>
        staff
          .http()
          .post('/v1/staff/coverage/check')
          .set(staff.writeHeaders())
          .send({ point: { lat: 24.7, lng: 46.7 } }),
      () =>
        staff
          .http()
          .put(`/v1/staff/sites/${site}/coverage`)
          .set(staff.writeHeaders())
          .set('Idempotency-Key', nextKey())
          .send({ zone_ids: [] }),
    ];
    for (const door of doors) {
      const response = await door().set('Cookie', member.cookie).expect(403);
      expect(errorOf(response.body).code).toBe('feature_not_enabled');
    }
    // The provisioning door is platform work through the cross-tenant door: not gated.
    await staff
      .http()
      .put(`/v1/platform/accounts/${accountId}/coverage`)
      .set(platformWriteHeaders(config))
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', nextKey())
      .send({ entries: [{ site_id: site, zone_ids: [] }] })
      .expect(200);

    await staff
      .http()
      .put(`/v1/platform/accounts/${accountId}/feature-flags/delivery`)
      .set(platformWriteHeaders(config))
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', nextKey())
      .send({ enabled: true, reason: 'DEL-1 gate suite' })
      .expect(200);
    const statuses: number[] = [];
    for (const door of doors) statuses.push((await door().set('Cookie', member.cookie)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
  });
});
