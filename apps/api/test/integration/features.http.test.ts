import { randomBytes } from 'node:crypto';
import { operationSchemas } from '@eeasy-logistics/contracts/platform/schemas';
import { schemas as staffSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { Controller, Get } from '@nestjs/common';
import { Redis } from 'ioredis';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Operation } from '../../src/modules/kernel/contract/contract-pipe.js';
import { FeatureCacheBustConsumer } from '../../src/modules/kernel/features/feature-cache.consumer.js';
import { FEATURE_RESOLVER, Feature } from '../../src/modules/kernel/features/feature-gate.js';
import {
  FeatureResolver,
  redisFeatureCache,
} from '../../src/modules/kernel/features/feature-resolver.js';
import type { DomainEvent } from '../../src/modules/kernel/outbox/domain-event.js';
import { featureStoreOnPool } from '../../src/modules/kernel/platform/features.repository.js';
import { PLATFORM_POOL } from '../../src/modules/kernel/platform/tokens.js';
import { testSigningKey } from '../support/access-tokens.js';
import { probeOperations } from '../support/probe-operations.js';
import { auditRowsOf } from './audit-rows.js';
import { freshEmail } from './identity-fixtures.js';
import { latestMail, mailpitMessage, sendMailRow } from './mail-delivery.js';
import type { SignedInPlatformStaff } from './platform-sessions.js';
import { platformStaff, platformWriteHeaders } from './platform-sessions.js';
import type { SignedInMember, StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-13 item C over HTTP on the real tables (plan 2.5, 2.6, 2.12): the feature gate on a
// test-only staff route (permission first, then K-6), every mode against the flag, the flag and
// rollout doors with their audit rows and events, the gate's Redis cache and its consumer, and
// `Me.features`. Real platform and staff sessions. The suite owns the `wms` rollout row while it
// runs (no other suite reads it) and puts it back to `allowlist`. The harness runs `delivery` in
// mode `all` (DEL-1 plan 2.9, global-setup.ts), so `Me.features` always lists it.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `features:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'features',
  TRUST_PROXY_HOPS: '1',
});
const runId = randomBytes(4).toString('hex');
const cachePrefix = `elx-test-${runId}`;
const reason = 'PLAT-13 feature suite';
const errorOf = (body: unknown) =>
  operationSchemas.platformSetRolloutMode.responses['4XX'].parse(body);

let keySequence = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

/** Gated test-only routes: `read` needs `core.sites.read`, `manage` `core.sites.manage`. */
@Controller('v1/staff/feature-probe')
class FeatureProbeController {
  @Get('read')
  @Feature('wms')
  @Operation(probeOperations.staffRead)
  read(): { ok: true } {
    return { ok: true };
  }

  @Get('manage')
  @Feature('wms')
  @Operation(probeOperations.staffWrite)
  manage(): { ok: true } {
    return { ok: true };
  }
}

