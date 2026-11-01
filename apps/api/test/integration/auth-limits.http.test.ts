import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Pool } from '@eeasy-logistics/db';
import { uuidv7 } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import type postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureHttp, createHttpAdapter, httpAppOptions } from '../../src/http-app.js';
import { AuditWriter } from '../../src/modules/kernel/audit/audit-writer.js';
import { PasswordHasher } from '../../src/modules/kernel/auth/passwords.js';
import {
  RATE_LIMITER,
  RateLimiter,
  redisRateLimitStore,
} from '../../src/modules/kernel/rate-limit/rate-limiter.js';
import { getMetrics } from '../../src/modules/kernel/telemetry/metrics.js';
import { authPurgeAuditAction, purgeAuthRows } from '../../src/worker/system/auth-purge.js';
import { testSigningKey } from '../support/access-tokens.js';
import { webClientHeaders } from '../support/web-client.js';
import { auditRowsOf } from './audit-rows.js';
import {
  cookieHeader,
  freshEmail,
  insertAccount,
  insertMembership,
  insertPlatformStaff,
  insertUser,
  setCookies,
} from './identity-fixtures.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-11 item H (plan 2.11, 2.13, 2.15): the platform door and enrolment-link budgets answer 429
// with `Retry-After`; the sign-in counters are recorded with closed labels; the hourly purge
// deletes identity rows 7 days after their last event and clears kept successors after an hour.

