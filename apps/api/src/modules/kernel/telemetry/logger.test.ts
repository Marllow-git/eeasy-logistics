import type { LogLevel } from '@eeasy-logistics/config';
import { defineConfig } from '@eeasy-logistics/config';
import { runWithContext } from '@eeasy-logistics/db/testing';
import { Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { RequestIdMiddleware, serverRequestIdOf } from '../request/request-id.js';
import { JsonLogger } from './logger.js';
import { startTelemetry } from './sdk.js';

// PLAT-14 item D (plan 2.4): one JSON line per event, every argument through the redactor.

const phone = '+966512345678';
const account = '0192f0e0-0000-7000-8000-00000000000a';

function capture(level: LogLevel = 'debug') {
  const lines: string[] = [];
  const logger = new JsonLogger({
    service: 'elx-api',
    release: 'sha-test',
    level,
    write: (line) => lines.push(line),
  });
  const parsed = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, lines, parsed };
}

afterEach(() => {
  Logger.overrideLogger(false);
});

describe('JsonLogger', () => {
  it('writes one JSON line with the documented fields', () => {
    const { logger, lines, parsed } = capture();
    logger.log('Outbox relay started', 'Worker');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith('\n')).toBe(true);
    expect(lines[0]?.slice(0, -1)).not.toContain('\n');
    const [line] = parsed();
    expect(Object.keys(line ?? {}).sort()).toEqual(
      ['context', 'level', 'msg', 'release', 'service', 'ts'].sort(),
    );
    expect(line).toMatchObject({
      level: 'info',
      msg: 'Outbox relay started',
      context: 'Worker',
      service: 'elx-api',
      release: 'sha-test',
    });
    expect(new Date(String(line?.ts)).toISOString()).toBe(line?.ts);
  });

  it('masks a phone number planted in a log argument, message, data or stack', () => {
    const { logger, lines } = capture();
    logger.warn(`Message to ${phone} failed`, 'Messaging');
    logger.log({ recipient: phone, note: `call ${phone}`, token: 'abc' }, 'Messaging');
    const error = new Error(`no route to ${phone}`);
    logger.error(error.message, error.stack, 'Errors');
    logger.error(error);
    const all = lines.join('');
    expect(all).not.toContain('966512345678');
    expect(all).not.toContain('"abc"');
    expect(all).toContain('[phone …5678]');
  });

  it('names the request, the tenant and the trace when inside them', async () => {
    const { logger, parsed } = capture();
    const handle = startTelemetry(defineConfig({ APP_ENV: 'ci' }), 'api', {
      spanExporter: new InMemorySpanExporter(),
    });
    const tracer = trace.getTracer('test');
    let ids: { traceId: string; spanId: string } | undefined;
    await runWithContext(
      {
        accountId: account,
        membershipId: null,
        userId: null,
        deviceId: null,
        actingCrossTenant: false,
      },
      () => {
        tracer.startActiveSpan('probe', (span) => {
          ids = span.spanContext();
          logger.log('inside');
          span.end();
        });
        return Promise.resolve();
      },
    );
    await handle?.shutdown();
    const [line] = parsed();
    expect(line).toMatchObject({
      account_id: account,
      trace_id: ids?.traceId,
      span_id: ids?.spanId,
    });
    expect(line?.request_id).toBeUndefined(); // outside a request
  });

  it('names the server request id, and the client id apart, inside a request', () => {
    const { logger, parsed } = capture();
    const client = '0192f0e0-0000-7000-8000-0000000c11e0';
    const request = { headers: { 'x-request-id': client }, method: 'GET' } as unknown as Request;
    const headers: Record<string, string> = {};
    const response = {
      setHeader: (name: string, value: string) => (headers[name] = value),
      once: () => undefined,
    } as unknown as Response;
    new RequestIdMiddleware().use(request, response, () => logger.log('handled'));
    const [line] = parsed();
    expect(line?.request_id).toBe(serverRequestIdOf(request));
    expect(line?.request_id).not.toBe(client);
    expect(line?.client_request_id).toBe(client);
  });

  it('writes nothing below its level', () => {
    const { logger, lines } = capture('warn');
    logger.debug('noise');
    logger.log('info');
    logger.warn('kept');
    logger.error('kept too');
    expect(lines).toHaveLength(2);
  });

  it('is what every Nest Logger writes through once installed', () => {
    const { logger, parsed } = capture();
    Logger.overrideLogger(logger);
    new Logger('OutboxWorkers').warn(`Outbox job failed for ${phone}`);
    const [line] = parsed();
    expect(line).toMatchObject({
      level: 'warn',
      context: 'OutboxWorkers',
      msg: 'Outbox job failed for [phone …5678]',
    });
  });

  it('never throws, even for a value JSON cannot hold', () => {
    const { logger } = capture();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => logger.log(cyclic)).not.toThrow();
  });
});