describe('feature gate, rollout and flags over HTTP (PLAT-13 item C)', () => {
  let staff: StaffApp;
  let owner: postgres.Sql;
  let redis: Redis;
  let superAdmin: SignedInPlatformStaff;
  let admin: SignedInPlatformStaff;
  let support: SignedInPlatformStaff;
  let accountId: string;
  let accountOwner: SignedInMember;
  let viewer: SignedInMember;

  const platformWrite = (path: string, who: SignedInPlatformStaff, key = nextKey()) =>
    staff
      .http()
      .put(path)
      .set(platformWriteHeaders(config))
      .set('Cookie', who.cookie)
      .set('Idempotency-Key', key);
  const setMode = (mode: string, who = superAdmin, key = nextKey()) =>
    platformWrite('/v1/platform/rollout-modes/wms', who, key).send({ mode, reason });
  const setFlag = (enabled: boolean, who = admin, key = nextKey(), feature = 'wms') =>
    platformWrite(`/v1/platform/accounts/${accountId}/feature-flags/${feature}`, who, key).send({
      enabled,
      reason,
    });
  const probe = (member: SignedInMember, route: 'read' | 'manage' = 'read') =>
    staff.http().get(`/v1/staff/feature-probe/${route}`).set('Cookie', member.cookie);
  const codeOf = (body: unknown) => errorOf(body).code;
  const features = async (member: SignedInMember) => {
    const me = await staff.http().get('/v1/staff/me').set('Cookie', member.cookie).expect(200);
    return staffSchemas.GetMe200Response.parse(me.body).features;
  };

  beforeAll(async () => {
    const redisUrl = config.redis.url?.reveal();
    if (redisUrl === undefined) throw new Error('REDIS_URL is required for this suite');
    redis = new Redis(redisUrl);
    owner = connectAs('owner', config);
    staff = await startStaffApp(config, owner, {
      controllers: [FeatureProbeController],
      configure: (builder) =>
        builder.overrideProvider(FEATURE_RESOLVER).useFactory({
          inject: [PLATFORM_POOL],
          factory: (pool: Parameters<typeof featureStoreOnPool>[0]) => {
            const store = featureStoreOnPool(pool);
            if (store === null) throw new Error('the platform pool is required');
            return new FeatureResolver(store, redisFeatureCache(redis), cachePrefix);
          },
        }),
    });
    superAdmin = await platformStaff(staff.app, config, owner, 'super_admin');
    admin = await platformStaff(staff.app, config, owner, 'admin');
    support = await platformStaff(staff.app, config, owner, 'support');
    const provisioned = await staff
      .http()
      .post('/v1/platform/accounts')
      .set(platformWriteHeaders(config))
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', nextKey())
      .send({
        name: `Features ${runId}`,
        default_locale: 'en',
        limits: { orders_per_month: 10, drivers: 1, sites: 1, api_keys: 0 },
        modules: [],
        owner: { email: freshEmail('owner'), name: 'Owner' },
      })
      .expect(201);
    accountId = String((provisioned.body as { id: string }).id);
    accountOwner = await staff.member(accountId, ['owner']);
    viewer = await staff.member(accountId, ['viewer']);
  });

  afterAll(async () => {
    if (owner !== undefined) {
      await owner`UPDATE core_rollout_modes SET mode = 'allowlist', updated_by = NULL
        WHERE feature_key = 'wms'`;
    }
    const left = await redis?.keys(`${cachePrefix}:*`);
    if (left !== undefined && left.length > 0) await redis.del(...left);
    redis?.disconnect();
    await staff?.close();
    await owner?.end();
  });

  it('runs the permission guard first, then the gate (allowlist without the flag)', async () => {
    expect(codeOf((await probe(viewer, 'manage').expect(403)).body)).toBe('forbidden');
    expect(codeOf((await probe(accountOwner, 'manage').expect(403)).body)).toBe(
      'feature_not_enabled',
    );
    expect(codeOf((await probe(accountOwner).expect(403)).body)).toBe('feature_not_enabled');
    expect(await features(accountOwner)).toEqual(['delivery']);
  });

  it('enables the flag under audit; the gate and Me.features follow at once', async () => {
    const response = await setFlag(true).expect(200);
    expect(
      operationSchemas.platformSetFeatureFlag.responses['200'].parse(response.body),
    ).toMatchObject({ feature_key: 'wms', enabled: true, provisioned_by: admin.userId });
    const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
    expect(audit.map((row) => row.action).sort()).toEqual([
      'core.feature_flag.changed',
      'platform.cross_tenant.accessed',
    ]);
    expect(audit.find((row) => row.action === 'core.feature_flag.changed')).toMatchObject({
      actorType: 'platform_user',
      actorId: admin.userId,
      accountId,
      targetType: 'feature_flag',
      targetId: 'wms',
      before: { enabled: false },
      after: { enabled: true },
      reason,
    });
    const events = await owner<{ account_id: string; payload: unknown }[]>`
      SELECT account_id, payload FROM core_outbox
      WHERE type = 'core.feature_flag.changed' AND account_id = ${accountId}`;
    expect(events).toEqual([
      {
        account_id: accountId,
        payload: { account_id: accountId, feature_key: 'wms', enabled: true },
      },
    ]);
    await probe(accountOwner).expect(200);
    expect(await features(accountOwner)).toEqual(['delivery', 'wms']);

    const listed = await staff
      .http()
      .get(`/v1/platform/accounts/${accountId}/feature-flags`)
      .set('Cookie', support.cookie)
      .set('X-Support-Reason', reason)
      .expect(200);
    expect(
      operationSchemas.platformListFeatureFlags.responses['200'].parse(listed.body).data,
    ).toMatchObject([
      { feature_key: 'delivery', enabled: false, provisioned_by: null, enabled_at: null },
      { feature_key: 'wms', enabled: true, provisioned_by: admin.userId },
    ]);
  });

  it('serves the gate from the cache until the consumer busts it', async () => {
    await probe(accountOwner).expect(200);
    await owner`UPDATE core_feature_flags SET enabled = false, provisioned_by = NULL
      WHERE account_id = ${accountId} AND feature_key = 'wms'`;
    await probe(accountOwner).expect(200);
    expect(await redis.get(`${cachePrefix}:feature:${accountId}:wms`)).toBe('1');
    const consumer = new FeatureCacheBustConsumer(redisFeatureCache(redis), cachePrefix);
    await consumer.handle({
      id: 'e1',
      payload: { account_id: accountId, feature_key: 'wms', enabled: false },
    } as unknown as DomainEvent);
    expect(codeOf((await probe(accountOwner).expect(403)).body)).toBe('feature_not_enabled');
    await setFlag(true).expect(200);
    await probe(accountOwner).expect(200);
  });

  it('lets only a super admin set a rollout mode', async () => {
    expect(codeOf((await setMode('all', admin).expect(403)).body)).toBe('rollout_change_forbidden');
    expect(codeOf((await setMode('all', support).expect(403)).body)).toBe('forbidden');
    const bad = await platformWrite('/v1/platform/rollout-modes/wms', superAdmin)
      .send({ mode: 'all', reason: 'no' })
      .expect(400);
    expect(JSON.stringify(errorOf(bad.body).details?.fields)).toContain('/body/reason');
    expect(
      codeOf(
        (
          await platformWrite('/v1/platform/rollout-modes/nope', superAdmin)
            .send({ mode: 'all', reason })
            .expect(404)
        ).body,
      ),
    ).toBe('not_found');
  });

  it('off hides a flagged feature; all shows it without a flag; audited, platform-only events', async () => {
    const off = await setMode('off').expect(200);
    expect(operationSchemas.platformSetRolloutMode.responses['200'].parse(off.body)).toMatchObject({
      feature_key: 'wms',
      mode: 'off',
      updated_by: superAdmin.userId,
    });
    const audit = await auditRowsOf(owner, String(off.headers['x-request-id']));
    expect(audit).toMatchObject([
      {
        action: 'core.rollout_mode.changed',
        actorType: 'platform_user',
        actorId: superAdmin.userId,
        accountId: null,
        targetType: 'rollout_mode',
        targetId: 'wms',
        before: { mode: 'allowlist' },
        after: { mode: 'off' },
        reason,
      },
    ]);
    const [event] = await owner<{ account_id: string | null; payload: unknown }[]>`
      SELECT account_id, payload FROM core_outbox
      WHERE type = 'core.feature_flag.changed' AND payload->>'mode' = 'off'
        AND correlation_id = ${String(off.headers['x-request-id'])}`;
    expect(event).toEqual({ account_id: null, payload: { feature_key: 'wms', mode: 'off' } });
    expect(codeOf((await probe(accountOwner).expect(403)).body)).toBe('feature_not_enabled');
    expect(await features(accountOwner)).toEqual(['delivery']);

    await setMode('all').expect(200);
    await setFlag(false).expect(200);
    await probe(accountOwner).expect(200);
    await probe(viewer).expect(200);
    expect(await features(accountOwner)).toEqual(['delivery', 'wms']);
    expect(codeOf((await probe(viewer, 'manage').expect(403)).body)).toBe('forbidden');

    const listed = await staff
      .http()
      .get('/v1/platform/rollout-modes')
      .set('Cookie', support.cookie)
      .expect(200);
    expect(
      operationSchemas.platformListRolloutModes.responses['200'].parse(listed.body).data,
    ).toMatchObject([
      { feature_key: 'delivery', mode: 'all' },
      { feature_key: 'wms', mode: 'all', updated_by: superAdmin.userId },
    ]);

    await setMode('allowlist').expect(200);
    expect(codeOf((await probe(accountOwner).expect(403)).body)).toBe('feature_not_enabled');
  });

  it('answers replays with the first response; refuses unknown keys and a missing reason', async () => {
    const key = nextKey();
    const first = await setFlag(true, admin, key).expect(200);
    const again = await setFlag(true, admin, key).expect(200);
    expect(again.body).toEqual(first.body);
    const rows = await owner`
      SELECT 1 FROM core_audit_log
      WHERE action = 'core.feature_flag.changed' AND account_id = ${accountId}
        AND request_id = ${String(again.headers['x-request-id'])}`;
    expect(rows).toHaveLength(0);
    const unknown = await setFlag(true, admin, nextKey(), 'channels').expect(404);
    expect(codeOf(unknown.body)).toBe('not_found');
    const noReason = await platformWrite(
      `/v1/platform/accounts/${accountId}/feature-flags/wms`,
      admin,
    )
      .send({ enabled: false, reason: ' ' })
      .expect(400);
    expect(codeOf(noReason.body)).toBe('reason_required');
  });

  it('lists a provisioned module in Me.features once the owner accepts', async () => {
    const email = freshEmail('owner');
    const name = `Delivery ${runId}`;
    await staff
      .http()
      .post('/v1/platform/accounts')
      .set(platformWriteHeaders(config))
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', nextKey())
      .send({
        name,
        default_locale: 'en',
        limits: { orders_per_month: 10, drivers: 1, sites: 1, api_keys: 0 },
        modules: ['delivery'],
        owner: { email, name: 'Owner' },
      })
      .expect(201);
    const mail = await latestMail(owner, email, 'invitation');
    await sendMailRow(config, mail?.id ?? '');
    const delivered = await mailpitMessage(`${mail?.id ?? ''}@eeasy-logistics`);
    const token = /\/invitations\/([\w-]{43})/.exec(delivered.Text)?.[1];
    const accepted = await staff
      .http()
      .post('/v1/staff/auth/invitations/accept')
      .set(staff.writeHeaders())
      .send({ token, name: 'Owner', password: `fresh horse ${randomBytes(6).toString('hex')}` })
      .expect(200);
    expect(staffSchemas.GetMe200Response.parse(accepted.body).features).toEqual(['delivery']);
  });
});
