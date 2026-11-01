import { randomBytes, randomInt } from 'node:crypto';
import { createCredentialsCipher } from '@eeasy-logistics/config';
import type { Pool } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import type { LoginResponse } from '@eeasy-logistics/contracts/staff/schemas';
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
import { PasswordHasher } from '../../src/modules/kernel/auth/passwords.js';
import { SecondFactorResets } from '../../src/modules/kernel/public/index.js';
import { EngineMessageSender } from '../../src/modules/kernel/messaging/engine/engine-message-sender.js';
import { MessageSenders } from '../../src/modules/kernel/messaging/message-sender.js';
import {
  MessageKindHandler,
  platformOnlyResolver,
} from '../../src/modules/kernel/messaging/message.handler.js';
import { KindHandlerRegistry } from '../../src/modules/kernel/outbox/kind-handlers.js';
import {
  RATE_LIMITER,
  RateLimiter,
  redisRateLimitStore,
} from '../../src/modules/kernel/rate-limit/rate-limiter.js';
import type { OutboxJob } from '../../src/worker/system/outbox-workers.js';
import { processOutboxJob } from '../../src/worker/system/outbox-workers.js';
import { testSigningKey } from '../support/access-tokens.js';
import { webClientHeaders } from '../support/web-client.js';
import { auditRowsOf } from './audit-rows.js';
import {
  cookieHeader,
  insertAccount,
  insertMembership,
  insertUser,
  setCookies,
} from './identity-fixtures.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-11 item F over HTTP on the real tables (plan 2.8, 2.16): the phone second factor of staff
// through PLAT-9's OTP service, the codes delivered by the worker's `message` handler to the
// stack's WhatsApp stub and read back from it; five wrong codes end a challenge; `amr` carries
// `otp`; an account selection comes only after the factor; enrolment at sign-in (N2) and through
// the emailed link after a reset (`SecondFactorResets.issueLink`, PLAT-12's caller).

