import { defineConfig } from '@eeasy-logistics/config';
import type { INestApplication } from '@nestjs/common';
import { SpanKind } from '@opentelemetry/api';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTelemetry } from '../src/modules/kernel/telemetry/sdk.js';

// PLAT-14 adversary A-6 through the whole HTTP path, with one trusted proxy hop (production): a
// public-surface request carrying a foreign traceparent starts a new trace; a staff request (our
// web client behind the edge) continues it. The SDK starts before Nest loads (dynamic imports).

const exporter = new InMemorySpanExporter();
const handle = startTelemetry(defineConfig({ APP_ENV: 'ci', TRUST_PROXY_HOPS: '1' }), 'api', {
  spanExporter: exporter,
});
const foreignTrace = '0af7651916cd43dd8448eb211c80319c';
const traceparent = `00-${foreignTrace}-b7ad6b7169203331-01`;

describe('trace context at the edge (adversary A-6)', () => {
  let app: INestApplication<App>;
  let get: (path: string) => Promise<number>;

  beforeAll(async () => {
    const { Test } = await import('@nestjs/testing');
    const { default: request } = await import('supertest');
    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
    await app.init();
    get = async (path) =>
      (await request(app.getHttpServer()).get(path).set('traceparent', traceparent)).status;
  });

  afterAll(async () => {
    await app?.close();
    await handle?.shutdown();
  });

  beforeEach(() => exporter.reset());

  const serverSpan = () =>
    exporter.getFinishedSpans().find((span) => span.kind === SpanKind.SERVER);

  it('starts a new trace for a public-surface request with a foreign traceparent', async () => {
    await get('/v1/public/anything');
    const span = serverSpan();
    expect(span).toBeDefined();
    expect(span?.spanContext().traceId).not.toBe(foreignTrace);
    expect(span?.parentSpanContext).toBeUndefined();
  });

  it('continues the trace of a staff request through the trusted ingress', async () => {
    expect(await get('/v1/staff/audit-log')).toBe(401);
    expect(serverSpan()?.spanContext().traceId).toBe(foreignTrace);
  });
});
