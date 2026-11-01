import { randomBytes, randomInt } from 'node:crypto';
import type { LoginResponse, Me } from '@eeasy-logistics/contracts/staff/schemas';
import { schemas } from '@eeasy-logistics/contracts/staff/schemas';
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
import { MailSender } from '../../src/modules/kernel/messaging/mail-sender.js';
import {
  RATE_LIMITER,
  RateLimiter,
  redisRateLimitStore,
} from '../../src/modules/kernel/rate-limit/rate-limiter.js';
import { signAccessToken, testSigningKey } from '../support/access-tokens.js';
import { webClientHeaders } from '../support/web-client.js';
import { auditRowsOf } from './audit-rows.js';
import {
  cookieHeader,
  freshEmail,
  insertAccount,
  insertMembership,
  insertUser,
  setCookies,
} from './identity-fixtures.js';
import { connectAs, integrationConfig, mailpitUrl } from './support.js';

// PLAT-11 item D over HTTP on the real tables (plan 2.7, 2.10, 2.11, 2.16): invitation accept → login
// → me; one body and one password verification for unknown, disabled and wrong-password sign-ins;
// the factor steps' contract shapes; account selection and switch; password reset end to end with
// the mail through Mailpit in Arabic and English; the web client marker on every auth write; the
// login budgets per email and per address.