const runId = randomBytes(4).toString('hex');
const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `second-factor:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'second-factor',
  TRUST_PROXY_HOPS: '1',
});
const cipher = createCredentialsCipher(
  config.credentials ??
    ((): never => {
      throw new Error('credentials');
    })(),
);
const password = `correct horse ${randomBytes(6).toString('hex')}`;
const address = () => `203.0.113.${randomInt(1, 255)}`;
const saudiMobile = () => `+96657${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
const quiet = { log: () => undefined, warn: () => undefined };

interface ErrorBody {
  code: string;
  details?: Record<string, unknown>;
}

describe('staff second factor over HTTP (PLAT-11 item F)', () => {
  let app: NestExpressApplication;
  let owner: postgres.Sql;
  let redis: Redis;
  let pool: Pool<PlatformDatabase>;
  let handler: MessageKindHandler;
  let passwordHash: string;
  const phones: string[] = [];
  const fresh = () => {
    const phone = saudiMobile();
    phones.push(phone);
    return phone;
  };
  const http = () => request(app.getHttpServer());
  const write = (path: string, ip = address()) =>
    http()
      .post(path)
      .set(webClientHeaders(config, 'staff'))
      .set('X-Forwarded-For', ip)
      .set('Accept-Language', 'en');
  const login = (email: string) =>
    write('/v1/staff/auth/login').send({ email, password }).expect(200);

  const stub = () => {
    const { stubUrl, engine } = config.messaging;
    if (
      stubUrl === undefined ||
      engine.serviceId === undefined ||
      engine.keyId === undefined ||
      engine.commandSecret === undefined ||
      engine.platformInstanceId === undefined
    ) {
      throw new Error('MESSAGING_STUB_URL and the WHATSAPP_ENGINE_* variables are required');
    }
    return {
      stubUrl,
      key: {
        service: engine.serviceId.reveal(),
        keyId: engine.keyId.reveal(),
        secret: engine.commandSecret.reveal(),
      },
      route: { engineAccountId: 1, senderInstanceId: engine.platformInstanceId },
    };
  };

  /**
   * What the worker does with the newest OTP row of the phone: the `message` handler decrypts the
   * code and sends it through the engine adapter to the stub, which shows it.
   */
  async function codeSentTo(phone: string): Promise<string> {
    const [row] = await owner<{ id: string }[]>`
      SELECT id FROM core_outbox WHERE kind = 'message' AND payload->>'to' = ${phone}
      ORDER BY id DESC LIMIT 1`;
    if (row === undefined) throw new Error(`no OTP row for ${phone}`);
    const job = {
      data: { outboxId: row.id },
      moveToDelayed: vi.fn(() => Promise.resolve()),
      updateData: vi.fn(() => Promise.resolve()),
    } as unknown as OutboxJob;
    await processOutboxJob(
      {
        db: pool.db,
        registry: new KindHandlerRegistry([handler]),
        logger: quiet,
        random: () => 0.5,
      },
      'message',
      job,
      'token',
    );
    const response = await fetch(`${stub().stubUrl}/v1/last-code?to=${encodeURIComponent(phone)}`);
    const sent = (await response.json()) as { code: string; eeasy_message_id: string };
    expect(sent.eeasy_message_id).toBe(row.id);
    return sent.code;
  }

  const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

  /** A user with this password, an enrolled phone (or none) and one membership per account. */
  async function member(options: { accounts?: string[]; phone?: string | null } = {}) {
    const accounts = options.accounts ?? [
      await insertAccount(owner, { secondFactorRequired: true }),
    ];
    const phone = options.phone === null ? undefined : (options.phone ?? fresh());
    const user = await insertUser(owner, { passwordHash, secondFactorPhone: phone });
    const memberships = [];
    for (const accountId of accounts) {
      memberships.push(await insertMembership(owner, accountId, user.id));
    }
    return { ...user, phone, accounts, memberships };
  }

  beforeAll(async () => {
    const redisUrl = config.redis.url?.reveal();
    if (redisUrl === undefined) throw new Error('REDIS_URL is required for this suite');
    redis = new Redis(redisUrl);
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'second-factor-test');
    const settings = stub();
    const senders = new MessageSenders({
      whatsapp: new EngineMessageSender({
        provider: 'stub',
        appEnv: config.app.env,
        baseUrl: settings.stubUrl,
        key: settings.key,
      }),
      mail: null,
      platformRoute: settings.route,
    });
    handler = new MessageKindHandler({
      senders,
      cipher,
      resolver: platformOnlyResolver(senders),
      logger: quiet,
    });
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
    if (phones.length > 0) {
      await owner`DELETE FROM core_outbox WHERE kind = 'message' AND payload->>'to' IN ${owner(phones)}`;
      await owner`DELETE FROM core_otp_challenges WHERE phone IN ${owner(phones)}`;
    }
    const left = await redis.keys(`elx-test-${runId}:*`);
    if (left.length > 0) await redis.del(...left);
    redis.disconnect();
    await Promise.all([owner.end(), pool.close()]);
  });

  it('passes the factor: challenge → code through the stub → session with amr pwd, otp', async () => {
    const user = await member();
    const first = (await login(user.email)).body as LoginResponse;
    expect(first).toMatchObject({ second_factor_required: true, me: null });
    const challengeId = first.challenge_id ?? '';
    await write('/v1/staff/auth/second-factor/request')
      .send({ challenge_id: challengeId })
      .expect(202);
    const code = await codeSentTo(user.phone ?? '');

    const verified = await write('/v1/staff/auth/second-factor/verify')
      .send({ challenge_id: challengeId, code })
      .expect(200);
    const body = schemas.VerifySecondFactor200Response.parse(verified.body);
    expect(body.me?.membership?.id).toBe(user.memberships[0]);
    const cookies = setCookies(verified.headers);
    const claims = decodeJwt(cookies.get('el_staff_at')?.value ?? '');
    expect(claims.amr).toEqual(['pwd', 'otp']);
    expect(claims.acc).toBe(user.accounts[0]);
    const audit = await auditRowsOf(owner, String(verified.headers['x-request-id']));
    expect(audit).toMatchObject([
      { action: 'core.session.started', after: { amr: ['pwd', 'otp'], surface: 'staff' } },
    ]);
    // The refresh keeps the methods.
    const refreshed = await write('/v1/staff/auth/refresh')
      .set('Cookie', cookieHeader({ el_staff_rt: cookies.get('el_staff_rt')?.value }))
      .expect(204);
    expect(decodeJwt(setCookies(refreshed.headers).get('el_staff_at')?.value ?? '').amr).toEqual([
      'pwd',
      'otp',
    ]);
    // Spent: the same challenge and code again.
    await write('/v1/staff/auth/second-factor/verify')
      .send({ challenge_id: challengeId, code })
      .expect(401)
      .expect((response) => expect((response.body as ErrorBody).code).toBe('otp_invalid'));
  });

  it('asks an enrolled user for the factor even when no account requires it (8.2 #17)', async () => {
    const user = await member({ accounts: [await insertAccount(owner)] });
    const body = (await login(user.email)).body as LoginResponse;
    expect(body).toMatchObject({ second_factor_required: true, me: null });
  });

  it('ends the challenge after five wrong codes, whatever the OTP itself still allows', async () => {
    const user = await member();
    const challengeId = ((await login(user.email)).body as LoginResponse).challenge_id ?? '';
    await write('/v1/staff/auth/second-factor/request')
      .send({ challenge_id: challengeId })
      .expect(202);
    const code = await codeSentTo(user.phone ?? '');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await write('/v1/staff/auth/second-factor/verify')
        .send({ challenge_id: challengeId, code: wrong(code) })
        .expect(401)
        .expect((response) => expect((response.body as ErrorBody).code).toBe('otp_invalid'));
    }
    // The OTP's own count forgiven: the challenge's five still refuse the right code.
    await owner`UPDATE core_otp_challenges SET attempts = 0 WHERE phone = ${user.phone ?? ''}`;
    await write('/v1/staff/auth/second-factor/verify')
      .send({ challenge_id: challengeId, code })
      .expect(401)
      .expect((response) => expect((response.body as ErrorBody).code).toBe('otp_invalid'));
    const [row] = await owner<{ attempts: number }[]>`
      SELECT attempts FROM core_auth_challenges WHERE id = ${challengeId.slice(0, 36)}`;
    expect(row?.attempts).toBe(5);
    await write('/v1/staff/auth/second-factor/request')
      .send({ challenge_id: challengeId })
      .expect(401)
      .expect((response) => expect((response.body as ErrorBody).code).toBe('token_invalid'));
  });

  it('refuses unknown and expired challenges with the contract codes', async () => {
    const unknown = `${'0'.repeat(8)}-0000-7000-8000-${'0'.repeat(12)}.${'a'.repeat(43)}`;
    await write('/v1/staff/auth/second-factor/request')
      .send({ challenge_id: unknown })
      .expect(401)
      .expect((response) => expect((response.body as ErrorBody).code).toBe('token_invalid'));
    const user = await member();
    const challengeId = ((await login(user.email)).body as LoginResponse).challenge_id ?? '';
    await owner`UPDATE core_auth_challenges SET expires_at = now() - interval '1 second'
                WHERE id = ${challengeId.slice(0, 36)}`;
    await write('/v1/staff/auth/second-factor/verify')
      .send({ challenge_id: challengeId, code: '123456' })
      .expect(401)
      .expect((response) => expect((response.body as ErrorBody).code).toBe('token_expired'));
  });

  it('lists the accounts only after the factor, then selects one with otp kept', async () => {
    const accounts = [
      await insertAccount(owner, { secondFactorRequired: true }),
      await insertAccount(owner),
    ];
    const user = await member({ accounts });
    const first = (await login(user.email)).body as LoginResponse;
    expect(first).toMatchObject({
      second_factor_required: true,
      account_selection_required: false,
    });
    expect(first.memberships).toBeUndefined();
    await write('/v1/staff/auth/second-factor/request')
      .send({ challenge_id: first.challenge_id })
      .expect(202);
    const code = await codeSentTo(user.phone ?? '');
    const step = (
      await write('/v1/staff/auth/second-factor/verify')
        .send({ challenge_id: first.challenge_id, code })
        .expect(200)
    ).body as LoginResponse;
    expect(step.account_selection_required).toBe(true);
    expect(step.memberships?.map((membership) => membership.membership_id)).toEqual(
      user.memberships,
    );
    const selected = await write('/v1/staff/auth/select-account')
      .send({ selection_token: step.selection_token, membership_id: user.memberships[0] })
      .expect(200);
    const claims = decodeJwt(setCookies(selected.headers).get('el_staff_at')?.value ?? '');
    expect(claims).toMatchObject({ acc: accounts[0], amr: ['pwd', 'otp'] });
  });

  it('enrols at sign-in (N2): enrolment token → phone → code → enabled, then the factor is asked', async () => {
    const user = await member({ phone: null });
    const first = (await login(user.email)).body as LoginResponse;
    expect(first).toMatchObject({ enrolment_required: true, me: null });
    const phone = fresh();
    const local = `0${phone.slice(4)}`;
    const enrolled = await write('/v1/staff/auth/second-factor/enrol')
      .send({ enrolment_token: first.enrolment_token, phone: local })
      .expect(202);
    const pending = schemas.EnrolSecondFactor202Response.parse(enrolled.body);
    expect(pending.challenge_id).toBe((first.enrolment_token ?? '').slice(0, 36));
    const code = await codeSentTo(phone);
    await write('/v1/staff/auth/second-factor/confirm')
      .send({ enrolment_token: first.enrolment_token, challenge_id: 'x'.repeat(36), code })
      .expect(401)
      .expect((response) => expect((response.body as ErrorBody).code).toBe('token_invalid'));
    await write('/v1/staff/auth/second-factor/confirm')
      .send({
        enrolment_token: first.enrolment_token,
        challenge_id: pending.challenge_id,
        code: wrong(code),
      })
      .expect(401)
      .expect((response) => expect((response.body as ErrorBody).code).toBe('otp_invalid'));
    const confirmed = await write('/v1/staff/auth/second-factor/confirm')
      .send({ enrolment_token: first.enrolment_token, challenge_id: pending.challenge_id, code })
      .expect(204);
    const audit = await auditRowsOf(owner, String(confirmed.headers['x-request-id']));
    expect(audit).toMatchObject([
      { action: 'core.auth.second_factor_enrolled', actorId: user.id, after: { via: 'sign_in' } },
    ]);
    expect(JSON.stringify(audit)).not.toContain(phone.slice(4));
    const [stored] = await owner<{ enabled: boolean; phone: string }[]>`
      SELECT second_factor_enabled AS enabled, second_factor_phone AS phone
      FROM core_users WHERE id = ${user.id}`;
    expect(stored).toEqual({ enabled: true, phone });
    // Spent, and a second enrolment refused while one is enrolled.
    await write('/v1/staff/auth/second-factor/enrol')
      .send({ enrolment_token: first.enrolment_token, phone: fresh() })
      .expect(401);
    const again = (await login(user.email)).body as LoginResponse;
    expect(again).toMatchObject({ second_factor_required: true, enrolment_required: false });
  });

  it('re-enrols after a reset only through the emailed link plus the password', async () => {
    const user = await member();
    const before = await (async () => {
      const challengeId = ((await login(user.email)).body as LoginResponse).challenge_id ?? '';
      await write('/v1/staff/auth/second-factor/request')
        .send({ challenge_id: challengeId })
        .expect(202);
      const code = await codeSentTo(user.phone ?? '');
      return write('/v1/staff/auth/second-factor/verify')
        .send({ challenge_id: challengeId, code })
        .expect(200);
    })();
    const oldRefresh = setCookies(before.headers).get('el_staff_rt')?.value;

    const resets = app.get(SecondFactorResets, { strict: false });
    const issued = await resets.issueLink({
      userId: user.id,
      issuedBy: null,
      accountId: user.accounts[0] ?? null,
      requestId: `reset-${runId}-${user.id}`,
    });
    expect(issued.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3600 * 1000);
    const [mail] = await owner<{ payload: { template_key: string; params: { link: string } } }[]>`
      SELECT payload FROM core_outbox WHERE kind = 'message' AND payload->>'to' = ${user.email}
      ORDER BY id DESC LIMIT 1`;
    expect(mail?.payload.template_key).toBe('second_factor_reset');
    const link = mail?.payload.params.link ?? '';
    expect(link).toMatch(
      /^http:\/\/localhost:3001\/second-factor\/enrol\/[\da-f-]{36}\.[\w-]{43}$/,
    );
    const linkToken = link.split('/').at(-1) ?? '';
    // The sessions ended.
    await write('/v1/staff/auth/refresh')
      .set('Cookie', cookieHeader({ el_staff_rt: oldRefresh }))
      .expect(401);

    // The password alone: no factor asked any more, but enrolment refused (409).
    const signIn = (await login(user.email)).body as LoginResponse;
    expect(signIn).toMatchObject({ enrolment_required: true });
    await write('/v1/staff/auth/second-factor/enrol')
      .send({ enrolment_token: signIn.enrolment_token, phone: fresh() })
      .expect(409)
      .expect((response) =>
        expect((response.body as ErrorBody).code).toBe('second_factor_already_enrolled'),
      );
    // The link alone (unredeemed) is no enrolment token; a wrong password is refused.
    await write('/v1/staff/auth/second-factor/enrol')
      .send({ enrolment_token: linkToken, phone: fresh() })
      .expect(401);
    await write('/v1/staff/auth/second-factor/enrolment-link')
      .send({ link_token: linkToken, password: `${password}!` })
      .expect(401)
      .expect((response) => expect((response.body as ErrorBody).code).toBe('invalid_credentials'));
    const redeemed = await write('/v1/staff/auth/second-factor/enrolment-link')
      .send({ link_token: linkToken, password })
      .expect(200);
    const token = schemas.RedeemEnrolmentLink200Response.parse(redeemed.body);
    await write('/v1/staff/auth/second-factor/enrolment-link')
      .send({ link_token: linkToken, password })
      .expect(401)
      .expect((response) => expect((response.body as ErrorBody).code).toBe('token_invalid'));

    const phone = fresh();
    const pending = (
      await write('/v1/staff/auth/second-factor/enrol')
        .send({ enrolment_token: token.enrolment_token, phone })
        .expect(202)
    ).body as { challenge_id: string };
    const code = await codeSentTo(phone);
    const confirmed = await write('/v1/staff/auth/second-factor/confirm')
      .send({ enrolment_token: token.enrolment_token, challenge_id: pending.challenge_id, code })
      .expect(204);
    expect(await auditRowsOf(owner, String(confirmed.headers['x-request-id']))).toMatchObject([
      { action: 'core.auth.second_factor_enrolled', after: { via: 'link' } },
    ]);
    const [stored] = await owner<{ phone: string }[]>`
      SELECT second_factor_phone AS phone FROM core_users WHERE id = ${user.id}`;
    expect(stored?.phone).toBe(phone);
  });

  it('refuses every second-factor write without the web client marker (403)', async () => {
    for (const path of ['request', 'verify', 'enrol', 'confirm', 'enrolment-link']) {
      await http()
        .post(`/v1/staff/auth/second-factor/${path}`)
        .set('X-Forwarded-For', address())
        .send({})
        .expect(403);
    }
  });
});
