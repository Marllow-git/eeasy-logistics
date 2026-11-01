import { randomBytes, randomInt } from 'node:crypto';
import { operationSchemas } from '@eeasy-logistics/contracts/driver/schemas';
import { createCredentialsCipher } from '@eeasy-logistics/config';
import { Controller, HttpCode, Inject, Post } from '@nestjs/common';
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
import { OtpService } from '../../src/modules/kernel/messaging/otp.service.js';
import { StubMessageSender } from '../../src/modules/kernel/messaging/stub-message-sender.js';
import type { ContractInput } from '../../src/modules/kernel/public/index.js';
import { Input, Operation, Public } from '../../src/modules/kernel/public/index.js';
import {
  RATE_LIMITER,
  RateLimiter,
  redisRateLimitStore,
} from '../../src/modules/kernel/rate-limit/rate-limiter.js';
import { ClientIp } from '../../src/modules/kernel/request/client-ip.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-9 item D: test-only door routes bound to the real `driverRequestOtp` and `driverVerifyOtp`
// operations (`core.auth.anonymous` doors, so `@Public()` passes the PLAT-10 boot check), parsed by
// `ContractPipe` with the generated schemas and passed by the permission guard. PLAT-11 replaces the
// bodies (driver lookup, device binding, tokens), not this wiring.

const requestOtp = operationSchemas.driverRequestOtp;
const verifyOtp = operationSchemas.driverVerifyOtp;

@Controller('v1/driver/auth/otp')
class OtpDoorProbe {
  constructor(@Inject(OtpService) private readonly otp: OtpService) {}

  @Post('request')
  @Public()
  @HttpCode(202)
  @Operation(requestOtp)
  async request(
    @Input() input: ContractInput<typeof requestOtp>,
    @ClientIp() ip: string | undefined,
  ): Promise<void> {
    await this.otp.request({
      phone: input.body.phone,
      purpose: 'driver_login',
      ip,
      locale: input.body.locale ?? 'ar',
    });
  }

  @Post('verify')
  @Public()
  @HttpCode(200)
  @Operation(verifyOtp)
  async verify(@Input() input: ContractInput<typeof verifyOtp>): Promise<Record<string, never>> {
    await this.otp.verify({
      phone: input.body.phone,
      purpose: 'driver_login',
      code: input.body.code,
    });
    return {};
  }
}

const runId = randomBytes(4).toString('hex');
// One trusted proxy hop, so each test's `X-Forwarded-For` is its client address (fresh budgets).
const config = integrationConfig({
  CREDENTIALS_KEYS: `otp-door:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'otp-door',
  TRUST_PROXY_HOPS: '1',
});
const saudiMobile = () => `+96655${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
const device = { device_id: 'probe-device', platform: 'android', app_version: '1.0.0' } as const;

interface ErrorBody {
  code: string;
  message: string;
  request_id: string;
  details?: unknown;
}

describe('OTP doors on the real operations (PLAT-9 item D)', () => {
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
      .set('Accept-Language', 'en')
      .send({ phone, code, device });
  /** The code a worker would send, read back by decrypting the row (the test holds the key). */
  const codeOf = async (phone: string): Promise<string> => {
    const [row] = await owner<
      { payload: { challenge_id: string; params: { code: { encrypted: string } } } }[]
    >`
      SELECT payload FROM core_outbox
      WHERE kind = 'message' AND payload->>'to' = ${phone} AND status = 'pending'`;
    if (row === undefined) throw new Error('no pending OTP row');
    if (config.credentials === null) throw new Error('no credentials');
    return createCredentialsCipher(config.credentials).decrypt(
      Buffer.from(row.payload.params.code.encrypted, 'base64'),
      `core_otp_challenges:${row.payload.challenge_id}`,
    );
  };

  beforeAll(async () => {
    const redisUrl = config.redis.url?.reveal();
    if (redisUrl === undefined) throw new Error('REDIS_URL is required for this suite');
    redis = new Redis(redisUrl);
    breakers = redisBreakerStateStore(redis, `elx-test-${runId}:breaker`);
    owner = connectAs('owner', config);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
      controllers: [OtpDoorProbe],
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
    const phone = fresh();
    await askFor(phone).expect(202);
    const code = await codeOf(phone);
    await verify(phone, code).expect(200, {});
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
    const phone = fresh();
    await askFor(phone).expect(202);
    const code = await codeOf(phone);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) await verify(phone, wrong).expect(401);
    const response = await verify(phone, code).expect(401);
    expect((response.body as ErrorBody).code).toBe('otp_invalid');
  });

  it('answers 503 messaging_unavailable once the sender breaker opens, and writes nothing', async () => {
    // The worker's adapter fails five times against a stub that answers 500: its breaker opens and
    // publishes the state the door reads (integrations §2.4).
    const stubUrl = config.messaging.stubUrl;
    if (stubUrl === undefined) throw new Error('MESSAGING_STUB_URL is required for this suite');
    const failing = new BreakerSender(
      new StubMessageSender({
        appEnv: config.app.env,
        url: stubUrl,
        templateNamespace: 'elx',
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
