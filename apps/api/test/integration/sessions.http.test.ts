import { randomBytes } from 'node:crypto';
import {
  operationSchemas as platformOperations,
  schemas as platformSchemas,
} from '@eeasy-logistics/contracts/platform/schemas';
import {
  operationSchemas,
  schemas as staffSchemas,
} from '@eeasy-logistics/contracts/staff/schemas';
import { Controller, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { Redis } from 'ioredis';
import type postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureHttp, createHttpAdapter, httpAppOptions } from '../../src/http-app.js';
import { sessionCookies } from '../../src/modules/kernel/auth/cookies.js';
import type { RequestFacts } from '../../src/modules/kernel/auth/request-facts.js';
import { AuthRequest } from '../../src/modules/kernel/auth/request-facts.js';
import { SessionService } from '../../src/modules/kernel/auth/sessions.js';
import { ApiException } from '../../src/modules/kernel/errors/api-exception.js';
import type { ContractInput } from '../../src/modules/kernel/public/index.js';
import { Input, Operation, Public } from '../../src/modules/kernel/public/index.js';
import {
  RATE_LIMITER,
  RateLimiter,
  redisRateLimitStore,
} from '../../src/modules/kernel/rate-limit/rate-limiter.js';
import { testSigningKey } from '../support/access-tokens.js';
import { webClientHeaders } from '../support/web-client.js';
import { auditRowsOf } from './audit-rows.js';
import {
  cookieHeader,
  insertAccount,
  insertMembership,
  insertPlatformStaff,
  insertUser,
  setCookies,
} from './identity-fixtures.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-11 item C over HTTP on the real tables (plan 2.4 to 2.6, 2.16): a session's cookies, getMe and
// platformGetMe, refresh rotation, the reuse grace (same token back within 30 s from the same agent),
// family revocation on any other reuse, a token_version bump, expiry, a suspended account, logout,
// and the web client marker on every write. Sessions are started by test-only doors (bound to the
// `login` and `platformLogin` operations) until the sign-in doors exist (item D; platform: leg 2).

const login = operationSchemas.login;
const platformLogin = platformOperations.platformLogin;

/** Starts a session for the user of `email` on their first active membership (staff). */
@Controller('v1/staff/test-session')
class StaffSessionProbe {
  constructor(@Inject(ModuleRef) private readonly modules: ModuleRef) {}

  @Post()
  @Public()
  @HttpCode(200)
  @Operation(login)
  async start(
    @Input() input: ContractInput<typeof login>,
    @AuthRequest() facts: RequestFacts,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, never>> {
    const sessions = this.modules.get(SessionService, { strict: false });
    const session = await sessions.store.run(async (tx) => {
      const user = await tx.users.findByEmail(input.body.email);
      if (user === undefined) throw new ApiException('invalid_credentials');
      const [membership] = await tx.memberships.signInMemberships(user.id);
      if (membership === undefined) throw new ApiException('invalid_credentials');
      return sessions.start(
        tx,
        {
          surface: 'staff',
          userId: user.id,
          tokenVersion: user.tokenVersion,
          membership,
          amr: ['pwd'],
        },
        facts,
      );
    });
    response.append('Set-Cookie', sessionCookies('staff', session));
    return {};
  }
}

@Controller('v1/platform/test-session')
class PlatformSessionProbe {
  constructor(@Inject(ModuleRef) private readonly modules: ModuleRef) {}

