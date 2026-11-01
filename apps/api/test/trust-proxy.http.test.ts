import { defineConfig } from '@eeasy-logistics/config';
import { Controller, Get, Req } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { configureHttp } from '../src/http-app.js';
import { Public } from '../src/modules/kernel/public/index.js';

// PLAT-6 review round 2, finding 1: `X-Forwarded-For` is believed only to the configured depth
// (`TRUST_PROXY_HOPS`), so the client address the rate limiter keys anonymous callers by is the
// one the edge saw, and a caller cannot choose it by prepending entries.

@Controller('probe/ip')
@Public()
class IpProbe {
  @Get()
  ip(@Req() req: Request): { ip: string | undefined } {
    return { ip: req.ip };
  }
}

async function ipSeen(hops: string, forwardedFor?: string): Promise<string | undefined> {
  const moduleRef = await Test.createTestingModule({ controllers: [IpProbe] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureHttp(app, defineConfig({ APP_ENV: 'local', TRUST_PROXY_HOPS: hops }));
  await app.init();
  try {
    const call = request(app.getHttpServer()).get('/probe/ip');
    const response = await (forwardedFor === undefined
      ? call
      : call.set('X-Forwarded-For', forwardedFor));
    return (response.body as { ip?: string }).ip;
  } finally {
    await app.close();
  }
}

const chain = '198.51.100.7, 203.0.113.9';

describe('trust proxy depth (TRUST_PROXY_HOPS)', () => {
  it('ignores X-Forwarded-For with 0 hops: the socket address', async () => {
    const ip = await ipSeen('0', chain);
    expect(ip).toMatch(/127\.0\.0\.1|::1/);
  });

  it('takes the last entry with 1 hop (the address Cloudflare saw), never an earlier one', async () => {
    expect(await ipSeen('1', chain)).toBe('203.0.113.9');
  });

  it('takes the entry at the configured depth with 2 hops', async () => {
    expect(await ipSeen('2', chain)).toBe('198.51.100.7');
  });

  it('falls back to the socket address when no header is sent', async () => {
    expect(await ipSeen('1')).toMatch(/127\.0\.0\.1|::1/);
  });
});