const runId = randomBytes(4).toString('hex');
const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `auth-limits:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'auth-limits',
  TRUST_PROXY_HOPS: '1',
});
const password = `limit horse ${randomBytes(6).toString('hex')}`;
const address = () =>
  `2001:db8:${randomInt(1, 0xffff).toString(16)}::${randomInt(1, 0xffff).toString(16)}`;

describe('auth budgets, metrics and purge (PLAT-11 item H)', () => {
  let app: NestExpressApplication;
  let owner: postgres.Sql;
  let redis: Redis;
  let pool: Pool<PlatformDatabase>;
  let passwordHash: string;
  const http = () => request(app.getHttpServer());
  const write = (surface: 'staff' | 'platform', path: string, ip: string) =>
    http()
      .post(`/v1/${surface}/${path}`)
      .set(webClientHeaders(config, surface))
      .set('X-Forwarded-For', ip)
      .set('Accept-Language', 'en');

  beforeAll(async () => {
    const redisUrl = config.redis.url?.reveal();
    if (redisUrl === undefined) throw new Error('REDIS_URL is required for this suite');
    redis = new Redis(redisUrl);
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'auth-limits-test');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
      .overrideProvider(RATE_LIMITER)
      .useValue(new RateLimiter(redisRateLimitStore(redisUrl), { prefix: `elx-test-${runId}:rl` }))
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(createHttpAdapter(config), {
      ...httpAppOptions,
      logger: false,
    });
    configureHttp(app);
    await app.init();
    passwordHash = await app.get(PasswordHasher, { strict: false }).hash(password);
  });

  afterAll(async () => {
    await app?.close();
    const left = await redis.keys(`elx-test-${runId}:*`);
    if (left.length > 0) await redis.del(...left);
    redis.disconnect();
    await Promise.all([owner.end(), pool.close()]);
  });

  it('limits platformLogin to 10 an hour per email, apart from the staff door', async () => {
    const staff = await insertUser(owner, { passwordHash });
    await insertPlatformStaff(owner, staff.id, 'support');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await write('platform', 'auth/login', address())
        .send({ email: staff.email.toUpperCase(), password: `${password}-wrong` })
        .expect(401);
    }
    const refused = await write('platform', 'auth/login', address())
      .send({ email: staff.email, password })
      .expect(429);
    expect((refused.body as { code: string }).code).toBe('rate_limited');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    // The staff door counts its own budget for the same address.
    await write('staff', 'auth/login', address())
      .send({ email: staff.email, password })
      .expect(401);
  });

  it('limits platformLogin to 50 an hour per address', async () => {
    const ip = address();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await write('platform', 'auth/login', ip)
        .send({ email: freshEmail('spray'), password })
        .expect(401);
    }
    await write('platform', 'auth/login', ip)
      .send({ email: freshEmail('spray'), password })
      .expect(429);
    await write('platform', 'auth/login', address())
      .send({ email: freshEmail('spray'), password })
      .expect(401);
  });

  it('limits redeemEnrolmentLink and platformAcceptInvitation to 20 an hour per address', async () => {
    const ip = address();
    const token = `${uuidv7()}.${randomBytes(32).toString('base64url')}`;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await write('staff', 'auth/second-factor/enrolment-link', ip)
        .send({ link_token: token, password })
        .expect(401);
      await write('platform', 'auth/invitations/accept', ip)
        .send({ token: randomBytes(32).toString('base64url'), name: 'X', password })
        .expect(401);
    }
    const refused = await write('staff', 'auth/second-factor/enrolment-link', ip)
      .send({ link_token: token, password })
      .expect(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('counts logins, refreshes and family revocations with closed labels', async () => {
    const add = vi.spyOn(getMetrics(), 'add');
    try {
      const user = await insertUser(owner, { passwordHash });
      await insertMembership(owner, await insertAccount(owner), user.id);
      const ip = address();
      const signedIn = await write('staff', 'auth/login', ip)
        .send({ email: user.email, password })
        .expect(200);
      await write('staff', 'auth/login', ip)
        .send({ email: user.email, password: `${password}?` })
        .expect(401);
      const first = setCookies(signedIn.headers).get('el_staff_rt')?.value;
      const rotated = await write('staff', 'auth/refresh', ip)
        .set('User-Agent', 'metrics-agent')
        .set('Cookie', cookieHeader({ el_staff_rt: first }))
        .expect(204);
      void rotated;
      // A reuse from another agent revokes the family.
      await write('staff', 'auth/refresh', ip)
        .set('User-Agent', 'another-agent')
        .set('Cookie', cookieHeader({ el_staff_rt: first }))
        .expect(401);
      const enrolled = await insertUser(owner, {
        passwordHash,
        secondFactorPhone: `+96658${String(randomInt(0, 10_000_000)).padStart(7, '0')}`,
      });
      await insertMembership(owner, await insertAccount(owner), enrolled.id);
      await write('staff', 'auth/login', ip).send({ email: enrolled.email, password }).expect(200);

      const calls = add.mock.calls.filter(([name]) => String(name).startsWith('auth_'));
      expect(calls).toEqual(
        expect.arrayContaining([
          ['auth_logins_total', 1, { surface: 'staff', outcome: 'ok' }],
          ['auth_logins_total', 1, { surface: 'staff', outcome: 'invalid_credentials' }],
          ['auth_logins_total', 1, { surface: 'staff', outcome: 'second_factor' }],
          ['auth_refresh_total', 1, { surface: 'staff', outcome: 'ok' }],
          ['auth_refresh_total', 1, { surface: 'staff', outcome: 'reuse_revoked' }],
          ['auth_family_revocations_total', 1, { reason: 'reuse' }],
        ]),
      );
      expect(JSON.stringify(calls)).not.toContain(user.email);
      expect(JSON.stringify(calls)).not.toContain(user.id);
    } finally {
      add.mockRestore();
    }
  });

  it('purges identity rows 7 days after their last event and clears kept successors after an hour', async () => {
    const user = await insertUser(owner, { passwordHash });
    const accountId = await insertAccount(owner);
    const membershipId = await insertMembership(owner, accountId, user.id);
    const ids = { old: uuidv7(), fresh: uuidv7(), used: uuidv7(), longLived: uuidv7() };
    const hash = () => randomBytes(32);
    const refresh = (id: string, expires: string, used: string | null, successor: Buffer | null) =>
      owner`
        INSERT INTO core_refresh_tokens (id, surface, user_id, membership_id, family_id, token_hash,
                                         token_version, expires_at, used_at, successor_ciphertext)
        VALUES (${id}, 'staff', ${user.id}, ${membershipId}, ${uuidv7()}, ${hash()}, 1,
                now() + ${expires}::interval,
                ${used === null ? null : owner`now() + ${used}::interval`}, ${successor})`;
    await owner`
      INSERT INTO core_refresh_tokens (id, surface, user_id, membership_id, family_id, token_hash,
                                       token_version, expires_at, revoked_at, revoked_reason)
      VALUES (${ids.old}, 'staff', ${user.id}, ${membershipId}, ${uuidv7()}, ${hash()}, 1,
              now() - interval '20 days', now() - interval '8 days', 'logout')`;
    await refresh(ids.fresh, '-6 days', null, null);
    await refresh(ids.used, '+20 days', '-2 hours', Buffer.from('kept successor'));
    await refresh(ids.longLived, '+20 days', '-10 minutes', Buffer.from('still kept'));
    const resetOld = uuidv7();
    const resetFresh = uuidv7();
    await owner`
      INSERT INTO core_password_resets (id, user_id, token_hash, expires_at, used_at) VALUES
        (${resetOld}, ${user.id}, ${hash()}, now() - interval '9 days', now() - interval '8 days'),
        (${resetFresh}, ${user.id}, ${hash()}, now() - interval '9 days', now() - interval '1 day')`;
    const challengeOld = uuidv7();
    const challengeFresh = uuidv7();
    await owner`
      INSERT INTO core_auth_challenges (id, kind, user_id, secret_hash, expires_at) VALUES
        (${challengeOld}, 'selection', ${user.id}, ${hash()}, now() - interval '8 days'),
        (${challengeFresh}, 'selection', ${user.id}, ${hash()}, now() - interval '1 hour')`;
    const invitationOld = uuidv7();
    const invitationFresh = uuidv7();
    await owner`
      INSERT INTO core_invitations (id, kind, account_id, membership_id, email, name, locale,
                                    token_hash, expires_at, accepted_at) VALUES
        (${invitationOld}, 'staff', ${accountId}, ${membershipId}, ${user.email}, 'Old', 'en',
         ${hash()}, now() - interval '10 days', now() - interval '8 days'),
        (${invitationFresh}, 'staff', ${accountId}, ${membershipId}, ${user.email}, 'New', 'en',
         ${hash()}, now() - interval '10 days', now() - interval '2 days')`;

    const purgeRun = randomUUID();
    const counts = await purgeAuthRows(pool.db, new AuditWriter(pool), purgeRun);

    const refreshLeft = await owner<{ id: string; successor: Buffer | null }[]>`
      SELECT id, successor_ciphertext AS successor FROM core_refresh_tokens
      WHERE user_id = ${user.id} ORDER BY id`;
    expect(refreshLeft.map((row) => row.id).sort()).toEqual(
      [ids.fresh, ids.used, ids.longLived].sort(),
    );
    expect(refreshLeft.find((row) => row.id === ids.used)?.successor).toBeNull();
    expect(refreshLeft.find((row) => row.id === ids.longLived)?.successor).not.toBeNull();
    expect(
      (await owner`SELECT id FROM core_password_resets WHERE user_id = ${user.id}`).map(
        (row) => row.id as string,
      ),
    ).toEqual([resetFresh]);
    expect(
      (await owner`SELECT id FROM core_auth_challenges WHERE user_id = ${user.id}`).map(
        (row) => row.id as string,
      ),
    ).toEqual([challengeFresh]);
    expect(
      (await owner`SELECT id FROM core_invitations WHERE membership_id = ${membershipId}`).map(
        (row) => row.id as string,
      ),
    ).toEqual([invitationFresh]);
    expect(counts.refreshTokens).toBeGreaterThanOrEqual(1);
    expect(counts.successorsCleared).toBeGreaterThanOrEqual(1);
    const audit = await auditRowsOf(owner, purgeRun);
    expect(audit).toMatchObject([
      {
        actorType: 'system',
        accountId: null,
        action: authPurgeAuditAction,
        targetType: 'auth_purge',
        after: { refresh_rows: counts.refreshTokens, challenges: counts.challenges },
      },
    ]);
  });
});