  @Post()
  @Public()
  @HttpCode(200)
  @Operation(platformLogin)
  async start(
    @Input() input: ContractInput<typeof platformLogin>,
    @AuthRequest() facts: RequestFacts,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, never>> {
    const sessions = this.modules.get(SessionService, { strict: false });
    const session = await sessions.store.run(async (tx) => {
      const user = await tx.users.findByEmail(input.body.email);
      const staff = user === undefined ? undefined : await tx.platformStaff.find(user.id);
      if (user === undefined || staff === undefined) throw new ApiException('invalid_credentials');
      return sessions.start(
        tx,
        {
          surface: 'platform',
          userId: user.id,
          tokenVersion: user.tokenVersion,
          role: staff.role,
          amr: ['pwd', 'totp'],
        },
        facts,
      );
    });
    response.append('Set-Cookie', sessionCookies('platform', session));
    return {};
  }
}

const runId = randomBytes(4).toString('hex');
const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `sessions:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'sessions',
  AUTH_REFRESH_REUSE_GRACE_SECONDS: '30',
});
const agent = 'Mozilla/5.0 (PLAT-11 sessions test)';

interface Pair {
  readonly access: string;
  readonly refresh: string;
}

describe('sessions over HTTP (PLAT-11 item C)', () => {
  let app: NestExpressApplication;
  let owner: postgres.Sql;
  let redis: Redis;
  const http = () => request(app.getHttpServer());
  const staffWrite = (path: string) =>
    http()
      .post(path)
      .set(webClientHeaders(config, 'staff'))
      .set('User-Agent', agent)
      .set('Accept-Language', 'en');

  /** A user with one active membership of `roles` on a fresh account, signed in. */
  async function signedIn(
    options: { accountStatus?: string; roles?: string[] } = {},
  ): Promise<{ pair: Pair; userId: string; accountId: string; membershipId: string }> {
    const accountId = await insertAccount(owner, { status: options.accountStatus ?? 'active' });
    const user = await insertUser(owner);
    const membershipId = await insertMembership(owner, accountId, user.id, {
      roles: options.roles ?? ['owner'],
    });
    const response = await staffWrite('/v1/staff/test-session')
      .send({ email: user.email, password: 'not checked by the probe' })
      .expect(200);
    return { pair: pairOf(response.headers, 'staff'), userId: user.id, accountId, membershipId };
  }

  function pairOf(headers: Record<string, unknown>, surface: 'staff' | 'platform'): Pair {
    const cookies = setCookies(headers);
    const access = cookies.get(`el_${surface}_at`)?.value;
    const refresh = cookies.get(`el_${surface}_rt`)?.value;
    if (access === undefined || refresh === undefined) throw new Error('no session cookies');
    return { access, refresh };
  }

  const refresh = (token: string, userAgent = agent) =>
    http()
      .post('/v1/staff/auth/refresh')
      .set(webClientHeaders(config, 'staff'))
      .set('User-Agent', userAgent)
      .set('Cookie', cookieHeader({ el_staff_rt: token }));

  beforeAll(async () => {
    const redisUrl = config.redis.url?.reveal();
    if (redisUrl === undefined) throw new Error('REDIS_URL is required for this suite');
    redis = new Redis(redisUrl);
    owner = connectAs('owner', config);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
      controllers: [StaffSessionProbe, PlatformSessionProbe],
    })
      .overrideProvider(RATE_LIMITER)
      .useValue(new RateLimiter(redisRateLimitStore(redisUrl), { prefix: `elx-test-${runId}:rl` }))
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(createHttpAdapter(config), {
      ...httpAppOptions,
      logger: false,
    });
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    const left = await redis.keys(`elx-test-${runId}:*`);
    if (left.length > 0) await redis.del(...left);
    redis.disconnect();
    await owner.end();
  });

  it('starts a session with host-only, HttpOnly, Secure, Lax cookies on Path=/', async () => {
    const accountId = await insertAccount(owner);
    const user = await insertUser(owner);
    await insertMembership(owner, accountId, user.id);
    const response = await staffWrite('/v1/staff/test-session')
      .send({ email: user.email, password: 'x' })
      .expect(200);
    const cookies = setCookies(response.headers);
    expect(cookies.get('el_staff_at')?.raw).toMatch(
      /^el_staff_at=[\w.-]+; Path=\/; Max-Age=900; HttpOnly; Secure; SameSite=Lax$/,
    );
    expect(cookies.get('el_staff_rt')?.raw).toMatch(
      /^el_staff_rt=[\w-]{43}; Path=\/; Max-Age=259\d{4}; HttpOnly; Secure; SameSite=Lax$/,
    );
    const [row] = await owner<{ amr: string[]; surface: string; token_hash: Buffer }[]>`
      SELECT amr, surface, token_hash FROM core_refresh_tokens WHERE user_id = ${user.id}`;
    expect(row).toMatchObject({ amr: ['pwd'], surface: 'staff' });
    const [started] = await owner<{ action: string; after: { amr: string[] } }[]>`
      SELECT action, after FROM core_audit_log WHERE actor_id = ${user.id}
        AND action = 'core.session.started'`;
    expect(started?.after.amr).toEqual(['pwd']);
    const [touched] = await owner<{ last_login_at: Date | null }[]>`
      SELECT last_login_at FROM core_users WHERE id = ${user.id}`;
    expect(touched?.last_login_at).not.toBeNull();
  });

  it('answers getMe with the user, membership, account and the role permissions', async () => {
    const { pair, userId, accountId, membershipId } = await signedIn({ roles: ['dispatcher'] });
    const response = await http()
      .get('/v1/staff/me')
      .set('Cookie', cookieHeader({ el_staff_at: pair.access }))
      .expect(200);
    const me = staffSchemas.GetMe200Response.parse(response.body);
    expect(me.user?.id).toBe(userId);
    expect(me.membership).toMatchObject({
      id: membershipId,
      roles: ['dispatcher'],
      status: 'active',
    });
    expect(me.account).toMatchObject({ id: accountId, status: 'active' });
    expect(me.permissions).toContain('delivery.orders.read');
    expect(me.permissions).not.toContain('core.members.manage');
    // The harness row in global-setup.ts sets the `delivery` rollout mode to `all` (DEL-1 plan 2.9).
    expect(me.features).toEqual(['delivery']);
    expect(JSON.stringify(response.body)).not.toMatch(/password|token_version/);
  });

  it('rotates on refresh: new cookies, the old row used, the new access token works', async () => {
    const { pair, userId } = await signedIn();
    const response = await refresh(pair.refresh).expect(204);
    const next = pairOf(response.headers, 'staff');
    expect(next.refresh).not.toBe(pair.refresh);
    const rows = await owner<{ used: boolean }[]>`
      SELECT used_at IS NOT NULL AS used FROM core_refresh_tokens WHERE user_id = ${userId}
      ORDER BY created_at`;
    expect(rows.map((row) => row.used)).toEqual([true, false]);
    await http()
      .get('/v1/staff/me')
      .set('Cookie', cookieHeader({ el_staff_at: next.access }))
      .expect(200);
  });

  it('answers the same refresh token for a reuse within 30 s from the same agent', async () => {
    const { pair } = await signedIn();
    const first = pairOf((await refresh(pair.refresh).expect(204)).headers, 'staff');
    const again = pairOf((await refresh(pair.refresh).expect(204)).headers, 'staff');
    expect(again.refresh).toBe(first.refresh);
    // The successor is still live: it rotates normally.
    await refresh(first.refresh).expect(204);
  });

  it('revokes the family on a reuse from another agent, and the successor fails too', async () => {
    const { pair, userId } = await signedIn();
    const first = pairOf((await refresh(pair.refresh).expect(204)).headers, 'staff');
    const reused = await refresh(pair.refresh, 'curl/8.0').expect(401);
    expect(reused.body).toMatchObject({ code: 'token_invalid' });
    expect(setCookies(reused.headers).get('el_staff_rt')?.maxAge).toBe(0);
    expect(setCookies(reused.headers).get('el_staff_at')?.maxAge).toBe(0);
    await refresh(first.refresh).expect(401);
    const rows = await owner<{ reason: string | null }[]>`
      SELECT revoked_reason AS reason FROM core_refresh_tokens WHERE user_id = ${userId}`;
    expect(rows.map((row) => row.reason)).toEqual(['reuse', 'reuse']);
  });

  it('revokes the family on a reuse after 30 s, audited as core.session.family_revoked', async () => {
    const { pair, userId, accountId } = await signedIn();
    const first = pairOf((await refresh(pair.refresh).expect(204)).headers, 'staff');
    await owner`
      UPDATE core_refresh_tokens SET used_at = now() - interval '31 seconds'
      WHERE user_id = ${userId} AND used_at IS NOT NULL`;
    const reused = await refresh(pair.refresh).expect(401);
    expect(reused.body).toMatchObject({ code: 'token_invalid' });
    await refresh(first.refresh).expect(401);
    const audit = await auditRowsOf(owner, String(reused.headers['x-request-id']));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'core.session.family_revoked',
      actorType: 'user',
      actorId: userId,
      accountId,
      targetType: 'session_family',
      after: { surface: 'staff', reason: 'reuse' },
      userAgent: agent,
    });
  });

  it('refuses a refresh after the token_version moved (a reset) and clears the cookies', async () => {
    const { pair, userId } = await signedIn();
    await owner`UPDATE core_users SET token_version = token_version + 1 WHERE id = ${userId}`;
    const refused = await refresh(pair.refresh).expect(401);
    expect(refused.body).toMatchObject({ code: 'token_invalid' });
    expect(setCookies(refused.headers).get('el_staff_rt')?.maxAge).toBe(0);
  });

  it('answers token_expired for an expired refresh token', async () => {
    const { pair, userId } = await signedIn();
    await owner`UPDATE core_refresh_tokens SET expires_at = now() - interval '1 second' WHERE user_id = ${userId}`;
    expect((await refresh(pair.refresh).expect(401)).body).toMatchObject({ code: 'token_expired' });
  });

  it('answers 403 account_suspended when the account was suspended', async () => {
    const { pair, accountId } = await signedIn();
    await owner`UPDATE core_accounts SET status = 'suspended' WHERE id = ${accountId}`;
    expect((await refresh(pair.refresh).expect(403)).body).toMatchObject({
      code: 'account_suspended',
    });
  });

  it('answers token_invalid without a refresh cookie, with a malformed or unknown one', async () => {
    await http().post('/v1/staff/auth/refresh').set(webClientHeaders(config, 'staff')).expect(401);
    await refresh('not-a-token').expect(401);
    await refresh(randomBytes(32).toString('base64url')).expect(401);
  });

  it('logs out: both cookies cleared, the family revoked and audited, refresh refused after', async () => {
    const { pair, userId } = await signedIn();
    const response = await staffWrite('/v1/staff/auth/logout')
      .set('Cookie', cookieHeader({ el_staff_at: pair.access, el_staff_rt: pair.refresh }))
      .expect(204);
    const cookies = setCookies(response.headers);
    expect(cookies.get('el_staff_at')?.maxAge).toBe(0);
    expect(cookies.get('el_staff_rt')?.maxAge).toBe(0);
    await refresh(pair.refresh).expect(401);
    const [row] = await owner<{ reason: string }[]>`
      SELECT revoked_reason AS reason FROM core_refresh_tokens WHERE user_id = ${userId}`;
    expect(row?.reason).toBe('logout');
    const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
    expect(audit.map((entry) => entry.action)).toEqual(['core.session.ended']);
  });

  it('logs out every family of the membership without a refresh cookie, and answers 204 anyway', async () => {
    const { pair, userId } = await signedIn();
    await staffWrite('/v1/staff/auth/logout')
      .set('Cookie', cookieHeader({ el_staff_at: pair.access }))
      .expect(204);
    await refresh(pair.refresh).expect(401);
    await staffWrite('/v1/staff/auth/logout')
      .set('Cookie', cookieHeader({ el_staff_at: pair.access }))
      .expect(204);
    const rows =
      await owner`SELECT 1 FROM core_refresh_tokens WHERE user_id = ${userId} AND revoked_at IS NULL`;
    expect(rows).toHaveLength(0);
  });

  it('refuses refresh and logout without X-EL-Client or with a foreign Origin (403)', async () => {
    const { pair } = await signedIn();
    await http()
      .post('/v1/staff/auth/refresh')
      .set('Cookie', cookieHeader({ el_staff_rt: pair.refresh }))
      .expect(403);
    await http()
      .post('/v1/staff/auth/refresh')
      .set({ 'X-EL-Client': 'web', Origin: 'https://evil.example' })
      .set('Cookie', cookieHeader({ el_staff_rt: pair.refresh }))
      .expect(403);
    await http()
      .post('/v1/staff/auth/logout')
      .set('Cookie', cookieHeader({ el_staff_at: pair.access }))
      .expect(403);
    // Nothing was rotated by the refused calls.
    await refresh(pair.refresh).expect(204);
  });

  it('answers platformGetMe for a platform session with the staff role and its permissions', async () => {
    const user = await insertUser(owner);
    await insertPlatformStaff(owner, user.id, 'support');
    const response = await http()
      .post('/v1/platform/test-session')
      .set(webClientHeaders(config, 'platform'))
      .send({ email: user.email, password: 'x' })
      .expect(200);
    const cookies = setCookies(response.headers);
    expect(cookies.get('el_platform_rt')?.maxAge).toBe(43_200);
    const me = await http()
      .get('/v1/platform/me')
      .set('Cookie', cookieHeader({ el_platform_at: cookies.get('el_platform_at')?.value }))
      .expect(200);
    const body = platformSchemas.PlatformGetMe200Response.parse(me.body);
    expect(body.user).toMatchObject({
      id: user.id,
      roles: ['platform_support'],
      totp_enrolled: false,
    });
    expect(body.permissions?.length).toBeGreaterThan(0);
    // A staff cookie is no platform credential.
    await http()
      .get('/v1/platform/me')
      .set('Cookie', cookieHeader({ el_staff_at: cookies.get('el_platform_at')?.value }))
      .expect(401);
  });
});
