import { randomBytes, randomInt } from 'node:crypto';
import { schemas } from '@eeasy-logistics/contracts/driver/schemas';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import type postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureHttp, createHttpAdapter, httpAppOptions } from '../../src/http-app.js';
import type { BreakerStateStore } from '../../src/modules/kernel/messaging/breaker.js';
import {
  BreakerSender,
  redisBreakerStateStore,
} from '../../src/modules/kernel/messaging/breaker.js';
import { MESSAGING_BREAKERS } from '../../src/modules/kernel/messaging/messaging.module.js';
import { EngineMessageSender } from '../../src/modules/kernel/messaging/engine/engine-message-sender.js';
import {
  RATE_LIMITER,
  RateLimiter,
  redisRateLimitStore,
} from '../../src/modules/kernel/rate-limit/rate-limiter.js';
import { testSigningKey } from '../support/access-tokens.js';
import { codeOf, newDevice, plantDriver } from './driver-fixtures.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-9 item D's OTP door tests, moved onto the real driver doors by DEL-4 item D (the test-only
// probe controller is gone): `driverRequestOtp` and `driverVerifyOtp` as `DriverAuthController`
// serves them, parsed by `ContractPipe` with the generated schemas. A verification that passes needs
// a driver now (a phone that is no one's gets no code), so those tests plant one.

const runId = randomBytes(4).toString('hex');
// One trusted proxy hop, so each test's `X-Forwarded-For` is its client address (fresh budgets).
const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `otp-door:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'otp-door',
  TRUST_PROXY_HOPS: '1',
});
const saudiMobile = () => `+96655${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;

interface ErrorBody {
  code: string;
  message: string;
  request_id: string;
  details?: unknown;
}

describe('OTP doors on the real driver doors (PLAT-9 item D, DEL-4 item D)', () => {
  let app: NestExpressApplication;
  let owner: postgres.Sql;
  let redis: Redis;
  let breakers: BreakerStateStore;
  const phones: string[] = [];
  const fresh = () => {
    const phone = saudiMobile();
    phones.push(phone);
    return phone;
  };
  const http = () => request(app.getHttpServer());
  const askFor = (phone: string, ip = `192.0.2.${randomInt(1, 255)}`) =>
    http()
      .post('/v1/driver/auth/otp/request')
      .set('X-Forwarded-For', ip)
      .set('Accept-Language', 'en')
      .send({ phone, locale: 'en' });
  const verify = (phone: string, code: string) =>
    http()
      .post('/v1/driver/auth/otp/verify')
      .set('X-Forwarded-For', `192.0.2.${randomInt(1, 255)}`)
      .set('Accept-Language', 'en')
      .send({ phone, code, device: newDevice() });
  /** A planted driver's phone (the verification tests need someone the code may sign in). */
  const driverPhone = async () => {
    const { phone } = await plantDriver(owner);
    phones.push(phone);
    return phone;
  };

  beforeAll(async () => {
    const redisUrl = config.redis.url?.reveal();
    if (redisUrl === undefined) throw new Error('REDIS_URL is required for this suite');
    redis = new Redis(redisUrl);
    breakers = redisBreakerStateStore(redis, `elx-test-${runId}:breaker`);
    owner = connectAs('owner', config);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
    })
      .overrideProvider(RATE_LIMITER)
      .useValue(new RateLimiter(redisRateLimitStore(redisUrl), { prefix: `elx-test-${runId}:rl` }))
      .overrideProvider(MESSAGING_BREAKERS)
      .useValue(breakers)
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
    if (phones.length > 0) {
      await owner`DELETE FROM core_outbox WHERE kind = 'message' AND payload->>'to' IN ${owner(phones)}`;
      await owner`DELETE FROM core_otp_challenges WHERE phone IN ${owner(phones)}`;
    }
    const left = await redis.keys(`elx-test-${runId}:*`);
    if (left.length > 0) await redis.del(...left);
    redis.disconnect();
    await owner.end();
  });

  it('answers 202 with no body and writes the challenge', async () => {
    const phone = fresh();
    const response = await askFor(`0${phone.slice(4)}`).expect(202);
    expect(response.text).toBe('');
    const rows = await owner`SELECT id FROM core_otp_challenges WHERE phone = ${phone}`;
    expect(rows).toHaveLength(1);
    // No one's phone (DEL-4 plan 2.7): the challenge and its cooldown exist, no code is sent.
    const sent = await owner`
      SELECT id FROM core_outbox WHERE kind = 'message' AND payload->>'to' = ${phone}`;
    expect(sent).toHaveLength(0);
  });

  it('refuses a body outside the contract with 400 validation_failed', async () => {
    const response = await http()
      .post('/v1/driver/auth/otp/request')
      .send({ phone: '0551234567', extra: true })
      .expect(400);
    expect((response.body as ErrorBody).code).toBe('validation_failed');
  });

  it('refuses a phone that is not one with 400 at /body/phone', async () => {
    const response = await askFor('not a phone').expect(400);
    expect(response.body).toMatchObject({
      code: 'validation_failed',
      details: { fields: [{ pointer: '/body/phone', code: 'invalid' }] },
    });
  });

  it('answers a resend inside 60 s with 429 rate_limited and Retry-After', async () => {
    const phone = fresh();
    await askFor(phone).expect(202);
    const response = await askFor(phone).expect(429);
    expect((response.body as ErrorBody).code).toBe('rate_limited');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('verifies once with 200, then answers otp_invalid with the same body as a wrong code', async () => {
    const phone = await driverPhone();
    await askFor(phone).expect(202);
    const code = await codeOf(owner, config, phone);
    schemas.DriverVerifyOtp200Response.parse((await verify(phone, code).expect(200)).body);
    const reused = (await verify(phone, code).expect(401)).body as ErrorBody;
    const wrong = (await verify(phone, code === '000000' ? '111111' : '000000').expect(401))
      .body as ErrorBody;
    const unknown = (await verify(fresh(), '123456').expect(401)).body as ErrorBody;
    for (const body of [reused, wrong, unknown]) {
      expect(body.code).toBe('otp_invalid');
      expect(body.message).toBe(reused.message);
      expect(Object.keys(body).sort()).toEqual(['code', 'message', 'request_id']);
    }
  });

  it('answers otp_invalid after five wrong codes, even for the right one', async () => {
    const phone = await driverPhone();
    await askFor(phone).expect(202);
    const code = await codeOf(owner, config, phone);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) await verify(phone, wrong).expect(401);
    const response = await verify(phone, code).expect(401);
    expect((response.body as ErrorBody).code).toBe('otp_invalid');
  });

  it('answers 503 messaging_unavailable once the sender breaker opens, and writes nothing', async () => {
    // The worker's adapter fails five times against a stub that answers 500: its breaker opens and
    // publishes the state the door reads (integrations §2.4).
    const stubUrl = config.messaging.stubUrl;
    const { serviceId, keyId, commandSecret } = config.messaging.engine;
    if (
      stubUrl === undefined ||
      serviceId === undefined ||
      keyId === undefined ||
      commandSecret === undefined
    ) {
      throw new Error('MESSAGING_STUB_URL and the WHATSAPP_ENGINE_* variables are required');
    }
    const failing = new BreakerSender(
      new EngineMessageSender({
        provider: 'stub',
        appEnv: config.app.env,
        baseUrl: stubUrl,
        key: { service: serviceId.reveal(), keyId: keyId.reveal(), secret: commandSecret.reveal() },
        headers: { 'x-stub-fault': '500' },
      }),
      breakers,
      { logger: { warn: () => undefined, log: () => undefined } },
    );
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await failing
        .sendTemplate({
          to: '+966550000000',
          templateKey: 'auth_otp',
          locale: 'en',
          params: { code: '000000' },
          idempotencyKey: `00000000-0000-7000-8000-00000000000${attempt}`,
          route: { engineAccountId: 1, senderInstanceId: '00000000-0000-4000-8000-000000000001' },
        })
        .catch(() => undefined);
    }
    expect(failing.state).toBe('open');

    const phone = fresh();
    const response = await askFor(phone).expect(503);
    expect(response.body).toMatchObject({
      code: 'messaging_unavailable',
      message: 'We cannot send messages right now. Try again in a few minutes.',
    });
    expect(await owner`SELECT id FROM core_otp_challenges WHERE phone = ${phone}`).toHaveLength(0);

    await breakers.markClosed('stub');
    await askFor(phone).expect(202);
  });
});
