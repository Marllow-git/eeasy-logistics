import { randomBytes, randomInt } from 'node:crypto';
import { createCredentialsCipher } from '@eeasy-logistics/config';
import { schemas } from '@eeasy-logistics/contracts/platform/schemas';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { decodeJwt } from 'jose';
import { Redis } from 'ioredis';
import type postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureHttp, createHttpAdapter, httpAppOptions } from '../../src/http-app.js';
import { Invitations } from '../../src/modules/kernel/auth/invitations.js';
import { PasswordHasher } from '../../src/modules/kernel/auth/passwords.js';
import { fromBase32, totpAt, totpStep } from '../../src/modules/kernel/auth/totp.js';
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
  freshEmail,
  insertAccount,
  insertMembership,
  insertPlatformStaff,
  insertUser,
  setCookies,
} from './identity-fixtures.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-11 item G over HTTP on the real tables (plan 2.9, 2.10, 2.16): platform invitation →
// password → TOTP enrol → confirm → session; login → TOTP verify; a code refused for its window
// (replay); five wrong codes end a challenge; one body for unknown, disabled and non-staff users;
// the sliding 12-hour refresh and its idle expiry; logout; the console's web client marker.

const runId = randomBytes(4).toString('hex');
const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `platform-sign-in:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'platform-sign-in',
  TRUST_PROXY_HOPS: '1',
});
const password = `staple battery ${randomBytes(6).toString('hex')}`;
const address = () => `192.0.2.${randomInt(1, 255)}`;

interface ErrorBody {
  code: string;
  message: string;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const otherCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

describe('platform sign-in over HTTP (PLAT-11 item G)', () => {
  let app: NestExpressApplication;
  let owner: postgres.Sql;
  let redis: Redis;
  let hasher: PasswordHasher;
  let passwordHash: string;
  const http = () => request(app.getHttpServer());
  const write = (path: string, ip = address()) =>
    http()
      .post(path)
      .set(webClientHeaders(config, 'platform'))
      .set('X-Forwarded-For', ip)
      .set('Accept-Language', 'en');
  const login = (email: string, secret = password) =>
    write('/v1/platform/auth/login').send({ email, password: secret });
  const codeOf = (error: { body: unknown }) => (error.body as ErrorBody).code;

  /** The console link of the newest invitation mail to `email`, decrypted with the test's key. */
  async function invitationLink(email: string, invitationId: string): Promise<string> {
    const [mail] = await owner<
      { aggregate_id: string; payload: { params: { link: { encrypted: string } } } }[]
    >`
      SELECT aggregate_id, payload FROM core_outbox
      WHERE kind = 'message' AND payload->>'to' = ${email}
        AND payload->>'template_key' = 'platform_invitation'
      ORDER BY id DESC LIMIT 1`;
    if (mail === undefined || config.credentials === null) throw new Error('no invitation mail');
    expect(mail.aggregate_id).toBe(invitationId);
    return createCredentialsCipher(config.credentials).decrypt(
      Buffer.from(mail.payload.params.link.encrypted, 'base64'),
      `core_invitations:${mail.aggregate_id}`,
    );
  }

  /** Invited, accepted and enrolled: the user, the secret and the session cookies. */
  async function enrolledStaff(role: 'super_admin' | 'admin' | 'support' = 'admin') {
    const email = freshEmail('platform');
    const created = await app.get(Invitations, { strict: false }).createPlatform({
      email,
      name: 'Invited',
      role,
      invitedBy: null,
      locale: 'en',
    });
    // Adversary M-3: ids only from the service; the link is read from its sealed mail row.
    expect(created).not.toHaveProperty('link');
    const token = (await invitationLink(email, created.invitationId)).split('/').at(-1) ?? '';
    const accepted = await write('/v1/platform/auth/invitations/accept')
      .send({ token, name: 'Huda', password })
      .expect(200);
    const challenge = schemas.PlatformAcceptInvitation200Response.parse(accepted.body);
    const enrolment = await write('/v1/platform/auth/totp/enrol')
      .send({ challenge_id: challenge.challenge_id })
      .expect(200);
    const uri = new URL(String((enrolment.body as { otpauth_uri: string }).otpauth_uri));
    const secret = fromBase32(uri.searchParams.get('secret') ?? '');
    const confirmed = await write('/v1/platform/auth/totp/confirm')
      .send({ challenge_id: challenge.challenge_id, code: totpAt(secret, nowSeconds()) })
      .expect(200);
    return { email, userId: created.userId, secret, confirmed, accepted, enrolment };
  }

  beforeAll(async () => {
    const redisUrl = config.redis.url?.reveal();
    if (redisUrl === undefined) throw new Error('REDIS_URL is required for this suite');
    redis = new Redis(redisUrl);
    owner = connectAs('owner', config);
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
    hasher = app.get(PasswordHasher, { strict: false });
    passwordHash = await hasher.hash(password);
  });

  afterAll(async () => {
    await app?.close();
    const left = await redis.keys(`elx-test-${runId}:*`);
    if (left.length > 0) await redis.del(...left);
    redis.disconnect();
    await owner.end();
  });

  it('invitation → password → TOTP enrol → confirm → session (amr pwd, totp), audited', async () => {
    const staff = await enrolledStaff('super_admin');
    const challenge = schemas.PlatformAcceptInvitation200Response.parse(staff.accepted.body);
    expect(challenge.totp_enrolment_required).toBe(true);
    expect(setCookies(staff.accepted.headers).size).toBe(0);
    const uri = String((staff.enrolment.body as { otpauth_uri: string }).otpauth_uri);
    expect(uri).toMatch(
      /^otpauth:\/\/totp\/eeasy-logistics:platform-[0-9a-f]+%40example\.test\?secret=[A-Z2-7]{32}&issuer=eeasy-logistics&algorithm=SHA1&digits=6&period=30$/,
    );

    const me = schemas.PlatformConfirmTotp200Response.parse(staff.confirmed.body);
    expect(me.user).toMatchObject({
      name: 'Huda',
      roles: ['platform_super_admin'],
      totp_enrolled: true,
    });
    const cookies = setCookies(staff.confirmed.headers);
    expect(cookies.get('el_platform_rt')?.maxAge).toBe(43_200);
    expect(decodeJwt(cookies.get('el_platform_at')?.value ?? '')).toMatchObject({
      aud: 'platform',
      sub: staff.userId,
      amr: ['pwd', 'totp'],
      roles: ['super_admin'],
    });
    const audit = await auditRowsOf(owner, String(staff.confirmed.headers['x-request-id']));
    expect(audit.map((row) => row.action)).toEqual([
      'core.auth.totp_enrolled',
      'core.session.started',
    ]);
    expect(JSON.stringify(audit)).not.toContain(uri.slice(30, 50));
    const acceptAudit = await auditRowsOf(owner, String(staff.accepted.headers['x-request-id']));
    expect(acceptAudit).toMatchObject([
      { action: 'core.invitation.accepted', after: { kind: 'platform', role: 'super_admin' } },
    ]);

    // The secret is stored encrypted, never in clear; the staff row has the invited role.
    const [row] = await owner<{ role: string; ciphertext: Buffer; key_id: string }[]>`
      SELECT role, totp_secret_ciphertext AS ciphertext, totp_key_id AS key_id
      FROM core_platform_staff WHERE user_id = ${staff.userId}`;
    expect(row).toMatchObject({ role: 'super_admin', key_id: 'platform-sign-in' });
    const base32Secret = new URL(uri).searchParams.get('secret') ?? '';
    expect(row?.ciphertext.toString('latin1')).not.toContain(base32Secret);

    // The confirmed session reads platformGetMe; the token used was the accepted invitation's.
    await http()
      .get('/v1/platform/me')
      .set('Cookie', cookieHeader({ el_platform_at: cookies.get('el_platform_at')?.value }))
      .expect(200);
  });

  it('signs in with TOTP and refuses the same code again in its window (replay)', async () => {
    const staff = await enrolledStaff();
    const step = await login(staff.email).expect(200);
    const challenge = schemas.PlatformLogin200Response.parse(step.body);
    expect(challenge.totp_enrolment_required).toBe(false);
    expect(setCookies(step.headers).size).toBe(0);
    const code = totpAt(staff.secret, nowSeconds());
    // The confirming code was this step's (or the previous one's): refused for its window.
    const replay = await write('/v1/platform/auth/totp/verify')
      .send({ challenge_id: challenge.challenge_id, code })
      .expect(401);
    expect(codeOf(replay)).toBe('otp_invalid');
    // A later step's code passes once (the guard moved back two steps to stand for time passing).
    await owner`UPDATE core_platform_staff SET totp_last_step = ${totpStep(nowSeconds()) - 2}
                WHERE user_id = ${staff.userId}`;
    const verified = await write('/v1/platform/auth/totp/verify')
      .send({ challenge_id: challenge.challenge_id, code })
      .expect(200);
    expect(decodeJwt(setCookies(verified.headers).get('el_platform_at')?.value ?? '').amr).toEqual([
      'pwd',
      'totp',
    ]);
    const again = (await login(staff.email).expect(200)).body as { challenge_id: string };
    expect(
      codeOf(
        await write('/v1/platform/auth/totp/verify')
          .send({ challenge_id: again.challenge_id, code })
          .expect(401),
      ),
    ).toBe('otp_invalid');
  });

  it('ends a TOTP challenge after five wrong codes', async () => {
    const staff = await enrolledStaff();
    await owner`UPDATE core_platform_staff SET totp_last_step = ${totpStep(nowSeconds()) - 2}
                WHERE user_id = ${staff.userId}`;
    const challenge = (await login(staff.email).expect(200)).body as { challenge_id: string };
    const code = totpAt(staff.secret, nowSeconds());
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await write('/v1/platform/auth/totp/verify')
        .send({ challenge_id: challenge.challenge_id, code: otherCode(otherCode(code)) })
        .expect(401);
    }
    expect(
      codeOf(
        await write('/v1/platform/auth/totp/verify')
          .send({ challenge_id: challenge.challenge_id, code })
          .expect(401),
      ),
    ).toBe('otp_invalid');
  });

  it('enrols only once, only after a password step, and refuses expired challenges', async () => {
    const staff = await enrolledStaff();
    const challenge = (await login(staff.email).expect(200)).body as { challenge_id: string };
    expect(
      codeOf(
        await write('/v1/platform/auth/totp/enrol')
          .send({ challenge_id: challenge.challenge_id })
          .expect(409),
      ),
    ).toBe('second_factor_already_enrolled');
    const id = challenge.challenge_id.slice(0, 36);
    await owner`UPDATE core_platform_staff SET totp_secret_ciphertext = NULL, totp_key_id = NULL
                WHERE user_id = ${staff.userId}`;
    await owner`UPDATE core_auth_challenges SET amr = '{}' WHERE id = ${id}`;
    expect(
      codeOf(
        await write('/v1/platform/auth/totp/enrol')
          .send({ challenge_id: challenge.challenge_id })
          .expect(401),
      ),
    ).toBe('reauthentication_required');
    await owner`UPDATE core_auth_challenges SET expires_at = now() - interval '1 second' WHERE id = ${id}`;
    for (const path of ['enrol', 'verify', 'confirm']) {
      const response = await write(`/v1/platform/auth/totp/${path}`)
        .send(
          path === 'enrol'
            ? { challenge_id: challenge.challenge_id }
            : { challenge_id: challenge.challenge_id, code: '123456' },
        )
        .expect(401);
      expect(codeOf(response)).toBe('token_expired');
    }
  });

  it('answers one body and one password check for unknown, disabled, staff-less and revoked users', async () => {
    const verify = vi.spyOn(hasher, 'verify');
    const disabled = await insertUser(owner, { passwordHash });
    await insertPlatformStaff(owner, disabled.id, 'admin');
    await owner`UPDATE core_users SET disabled_at = now() WHERE id = ${disabled.id}`;
    const merchant = await insertUser(owner, { passwordHash });
    await insertMembership(owner, await insertAccount(owner), merchant.id);
    const revoked = await insertUser(owner, { passwordHash });
    await insertPlatformStaff(owner, revoked.id, 'support');
    await owner`UPDATE core_platform_staff SET revoked_at = now() WHERE user_id = ${revoked.id}`;
    const known = await insertUser(owner, { passwordHash });
    await insertPlatformStaff(owner, known.id, 'support');
    const bodies: unknown[] = [];
    for (const [email, secret] of [
      [freshEmail('nobody'), password],
      [disabled.email, password],
      [merchant.email, password],
      [revoked.email, password],
      [known.email, `${password}-wrong`],
    ] as const) {
      verify.mockClear();
      const response = await login(email, secret).expect(401);
      expect(verify).toHaveBeenCalledTimes(1);
      const { code, message } = response.body as ErrorBody;
      bodies.push({ code, message });
    }
    verify.mockRestore();
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(bodies[0]).toMatchObject({ code: 'invalid_credentials' });
    // A known staff user without TOTP gets the enrolment flag.
    const fresh = await login(known.email).expect(200);
    expect(schemas.PlatformLogin200Response.parse(fresh.body).totp_enrolment_required).toBe(true);
  });

  it('slides the 12-hour idle expiry on refresh, ends an idle session, and logs out', async () => {
    const staff = await enrolledStaff();
    let pair = setCookies(staff.confirmed.headers);
    // The row's life is short now; a rotation gives the successor a full 12 hours again.
    await owner`UPDATE core_refresh_tokens SET expires_at = now() + interval '1 minute'
                WHERE user_id = ${staff.userId} AND surface = 'platform' AND used_at IS NULL`;
    const rotated = await write('/v1/platform/auth/refresh')
      .set('Cookie', cookieHeader({ el_platform_rt: pair.get('el_platform_rt')?.value }))
      .expect(204);
    pair = setCookies(rotated.headers);
    expect(pair.get('el_platform_rt')?.maxAge).toBeGreaterThan(43_190);
    const [live] = await owner<{ left: number }[]>`
      SELECT extract(epoch FROM expires_at - now())::int AS left FROM core_refresh_tokens
      WHERE user_id = ${staff.userId} AND surface = 'platform' AND used_at IS NULL
        AND revoked_at IS NULL`;
    expect(live?.left).toBeGreaterThan(43_190);

    // Twelve idle hours on the database clock: the live row's expiry passed.
    await owner`UPDATE core_refresh_tokens SET expires_at = now() - interval '1 second'
                WHERE user_id = ${staff.userId} AND surface = 'platform' AND used_at IS NULL`;
    const expired = await write('/v1/platform/auth/refresh')
      .set('Cookie', cookieHeader({ el_platform_rt: pair.get('el_platform_rt')?.value }))
      .expect(401);
    expect(codeOf(expired)).toBe('token_expired');
    expect(setCookies(expired.headers).get('el_platform_rt')?.maxAge).toBe(0);

    // Logout of a new session revokes its family.
    await owner`UPDATE core_platform_staff SET totp_last_step = ${totpStep(nowSeconds()) - 2}
                WHERE user_id = ${staff.userId}`;
    const challenge = (await login(staff.email).expect(200)).body as { challenge_id: string };
    const signedIn = setCookies(
      (
        await write('/v1/platform/auth/totp/verify')
          .send({ challenge_id: challenge.challenge_id, code: totpAt(staff.secret, nowSeconds()) })
          .expect(200)
      ).headers,
    );
    const both = cookieHeader({
      el_platform_at: signedIn.get('el_platform_at')?.value,
      el_platform_rt: signedIn.get('el_platform_rt')?.value,
    });
    const out = await write('/v1/platform/auth/logout').set('Cookie', both).expect(204);
    expect(setCookies(out.headers).get('el_platform_at')?.maxAge).toBe(0);
    await write('/v1/platform/auth/refresh')
      .set('Cookie', cookieHeader({ el_platform_rt: signedIn.get('el_platform_rt')?.value }))
      .expect(401);
  });

  it('refuses every platform auth write without the console marker (403)', async () => {
    for (const path of [
      'auth/login',
      'auth/totp/verify',
      'auth/invitations/accept',
      'auth/totp/enrol',
      'auth/totp/confirm',
      'auth/refresh',
    ]) {
      await http()
        .post(`/v1/platform/${path}`)
        .set('X-Forwarded-For', address())
        .send({})
        .expect(403);
    }
    // The staff web's marker is not the console's (ADR-0038).
    await http()
      .post('/v1/platform/auth/login')
      .set(webClientHeaders(config, 'staff'))
      .send({ email: freshEmail(), password })
      .expect(403);
  });
});
