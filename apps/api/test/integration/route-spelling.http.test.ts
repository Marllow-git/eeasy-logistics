import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Controller, HttpCode, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureHttp, createHttpAdapter, httpAppOptions } from '../../src/http-app.js';
import { Public } from '../../src/modules/kernel/public/index.js';
import {
  RATE_LIMITER,
  RateLimiter,
  redisRateLimitStore,
} from '../../src/modules/kernel/rate-limit/rate-limiter.js';
import { integrationConfig } from './support.js';

// PLAT-6 adversary H-1: the surface of a request comes from the matched route template, never the
// raw path, so `/V1/STAFF/<door>` (Express matches case-insensitively by default) still needs the
// web client marker and is charged to the staff budget; the API process routes case-sensitively
// and strictly (`configureHttp`), and only JSON bodies are accepted (no urlencoded parser, the
// content-type guard), which closes the login-CSRF form post.

@Controller('v1/staff/door-probe')
@Public()
class DoorProbe {
  @Post()
  @HttpCode(200)
  signIn(): { ok: true } {
    return { ok: true };
  }
}

const config = integrationConfig();
const web = { 'X-EL-Client': 'web', Origin: 'http://localhost:3001' };

async function start(limiter: RateLimiter, configured: boolean): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
    controllers: [DoorProbe],
  })
    .overrideProvider(RATE_LIMITER)
    .useValue(limiter)
    .compile();
  const app = configured
    ? moduleRef.createNestApplication<NestExpressApplication>(createHttpAdapter(config), {
        ...httpAppOptions,
        logger: false,
      })
    : moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  if (configured) configureHttp(app);
  await app.init();
  return app;
}

describe('route spelling and body format (adversary H-1)', () => {
  const redisUrl = config.redis.url?.reveal() ?? '';
  const prefix = `elx:rl-test:${randomUUID()}`;
  let redis: Redis;
  let lenient: INestApplication<App>;
  let configured: INestApplication<App>;

  beforeAll(async () => {
    redis = new Redis(redisUrl);
    lenient = await start(new RateLimiter(redisRateLimitStore(redisUrl), { prefix }), false);
    configured = await start(
      new RateLimiter(redisRateLimitStore(redisUrl), { prefix: `${prefix}-c` }),
      true,
    );
  });

  afterAll(async () => {
    await lenient?.close();
    await configured?.close();
    const left = await redis.keys(`${prefix}*`);
    if (left.length > 0) await redis.del(...left);
    redis.disconnect();
  });

  it('an uppercase path to a public staff door still needs the marker and is charged', async () => {
    const response = await request(lenient.getHttpServer())
      .post('/V1/STAFF/DOOR-PROBE')
      .send({})
      .expect(403);
    expect((response.body as { code: string }).code).toBe('forbidden');
    expect(response.headers['ratelimit-limit']).toBe('600');
    expect(await redis.keys(`${prefix}:staff:all:ip:*`)).toHaveLength(1);
  });

  it('the API process routes case-sensitively and strictly: other spellings match nothing', async () => {
    await request(configured.getHttpServer())
      .post('/v1/staff/door-probe')
      .set(web)
      .send({})
      .expect(200);
    await request(configured.getHttpServer())
      .post('/V1/STAFF/DOOR-PROBE')
      .set(web)
      .send({})
      .expect(404);
    await request(configured.getHttpServer())
      .post('/v1/staff/door-probe/')
      .set(web)
      .send({})
      .expect(404);
  });

  it('refuses a urlencoded, multipart or text body even with the marker', async () => {
    for (const type of [
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'text/plain',
      'application/merge-patch+json',
      'application/vnd.api+json',
    ]) {
      const response = await request(configured.getHttpServer())
        .post('/v1/staff/door-probe')
        .set(web)
        .set('Content-Type', type)
        .send('email=a%40b.test&password=x')
        .expect(400);
      expect(response.body).toMatchObject({
        code: 'validation_failed',
        details: { fields: [{ pointer: '/header/content-type', code: 'invalid' }] },
      });
    }
    await request(configured.getHttpServer())
      .post('/v1/staff/door-probe')
      .set(web)
      .set('Content-Type', 'application/json; charset=utf-8')
      .send('{}')
      .expect(200);
  });
});
