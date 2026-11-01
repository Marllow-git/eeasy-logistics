import { defineConfig } from '@eeasy-logistics/config';
import { operationSchemas } from '@eeasy-logistics/contracts/platform/schemas';
import type { INestApplication } from '@nestjs/common';
import { SpanKind } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTelemetry } from '../src/modules/kernel/telemetry/sdk.js';

// PLAT-14 item B (plan 2.2, 2.9): a request through the whole frame produces one server span
// carrying the request id, the surface and the operation id, and no path parameter value, query
// string or header. The SDK starts before Nest, Express and supertest load (dynamic imports
// below), as main.ts does, so the HTTP instrumentation sees them.

const exporter = new InMemorySpanExporter();
const handle = startTelemetry(defineConfig({ APP_ENV: 'ci' }), 'api', { spanExporter: exporter });

const outboxId = '0192f0e0-1234-7000-8000-00000000abcd';
const phone = '+966512345678';

describe('request spans (PLAT-14 item B)', () => {
  let close: () => Promise<void>;
  let get: (
    path: string,
    headers?: Record<string, string>,
  ) => Promise<{ status: number; headers: Record<string, string> }>;

  beforeAll(async () => {
    const { Controller, Get } = await import('@nestjs/common');
    const { Test } = await import('@nestjs/testing');
    const { default: request } = await import('supertest');
    const { AppModule } = await import('../src/app.module.js');
    const { Input, Operation, Public } = await import('../src/modules/kernel/public/index.js');
    const list = operationSchemas.platformListAccounts;

    @Controller('probe/telemetry')
    @Public()
    class TelemetryProbe {
      @Get('accounts')
      @Operation(list)
      list(@Input() input: unknown): unknown {
        return input;
      }
    }

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TelemetryProbe],
    }).compile();
    const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
    await app.init();
    get = async (path, headers = {}) => {
      const response = await request(app.getHttpServer()).get(path).set(headers);
      return { status: response.status, headers: response.headers };
    };
    close = () => app.close();
  });

  afterAll(async () => {
    await close?.();
    await handle?.shutdown();
  });

  beforeEach(() => exporter.reset());

  const serverSpans = (): ReadableSpan[] =>
    exporter.getFinishedSpans().filter((span) => span.kind === SpanKind.SERVER);

  it('names the request id, surface and route template; never the path value or query', async () => {
    const response = await get(
      `/v1/platform/outbox/${outboxId}?phone=${encodeURIComponent(phone)}`,
    );
    expect(response.status).toBe(401);
    const spans = serverSpans();
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span?.attributes['elx.request_id']).toBe(response.headers['x-request-id']);
    expect(span?.attributes['elx.surface']).toBe('platform');
    expect(span?.attributes['http.route']).toBe('/v1/platform/outbox/:outbox_id');
    expect(span?.name).toBe('GET /v1/platform/outbox/:outbox_id');
    const everything = JSON.stringify(
      exporter.getFinishedSpans().map((s) => [s.name, s.attributes]),
    );
    expect(everything).not.toContain(outboxId);
    expect(everything).not.toContain('966512345678');
    expect(everything).not.toMatch(/phone|cookie|user.agent/i);
  });

  it('names the operation the handler binds', async () => {
    const response = await get('/probe/telemetry/accounts?limit=25');
    expect(response.status).toBe(200);
    const [span] = serverSpans();
    expect(span?.attributes['elx.operation_id']).toBe('platformListAccounts');
    expect(JSON.stringify(span?.attributes)).not.toContain('limit');
  });

  it('carries the server-minted id, never the id a client chose', async () => {
    const chosen = '0192f0e0-0000-7000-8000-0000000c11e0';
    const response = await get('/probe/telemetry/accounts', { 'X-Request-Id': chosen });
    expect(response.headers['x-request-id']).toBe(chosen);
    const [span] = serverSpans();
    expect(span?.attributes['elx.request_id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(span?.attributes)).not.toContain(chosen);
  });
});
