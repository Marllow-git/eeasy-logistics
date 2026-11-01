import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { READINESS_CHECKS, ReadyController, readinessTimeoutMs } from '../src/health/ready.controller.js';
import type { CheckName, ReadinessCheck } from '../src/health/readiness.js';

const passing = (name: CheckName): ReadinessCheck => ({ name, run: () => Promise.resolve() });
const failing = (name: CheckName): ReadinessCheck => ({
  name,
  run: () => Promise.reject(new Error('password=secret-detail at 10.0.0.5:5432')),
});
const hanging = (name: CheckName): ReadinessCheck => ({
  name,
  run: () => new Promise<void>(() => undefined),
});

describe('GET /ready (checks replaced by fakes)', () => {
  let app: INestApplication<App> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  const start = async (checks: ReadinessCheck[]) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReadyController],
      providers: [{ provide: READINESS_CHECKS, useValue: checks }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    return request(app.getHttpServer());
  };

  it('answers 200 when every check passes', async () => {
    const http = await start([passing('database'), passing('migrations'), passing('redis')]);
    await http.get('/ready').expect(200).expect({ status: 'ready' });
  });

  it('answers 503 naming only the failing checks, never a detail', async () => {
    const http = await start([passing('database'), failing('redis'), failing('storage')]);
    const response = await http.get('/ready').expect(503);
    expect(response.body).toEqual({ status: 'not_ready', failing: ['redis', 'storage'] });
    expect(response.text).not.toContain('secret-detail');
    expect(response.text).not.toContain('10.0.0.5');
  });

  it(
    'fails a check that hangs instead of hanging itself',
    async () => {
      const http = await start([passing('database'), hanging('storage')]);
      const response = await http.get('/ready').expect(503);
      expect(response.body).toEqual({ status: 'not_ready', failing: ['storage'] });
    },
    readinessTimeoutMs + 3000,
  );
});
