import { defineConfig } from '@eeasy-logistics/config';
import type { INestApplication } from '@nestjs/common';
import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as Sentry from '@sentry/node';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { ApiException } from '../src/modules/kernel/errors/api-exception.js';
import { Public } from '../src/modules/kernel/public/index.js';
import { closeSentry, initSentry } from '../src/modules/kernel/telemetry/sentry.js';

// PLAT-14 item E (plan 2.5): through the global exception filter, a 500 is reported to Sentry and
// a 4xx never is; the event that leaves carries the request id and no phone, cookie or header.
// A test transport records the envelopes instead of sending them.

const phone = '+966512345678';
const envelopes: string[] = [];

@Controller('probe/sentry')
@Public()
class SentryProbe {
  @Get('validation')
  validation(): never {
    throw new ApiException('validation_failed');
  }

  @Get('unauthenticated')
  unauthenticated(): never {
    throw new UnauthorizedException();
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException(`not for ${phone}`);
  }

  @Get('missing')
  missing(): never {
    throw new NotFoundException();
  }

  @Get('rate-limited')
  rateLimited(): never {
    throw new ApiException('rate_limited');
  }

  @Get('crash')
  crash(): never {
    throw new TypeError(`cannot read recipient ${phone}`);
  }
}

describe('Sentry reports (PLAT-14 item E)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const config = defineConfig({
      APP_ENV: 'ci',
      ELX_RELEASE: 'sha-sentry-test',
      SENTRY_DSN: 'https://public@o1.ingest.example.test/1',
    });
    const started = initSentry(config, 'api', {
      transport: (options) =>
        Sentry.createTransport(options, (envelope) => {
          envelopes.push(
            typeof envelope.body === 'string'
              ? envelope.body
              : Buffer.from(envelope.body).toString(),
          );
          return Promise.resolve({ statusCode: 200 });
        }),
    });
    expect(started).toBe(true);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [SentryProbe],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await closeSentry();
  });

  beforeEach(() => {
    envelopes.length = 0;
  });

  const events = async () => {
    await Sentry.flush(2_000);
    return envelopes.flatMap((envelope) =>
      envelope
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((item) => 'exception' in item),
    );
  };

  it.each([
    ['validation', 400],
    ['unauthenticated', 401],
    ['forbidden', 403],
    ['missing', 404],
    ['rate-limited', 429],
  ])('never reports a %s (%i)', async (path, status) => {
    await request(app.getHttpServer()).get(`/probe/sentry/${path}`).expect(status);
    expect(await events()).toEqual([]);
  });

  it('reports a 500 once, with the release, environment and request id, scrubbed', async () => {
    const response = await request(app.getHttpServer())
      .get(`/probe/sentry/crash?phone=${encodeURIComponent(phone)}`)
      .set('Cookie', 'el_staff_at=eyJhbGciOiJIUzI1NiJ9.e30.c2ln')
      .set('Authorization', 'Bearer abc')
      .expect(500);
    const reported = await events();
    expect(reported).toHaveLength(1);
    const [event] = reported;
    expect(event).toMatchObject({
      release: 'sha-sentry-test',
      environment: 'ci',
      server_name: 'elx-api',
    });
    expect((event?.tags as Record<string, string>).request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect((response.body as { request_id: string }).request_id).toBe(
      (event?.tags as Record<string, string>).request_id,
    );
    const text = JSON.stringify(event);
    expect(text).toContain('cannot read recipient [phone …5678]');
    expect(text).not.toContain('966512345678');
    expect(text).not.toMatch(/cookie|authorization|Bearer abc|eyJhbGci/i);
  });
});
