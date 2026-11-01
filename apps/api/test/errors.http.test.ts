import { Body, Controller, Get, HttpCode, NotFoundException, Post } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { ApiException } from '../src/modules/kernel/errors/api-exception.js';
import type { ErrorBody } from '../src/modules/kernel/errors/exception.filter.js';
import { Public } from '../src/modules/kernel/public/index.js';

// PLAT-6 item A: request ids (plan 2.1) and the global exception filter (plan 2.2) through the
// full application module. The probe controller is public: authentication is item B's and C's.

/** The parsed `Error` body of a supertest response. */
const errorOf = (response: { body: unknown }): ErrorBody => response.body as ErrorBody;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

@Public()
@Controller('probe')
class ProbeController {
  @Get('known')
  known(): never {
    throw new ApiException('version_conflict', {
      details: { current_status: 'assigned', version: 4 },
    });
  }

  @Get('fields')
  fields(): never {
    throw new ApiException('validation_failed', {
      fields: [{ pointer: '/body/name', code: 'required' }],
    });
  }

  @Get('limited')
  limited(): never {
    throw new ApiException('rate_limited', {
      details: { retry_after_s: 7 },
      headers: { 'Retry-After': '7' },
    });
  }

  @Get('framework')
  framework(): never {
    throw new NotFoundException('order 0192 of account acme is gone');
  }

  @Get('crash')
  crash(): never {
    const error = new Error('password=hunter2 in SELECT * FROM core_accounts WHERE id = $1');
    (error as Error & { code: string }).code = '42P01';
    throw error;
  }

  @Get('ok')
  ok(): { ok: true } {
    return { ok: true };
  }

  @Post('echo')
  @HttpCode(200)
  echo(@Body() body: unknown): unknown {
    return body;
  }
}

describe('request ids and the Error schema', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('renders an ApiException as the Error schema with request_id, details and the header', async () => {
    const response = await http().get('/probe/known').expect(409);
    const requestId = response.headers['x-request-id'];
    expect(requestId).toMatch(uuidPattern);
    expect(errorOf(response)).toEqual({
      code: 'version_conflict',
      message: 'تغيّر السجل منذ تحميله. أعد التحميل ثم حاول مرة أخرى.',
      details: { current_status: 'assigned', version: 4 },
      request_id: requestId,
    });
  });

  it('switches the message to English with Accept-Language: en', async () => {
    const response = await http().get('/probe/known').set('Accept-Language', 'en-US,en;q=0.9');
    expect(errorOf(response).message).toBe(
      'The record changed since you loaded it. Reload and try again.',
    );
    expect(response.headers['content-language']).toBe('en');
  });

  it('echoes an incoming UUID request id on success and on error', async () => {
    const incoming = '0b9c8d2e-4f1a-4c3b-9d7e-6a5b4c3d2e1f';
    const ok = await http().get('/probe/ok').set('X-Request-Id', incoming).expect(200);
    expect(ok.headers['x-request-id']).toBe(incoming);
    const failed = await http().get('/probe/known').set('X-Request-Id', incoming.toUpperCase());
    expect(failed.headers['x-request-id']).toBe(incoming);
    expect(errorOf(failed).request_id).toBe(incoming);
  });

  it('replaces a request id that is not a UUID', async () => {
    const response = await http()
      .get('/probe/known')
      .set('X-Request-Id', "abc'; DROP TABLE x; --")
      .expect(409);
    expect(response.headers['x-request-id']).toMatch(uuidPattern);
    expect(errorOf(response).request_id).toBe(response.headers['x-request-id']);
  });

  it('localises field problems inside details.fields', async () => {
    const response = await http().get('/probe/fields').set('Accept-Language', 'en').expect(400);
    expect(errorOf(response).details).toEqual({
      fields: [{ pointer: '/body/name', code: 'required', message: 'This field is required.' }],
    });
  });

  it('sets the headers a code needs', async () => {
    const response = await http().get('/probe/limited').expect(429);
    expect(response.headers['retry-after']).toBe('7');
    expect(errorOf(response).details).toEqual({ retry_after_s: 7 });
  });

  it('maps a framework exception to its code without echoing its text', async () => {
    const response = await http().get('/probe/framework').expect(404);
    expect(errorOf(response).code).toBe('not_found');
    expect(response.text).not.toContain('acme');
  });

  it('answers an unknown route with not_found in the Error schema', async () => {
    const response = await http().get('/v1/staff/nothing-here').expect(404);
    expect(errorOf(response).code).toBe('not_found');
    expect(errorOf(response).request_id).toBe(response.headers['x-request-id']);
  });

  it('answers 500 internal_error with no stack, query or value', async () => {
    const response = await http().get('/probe/crash').expect(500);
    expect(Object.keys(errorOf(response)).sort()).toEqual(['code', 'message', 'request_id']);
    expect(errorOf(response).code).toBe('internal_error');
    for (const leak of ['hunter2', 'SELECT', 'core_accounts', '42P01', 'at ', '.ts']) {
      expect(response.text).not.toContain(leak);
    }
  });

  it('answers malformed JSON with validation_failed and no parser detail', async () => {
    const response = await http()
      .post('/probe/echo')
      .set('Content-Type', 'application/json')
      .send('{"name": secret-value')
      .expect(400);
    expect(errorOf(response)).toMatchObject({ code: 'validation_failed' });
    expect(response.text).not.toContain('secret-value');
    expect(response.text).not.toContain('Unexpected');
  });
});