const runId = randomBytes(4).toString('hex');
const signing = testSigningKey();
// One trusted proxy hop, so each test's `X-Forwarded-For` is its client address (fresh budgets).
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `sign-in:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'sign-in',
  TRUST_PROXY_HOPS: '1',
});
const password = `correct horse ${randomBytes(6).toString('hex')}`;
/** An entry of the bundled NCSC list (apps/api/resources/README.md). */
const onTheBreachedList = '1qaz2wsx3edc';
const address = () => `198.51.100.${randomInt(1, 255)}`;

interface ErrorBody {
  code: string;
  message: string;
  request_id: string;
  details?: Record<string, unknown>;
}

interface MailRow {
  id: string;
  payload: {
    to: string;
    locale: 'ar' | 'en';
    template_key: string;
    params: Record<string, string>;
  };
  account_id: string | null;
}

describe('staff sign-in over HTTP (PLAT-11 item D)', () => {
  let app: NestExpressApplication;
  let owner: postgres.Sql;
  let redis: Redis;
  let hasher: PasswordHasher;
  let passwordHash: string;
  const http = () => request(app.getHttpServer());
  const write = (path: string, ip = address()) =>
    http()
      .post(path)
      .set(webClientHeaders(config, 'staff'))
      .set('X-Forwarded-For', ip)
      .set('Accept-Language', 'en');
  const login = (email: string, secret = password, ip?: string) =>
    write('/v1/staff/auth/login', ip).send({ email, password: secret });

  /** A user with this password and one active membership (or the given ones). */
  async function member(
    options: { accounts?: string[]; secondFactorPhone?: string; locale?: 'ar' | 'en' } = {},
  ) {
    const accounts = options.accounts ?? [await insertAccount(owner)];
    const user = await insertUser(owner, {
      passwordHash,
      locale: options.locale,
      secondFactorPhone: options.secondFactorPhone,
    });
    const memberships = [];
    for (const accountId of accounts) {
      memberships.push(await insertMembership(owner, accountId, user.id));
    }
    return { ...user, accounts, memberships };
  }

  async function mailTo(email: string, template: string): Promise<MailRow> {
    const [row] = await owner<MailRow[]>`
      SELECT id, payload, account_id FROM core_outbox
      WHERE kind = 'message' AND payload->>'to' = ${email} AND payload->>'template_key' = ${template}
      ORDER BY created_at DESC LIMIT 1`;
    if (row === undefined) throw new Error(`no ${template} mail to ${email}`);
    return row;
  }

  const tokenOf = (link: string | undefined) => (link ?? '').split('/').at(-1) ?? '';

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

  describe('invitations', () => {
    it('accepts an invitation (password, name, membership active, audited), then signs in again', async () => {
      const accountId = await insertAccount(owner, { name: 'Acme Riyadh' });
      const email = freshEmail('invitee');
      const invitations = app.get(Invitations, { strict: false });
      const created = await invitations.createStaff({
        accountId,
        email: email.toUpperCase(),
        name: 'Invited',
        roles: ['dispatcher'],
        siteIds: [],
        invitedBy: null,
        locale: 'en',
      });
      const mail = await mailTo(email, 'invitation');
      expect(mail.account_id).toBeNull();
      expect(mail.payload.params).toEqual({ account_name: 'Acme Riyadh', link: created.link });
      expect(created.link).toMatch(/^http:\/\/localhost:3001\/invitations\/[\w-]{43}$/);

      const accepted = await write('/v1/staff/auth/invitations/accept')
        .send({ token: tokenOf(created.link), name: 'Nora', password, locale: 'ar' })
        .expect(200);
      const me = schemas.AcceptInvitation200Response.parse(accepted.body);
      expect(me.user).toMatchObject({ name: 'Nora', email, locale: 'ar' });
      expect(me.membership).toMatchObject({ status: 'active', roles: ['dispatcher'] });
      expect(setCookies(accepted.headers).get('el_staff_at')).toBeDefined();
      const audit = await auditRowsOf(owner, String(accepted.headers['x-request-id']));
      expect(audit.map((row) => row.action)).toEqual([
        'core.invitation.accepted',
        'core.session.started',
      ]);

      await write('/v1/staff/auth/invitations/accept')
        .send({ token: tokenOf(created.link), name: 'Nora', password })
        .expect(401)
        .expect((response) => expect((response.body as ErrorBody).code).toBe('token_invalid'));
      const signedIn = await login(email).expect(200);
      expect((signedIn.body as LoginResponse).me?.membership?.id).toBe(created.membershipId);
    });

    it('refuses an expired invitation with token_expired and a breached password with 400', async () => {
      const accountId = await insertAccount(owner);
      const created = await app.get(Invitations, { strict: false }).createStaff({
        accountId,
        email: freshEmail('expired'),
        name: 'Late',
        roles: ['viewer'],
        siteIds: [],
        invitedBy: null,
        locale: 'ar',
      });
      const breached = await write('/v1/staff/auth/invitations/accept')
        .send({ token: tokenOf(created.link), name: 'Late', password: onTheBreachedList })
        .expect(400);
      expect(breached.body).toMatchObject({
        code: 'validation_failed',
        details: { fields: [{ pointer: '/body/password', code: 'breached' }] },
      });
      await owner`UPDATE core_invitations SET expires_at = now() - interval '1 second' WHERE id = ${created.invitationId}`;
      await write('/v1/staff/auth/invitations/accept')
        .send({ token: tokenOf(created.link), name: 'Late', password })
        .expect(401)
        .expect((response) => expect((response.body as ErrorBody).code).toBe('token_expired'));
    });

    it('refuses a driver role combined with a cash role before writing anything (PLAT-10 A-7)', async () => {
      const accountId = await insertAccount(owner);
      const email = freshEmail('combo');
      await expect(
        app.get(Invitations, { strict: false }).createStaff({
          accountId,
          email,
          name: 'Combo',
          roles: ['driver', 'cashier'],
          siteIds: [],
          invitedBy: null,
          locale: 'en',
        }),
      ).rejects.toMatchObject({ code: 'role_combination_forbidden' });
      expect(await owner`SELECT 1 FROM core_users WHERE email = ${email}`).toHaveLength(0);
    });
  });

  describe('login', () => {
    it('signs a single-membership user in: me, cookies, amr pwd on the access token', async () => {
      const user = await member();
      const response = await login(user.email.toUpperCase()).expect(200);
      const body = schemas.Login200Response.parse(response.body);
      expect(body).toMatchObject({
        second_factor_required: false,
        account_selection_required: false,
        enrolment_required: false,
      });
      expect(body.me?.account?.id).toBe(user.accounts[0]);
      const access = setCookies(response.headers).get('el_staff_at')?.value ?? '';
      expect(decodeJwt(access)).toMatchObject({
        sub: user.id,
        acc: user.accounts[0],
        mem: user.memberships[0],
        amr: ['pwd'],
        roles: ['owner'],
        scopes: '',
      });
      await http()
        .get('/v1/staff/me')
        .set('Cookie', cookieHeader({ el_staff_at: access }))
        .expect(200);
    });

    it('answers unknown, disabled, membership-less and wrong-password users with one body after one verification each', async () => {
      const verify = vi.spyOn(hasher, 'verify');
      const disabled = await member();
      await owner`UPDATE core_users SET disabled_at = now() WHERE id = ${disabled.id}`;
      const lonely = await insertUser(owner, { passwordHash });
      const known = await member();
      const bodies: ErrorBody[] = [];
      for (const [email, secret] of [
        [freshEmail('nobody'), password],
        [disabled.email, password],
        [lonely.email, password],
        [known.email, `${password}-wrong`],
      ] as const) {
        verify.mockClear();
        const response = await login(email, secret).expect(401);
        expect(verify).toHaveBeenCalledTimes(1);
        bodies.push(response.body as ErrorBody);
        expect(setCookies(response.headers).size).toBe(0);
      }
      verify.mockRestore();
      const shapes = bodies.map(({ request_id: _id, ...rest }) => rest);
      expect(new Set(shapes.map((shape) => JSON.stringify(shape))).size).toBe(1);
      expect(shapes[0]).toMatchObject({ code: 'invalid_credentials' });
    });

    it('lists the memberships of a multi-account user, then selectAccount starts the chosen one', async () => {
      const first = await insertAccount(owner, { name: 'First' });
      const second = await insertAccount(owner, { name: 'Second' });
      const suspended = await insertAccount(owner, { name: 'Suspended', status: 'suspended' });
      const user = await member({ accounts: [first, second, suspended] });
      const response = await login(user.email).expect(200);
      const body = response.body as LoginResponse;
      expect(body.account_selection_required).toBe(true);
      expect(body.me).toBeNull();
      expect(setCookies(response.headers).size).toBe(0);
      expect(body.memberships?.map((m) => m.account_name)).toEqual(['First', 'Second']);
      const token = body.selection_token ?? '';

      // A membership that is not pinned is 404, even an active one added after the password step
      // (and the suspended account's); the token stays usable.
      const later = await insertMembership(owner, await insertAccount(owner), user.id);
      await write('/v1/staff/auth/select-account')
        .send({ selection_token: token, membership_id: later })
        .expect(404);
      await write('/v1/staff/auth/select-account')
        .send({ selection_token: token, membership_id: user.memberships[2] })
        .expect(404);
      const selected = await write('/v1/staff/auth/select-account')
        .send({ selection_token: token, membership_id: user.memberships[1] })
        .expect(200);
      expect((selected.body as Me).account?.id).toBe(second);
      const access = setCookies(selected.headers).get('el_staff_at')?.value ?? '';
      expect(decodeJwt(access)).toMatchObject({ acc: second, mem: user.memberships[1] });
      // Single use.
      await write('/v1/staff/auth/select-account')
        .send({ selection_token: token, membership_id: user.memberships[0] })
        .expect(401)
        .expect((r) => expect((r.body as ErrorBody).code).toBe('token_invalid'));
      await write('/v1/staff/auth/select-account')
        .send({ selection_token: `${token.slice(0, 37)}${'A'.repeat(43)}`, membership_id: second })
        .expect(401);
    });

    it('asks an enrolled user for the second factor: challenge_id, no cookie (leg 2 verifies it)', async () => {
      const accountId = await insertAccount(owner, { secondFactorRequired: true });
      const user = await member({ accounts: [accountId], secondFactorPhone: '+966551234567' });
      const response = await login(user.email).expect(200);
      const body = schemas.Login200Response.parse(response.body);
      expect(body).toMatchObject({ second_factor_required: true, me: null });
      expect(body.challenge_id).toMatch(/^[\da-f-]{36}\.[\w-]{43}$/);
      expect(setCookies(response.headers).size).toBe(0);
      const [challenge] = await owner<{ kind: string; amr: string[]; ttl: number }[]>`
        SELECT kind, amr, extract(epoch from (expires_at - created_at))::int AS ttl
        FROM core_auth_challenges WHERE id = ${(body.challenge_id ?? '').slice(0, 36)}`;
      expect(challenge).toEqual({ kind: 'second_factor', amr: ['pwd'], ttl: 300 });
    });

    it('asks for enrolment when an account requires a factor the user has not enrolled (N2)', async () => {
      const accountId = await insertAccount(owner, { secondFactorRequired: true });
      const plain = await insertAccount(owner);
      const user = await member({ accounts: [plain, accountId] });
      const body = (await login(user.email).expect(200)).body as LoginResponse;
      expect(body).toMatchObject({ enrolment_required: true, me: null });
      expect(body.memberships).toBeUndefined();
      const [challenge] = await owner<{ kind: string; ttl: number }[]>`
        SELECT kind, extract(epoch from (expires_at - created_at))::int AS ttl
        FROM core_auth_challenges WHERE id = ${(body.enrolment_token ?? '').slice(0, 36)}`;
      expect(challenge).toEqual({ kind: 'enrolment', ttl: 600 });
    });

    it('charges 10 sign-ins per email an hour, then 429 with Retry-After, also for a known password', async () => {
      const user = await member();
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await login(user.email, `${password}-x`).expect(401);
      }
      const refused = await login(user.email).expect(429);
      expect(refused.body).toMatchObject({ code: 'rate_limited' });
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('charges 50 sign-ins per address an hour', async () => {
      const ip = `203.0.113.${randomInt(1, 255)}`;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await login(freshEmail('spray'), password, ip).expect(401);
      }
      await login(freshEmail('spray'), password, ip).expect(429);
    });
  });

  describe('switchAccount', () => {
    it('moves the session to another membership, revokes the old family, refuses a suspended or foreign one', async () => {
      const first = await insertAccount(owner);
      const second = await insertAccount(owner);
      const user = await member({ accounts: [first, second] });
      const selection = (await login(user.email).expect(200)).body as LoginResponse;
      const started = await write('/v1/staff/auth/select-account')
        .send({ selection_token: selection.selection_token, membership_id: user.memberships[0] })
        .expect(200);
      const cookies = setCookies(started.headers);
      const jar = cookieHeader({
        el_staff_at: cookies.get('el_staff_at')?.value,
        el_staff_rt: cookies.get('el_staff_rt')?.value,
      });

      const other = await member();
      await write('/v1/staff/auth/switch-account')
        .set('Cookie', jar)
        .send({ membership_id: other.memberships[0] })
        .expect(404);

      const switched = await write('/v1/staff/auth/switch-account')
        .set('Cookie', jar)
        .send({ membership_id: user.memberships[1] })
        .expect(200);
      expect((switched.body as Me).account?.id).toBe(second);
      const access = setCookies(switched.headers).get('el_staff_at')?.value ?? '';
      expect(decodeJwt(access)).toMatchObject({ acc: second, amr: ['pwd'] });
      await write('/v1/staff/auth/refresh')
        .set('Cookie', cookieHeader({ el_staff_rt: cookies.get('el_staff_rt')?.value }))
        .expect(401);

      await owner`UPDATE core_accounts SET status = 'suspended' WHERE id = ${first}`;
      await write('/v1/staff/auth/switch-account')
        .set('Cookie', cookieHeader({ el_staff_at: access }))
        .send({ membership_id: user.memberships[0] })
        .expect(403)
        .expect((response) => expect((response.body as ErrorBody).code).toBe('account_suspended'));
    });

    it('answers 401 second_factor_required with a challenge_id when the target account requires a factor the session lacks', async () => {
      const plain = await insertAccount(owner);
      const strict = await insertAccount(owner);
      const user = await member({ accounts: [plain, strict], secondFactorPhone: '+966551234568' });
      // Sign in on the plain account (no factor yet), then the strict one starts requiring it.
      await owner`UPDATE core_users SET second_factor_enabled = false WHERE id = ${user.id}`;
      const selection = (await login(user.email).expect(200)).body as LoginResponse;
      const started = await write('/v1/staff/auth/select-account')
        .send({ selection_token: selection.selection_token, membership_id: user.memberships[0] })
        .expect(200);
      await owner`UPDATE core_users SET second_factor_enabled = true WHERE id = ${user.id}`;
      await owner`UPDATE core_accounts SET settings = '{"second_factor_required": true}' WHERE id = ${strict}`;
      const refused = await write('/v1/staff/auth/switch-account')
        .set(
          'Cookie',
          cookieHeader({ el_staff_at: setCookies(started.headers).get('el_staff_at')?.value }),
        )
        .send({ membership_id: user.memberships[1] })
        .expect(401);
      expect((refused.body as ErrorBody).code).toBe('second_factor_required');
      expect((refused.body as ErrorBody).details?.challenge_id).toMatch(/^[\da-f-]{36}\./);
    });
  });

  describe('password reset', () => {
    async function mailpitMessage(messageId: string): Promise<{ Subject: string; Text: string }> {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const search = await fetch(
          `${mailpitUrl()}/api/v1/search?query=${encodeURIComponent(`message-id:"${messageId}"`)}`,
        );
        const { messages } = (await search.json()) as { messages: { ID: string }[] };
        const found = messages[0];
        if (found !== undefined) {
          const full = await fetch(`${mailpitUrl()}/api/v1/message/${found.ID}`);
          return (await full.json()) as { Subject: string; Text: string };
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Mailpit has no message ${messageId}`);
    }

    it.each([
      ['en', 'Reset your Eeasy Logistics password'],
      ['ar', 'إعادة تعيين كلمة المرور في إيزي لوجستكس'],
    ] as const)(
      'mails a %s reset link that reaches Mailpit, single use, ending every session',
      async (locale, subject) => {
        const user = await member({ locale });
        const before = await login(user.email).expect(200);
        const oldRefresh = setCookies(before.headers).get('el_staff_rt')?.value;
        await write('/v1/staff/auth/password-reset/request')
          .send({ email: user.email })
          .expect(202);
        const mail = await mailTo(user.email, 'password_reset');
        expect(mail.payload.locale).toBe(locale);
        const link = mail.payload.params.link ?? '';
        expect(link).toMatch(/^http:\/\/localhost:3001\/password-reset\/[\w-]{43}$/);

        // What the worker's mail adapter sends for this row (PLAT-9), through the stack's Mailpit.
        const smtpUrl = config.mail.smtpUrl?.reveal();
        const from = config.mail.from;
        if (smtpUrl === undefined || from === undefined)
          throw new Error('MAIL_SMTP_URL and MAIL_FROM are required');
        const sender = new MailSender({ appEnv: config.app.env, smtpUrl, from });
        try {
          await sender.sendTemplate({
            to: mail.payload.to,
            templateKey: 'password_reset',
            locale: mail.payload.locale,
            params: { link },
            idempotencyKey: mail.id,
          });
        } finally {
          sender.close();
        }
        const delivered = await mailpitMessage(`${mail.id}@eeasy-logistics`);
        expect(delivered.Subject).toBe(subject);
        expect(delivered.Text).toContain(link);

        const fresh = `new horse battery ${randomBytes(6).toString('hex')}`;
        const confirmed = await write('/v1/staff/auth/password-reset/confirm')
          .send({ token: tokenOf(link), password: fresh })
          .expect(204);
        const audit = await auditRowsOf(owner, String(confirmed.headers['x-request-id']));
        expect(audit).toMatchObject([
          { action: 'core.auth.password_reset', actorId: user.id, after: { sessions_ended: 1 } },
        ]);
        await write('/v1/staff/auth/password-reset/confirm')
          .send({ token: tokenOf(link), password: `${fresh}!` })
          .expect(401)
          .expect((response) => expect((response.body as ErrorBody).code).toBe('token_invalid'));
        await write('/v1/staff/auth/refresh')
          .set('Cookie', cookieHeader({ el_staff_rt: oldRefresh }))
          .expect(401);
        await login(user.email).expect(401);
        await login(user.email, fresh).expect(200);
      },
    );

    it('answers 202 for an unknown email and writes nothing', async () => {
      const email = freshEmail('unknown');
      await write('/v1/staff/auth/password-reset/request').send({ email }).expect(202);
      expect(
        await owner`SELECT 1 FROM core_outbox WHERE kind = 'message' AND payload->>'to' = ${email}`,
      ).toHaveLength(0);
    });

    it('keeps one live token per user and refuses an expired one with token_expired', async () => {
      const user = await member();
      await write('/v1/staff/auth/password-reset/request').send({ email: user.email }).expect(202);
      const firstLink = (await mailTo(user.email, 'password_reset')).payload.params.link;
      await write('/v1/staff/auth/password-reset/request').send({ email: user.email }).expect(202);
      const secondLink = (await mailTo(user.email, 'password_reset')).payload.params.link;
      expect(secondLink).not.toBe(firstLink);
      await write('/v1/staff/auth/password-reset/confirm')
        .send({ token: tokenOf(firstLink), password: `another horse ${runId}` })
        .expect(401);
      await owner`UPDATE core_password_resets SET expires_at = now() - interval '1 second' WHERE user_id = ${user.id} AND used_at IS NULL`;
      await write('/v1/staff/auth/password-reset/confirm')
        .send({ token: tokenOf(secondLink), password: `another horse ${runId}` })
        .expect(401)
        .expect((response) => expect((response.body as ErrorBody).code).toBe('token_expired'));
    });

    it('charges 3 reset requests per email an hour', async () => {
      const email = freshEmail('reset-budget');
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await write('/v1/staff/auth/password-reset/request').send({ email }).expect(202);
      }
      await write('/v1/staff/auth/password-reset/request').send({ email }).expect(429);
    });
  });

  it.each([
    ['/v1/staff/auth/login', { email: 'a@example.test', password: 'x' }],
    ['/v1/staff/auth/invitations/accept', { token: 't', name: 'n', password: 'p'.repeat(12) }],
    [
      '/v1/staff/auth/select-account',
      { selection_token: 't', membership_id: '00000000-0000-4000-8000-000000000001' },
    ],
    ['/v1/staff/auth/switch-account', { membership_id: '00000000-0000-4000-8000-000000000001' }],
    ['/v1/staff/auth/password-reset/request', { email: 'a@example.test' }],
    ['/v1/staff/auth/password-reset/confirm', { token: 't', password: 'p'.repeat(12) }],
  ])('refuses %s without X-EL-Client with 403', async (path, body) => {
    // A signed-in caller too (switch-account authenticates before the marker check).
    const access = await signAccessToken(signing, 'staff');
    const response = await http()
      .post(path)
      .set('Cookie', cookieHeader({ el_staff_at: access }))
      .send(body)
      .expect(403);
    expect((response.body as ErrorBody).code).toBe('forbidden');
  });
});
