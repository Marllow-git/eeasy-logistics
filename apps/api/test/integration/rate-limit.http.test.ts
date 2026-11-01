import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Controller, Get, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { staffCookie } from '../../src/modules/kernel/auth/principal.js';
import { defaultBudgets } from '../../src/modules/kernel/rate-limit/budgets.js';
import {
  RATE_LIMITER,
  RateLimiter,
  redisRateLimitStore,
} from '../../src/modules/kernel/rate-limit/rate-limiter.js';
import type { TestSigningKey } from '../support/access-tokens.js';
import { signAccessToken, testSigningKey } from '../support/access-tokens.js';
import { integrationConfig } from './support.js';

// PLAT-6 item F against the real Redis of the stack (REDIS_URL): per-identity budgets in a fixed
// one-minute window, the three RateLimit-* headers on every limited response, the 429 body, refused
// credentials charged to the client address, and fail-open with a warning when Redis is down.

@Controller('v1/staff/limit-probe')
class StaffLimitProbe {
  @Get()
  read(): { ok: true } {
    return { ok: true };
  }
}

@Controller('v1/recipient/limit-probe')
class RecipientLimitProbe {
  @Get()
  read(): { ok: true } {
    return { ok: true };
  }
}

const signing: TestSigningKey = testSigningKey();
const keys = { AUTH_SIGNING_KEY_ID: signing.keyId, AUTH_SIGNING_KEY: signing.key };
const staff = () => signAccessToken(signing, 'staff').then((token) => `${staffCookie}=${token}`);

async function start(
  config: ReturnType<typeof integrationConfig>,
  limiter?: RateLimiter,
): Promise<INestApplication<App>> {
  let builder = Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
    controllers: [StaffLimitProbe, RecipientLimitProbe],
  });
  if (limiter !== undefined) builder = builder.overrideProvider(RATE_LIMITER).useValue(limiter);
  const app = (await builder.compile()).createNestApplication<INestApplication<App>>({
    logger: false,
  });
  await app.init();
  return app;
}

describe('rate limits on Redis (PLAT-6 item F)', () => {
  const config = integrationConfig(keys);
  const redisUrl = config.redis.url?.reveal();
  const prefix = `elx:rl-test:${randomUUID()}`;
  let redis: Redis;
  let app: INestApplication<App>;
  let wired: INestApplication<App>;

  beforeAll(async () => {
    if (redisUrl === undefined) throw new Error('REDIS_URL is required for this suite');
    redis = new Redis(redisUrl);
    const budgets = {
      surfaces: { ...defaultBudgets.surfaces, staff: 60, recipient: 3 },
      routes: {},
    };
    app = await start(config, new RateLimiter(redisRateLimitStore(redisUrl), { budgets, prefix }));
    wired = await start(config);
  });

  afterAll(async () => {
    await app?.close();
    await wired?.close();
    const left = await redis.keys(`${prefix}:*`);
    if (left.length > 0) await redis.del(...left);
    redis.disconnect();
  });

  it('serves 60 requests in a minute and answers the 61st with 429 and the three headers', async () => {
    const cookie = await staff();
    for (let index = 1; index <= 60; index += 1) {
      const response = await request(app.getHttpServer())
        .get('/v1/staff/limit-probe')
        .set('Cookie', cookie)
        .expect(200);
      expect(response.headers['ratelimit-limit']).toBe('60');
      expect(response.headers['ratelimit-remaining']).toBe(String(60 - index));
    }
    const refused = await request(app.getHttpServer())
      .get('/v1/staff/limit-probe')
      .set('Cookie', cookie)
      .set('Accept-Language', 'en')
      .expect(429);
    const reset = Number(refused.headers['ratelimit-reset']);
    expect(refused.headers['ratelimit-limit']).toBe('60');
    expect(refused.headers['ratelimit-remaining']).toBe('0');
    expect(reset).toBeGreaterThanOrEqual(1);
    expect(reset).toBeLessThanOrEqual(60);
    expect(refused.headers['retry-after']).toBe(String(reset));
    const body = refused.body as {
      code: string;
      message: string;
      details: { retry_after_s: number };
      request_id: string;
    };
    expect(body.code).toBe('rate_limited');
    expect(body.details).toEqual({ retry_after_s: reset });
    expect(body.request_id).toBe(refused.headers['x-request-id']);
    expect(body.message.length).toBeGreaterThan(0);

    // Another user has a budget of their own.
    await request(app.getHttpServer())
      .get('/v1/staff/limit-probe')
      .set('Cookie', await staff())
      .expect(200);
  });

  it('keeps the counter in Redis with an expiry inside the window (INCR and PEXPIRE together)', async () => {
    const counters = await redis.keys(`${prefix}:staff:all:user:*`);
    expect(counters.length).toBeGreaterThanOrEqual(2);
    for (const key of counters) {
      const ttl = await redis.pttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60_000);
    }
  });

  it('charges a refused credential to the client address: 401 with headers, then 429', async () => {
    for (let index = 1; index <= 3; index += 1) {
      const response = await request(app.getHttpServer())
        .get('/v1/recipient/limit-probe')
        .expect(401);
      expect(response.headers['ratelimit-remaining']).toBe(String(3 - index));
    }
    const refused = await request(app.getHttpServer()).get('/v1/recipient/limit-probe').expect(429);
    expect((refused.body as { code: string }).code).toBe('rate_limited');
    const counters = await redis.keys(`${prefix}:recipient:all:ip:*`);
    expect(counters).toHaveLength(1);
  });

  it('does not limit the health probes', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.headers['ratelimit-limit']).toBeUndefined();
  });

  it('applies the README §7 budget through the real wiring (REDIS_URL)', async () => {
    const response = await request(wired.getHttpServer())
      .get('/v1/staff/limit-probe')
      .set('Cookie', await staff())
      .expect(200);
    expect(response.headers['ratelimit-limit']).toBe('600');
    expect(response.headers['ratelimit-remaining']).toBe('599');
  });
});

describe('rate limits when Redis is down (PLAT-6 item F, owner question 1)', () => {
  let app: INestApplication<App>;
  const warn = vi.spyOn(Logger.prototype, 'warn');

  beforeAll(async () => {
    // Nothing listens on this port: every hit fails at once (no offline queue).
    app = await start(integrationConfig({ ...keys, REDIS_URL: 'redis://127.0.0.1:6399' }));
  });

  afterAll(async () => {
    await app?.close();
    warn.mockRestore();
  });

  it('serves the request without rate-limit headers and logs one warning', async () => {
    for (let index = 0; index < 3; index += 1) {
      const response = await request(app.getHttpServer())
        .get('/v1/staff/limit-probe')
        .set('Cookie', await staff())
        .expect(200);
      expect(response.headers['ratelimit-limit']).toBeUndefined();
    }
    const warnings = warn.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.startsWith('rate limits not enforced'));
    expect(warnings).toHaveLength(1);
    const limiter = app.get<RateLimiter>(RATE_LIMITER);
    expect(limiter.failOpenCount).toBe(3);
  });
});
