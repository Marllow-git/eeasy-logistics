import { defineConfig } from '@eeasy-logistics/config';
import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ProviderFailure } from '../outbox/provider-failure.js';
import { withPortSpan } from './port-span.js';
import { startTelemetry } from './sdk.js';
import { annotateActiveSpan, recordSpan, spanAttributeAllowlist, withSpan } from './spans.js';

// PLAT-14 item B (plan 2.2): the attribute allowlist at export, job spans and port spans.

const exporter = new InMemorySpanExporter();
const handle = startTelemetry(defineConfig({ APP_ENV: 'ci' }), 'api', { spanExporter: exporter });
afterAll(() => handle?.shutdown());
beforeEach(() => exporter.reset());

const tracer = trace.getTracer('test');
const only = () => {
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(1);
  return spans[0]!;
};

describe('the span attribute allowlist (enforced at export)', () => {
  it('drops a planted header, query, path and user-agent attribute', () => {
    const span = tracer.startSpan('GET');
    span.setAttributes({
      'http.request.header.authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig',
      'http.request.header.cookie': 'el_staff_at=token',
      'url.full': 'https://api.example.test/v1/staff/orders/0192?phone=%2B966512345678',
      'url.query': 'phone=+966512345678',
      'http.target': '/v1/staff/orders/0192',
      'user_agent.original': 'Mozilla/5.0',
      'client.address': '203.0.113.7',
      'http.request.body': '{"phone":"+966512345678"}',
      'http.route': '/v1/staff/orders/:order_id',
      'http.response.status_code': 200,
      'elx.request_id': '0192f0e0-0000-7000-8000-000000000001',
    });
    span.end();
    expect(only().attributes).toEqual({
      'http.route': '/v1/staff/orders/:order_id',
      'http.response.status_code': 200,
      'elx.request_id': '0192f0e0-0000-7000-8000-000000000001',
    });
  });

  it('redacts a phone, email or token inside an allowed string attribute', () => {
    const span = tracer.startSpan('probe');
    span.setAttribute('integration.provider', 'meta +966512345678 a@b.example Bearer abc.def');
    span.end();
    const value = only().attributes['integration.provider'];
    expect(value).toBe('meta [phone …78] [email] Bearer [redacted]');
  });

  it('keeps exception events only, with a redacted message, and redacts the status message', () => {
    const span = tracer.startSpan('probe');
    span.addEvent('cache miss', { 'user.email': 'a@b.example' });
    span.recordException(new Error('send to +966512345678 failed'));
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'token=abcdef123 rejected' });
    span.end();
    const exported = only();
    expect(exported.events.map((event) => event.name)).toEqual(['exception']);
    expect(exported.events[0]?.attributes?.['exception.message']).toBe(
      'send to [phone …78] failed',
    );
    expect(exported.status.message).toBe('token=[redacted] rejected');
  });

  it('declares no header, body, query or URL attribute', () => {
    for (const key of spanAttributeAllowlist) {
      expect(key).not.toMatch(/header|body|query|url\.full|url\.path|target|user_agent|client/);
    }
  });
});

describe('withSpan', () => {
  it('starts a new trace for a root job span and nests children', async () => {
    const outer = tracer.startSpan('request');
    await context.with(trace.setSpan(context.active(), outer), () =>
      withSpan(
        'outbox.job',
        { 'elx.outbox.kind': 'push' },
        async () => {
          annotateActiveSpan({ 'elx.outbox.row_id': 'r1', 'elx.event_type': undefined });
          await withSpan('outbox.consumer', { 'elx.consumer': 'c' }, () => Promise.resolve());
        },
        { root: true },
      ),
    );
    outer.end();
    const spans = exporter.getFinishedSpans();
    const job = spans.find((span) => span.name === 'outbox.job')!;
    const consumer = spans.find((span) => span.name === 'outbox.consumer')!;
    expect(job.parentSpanContext).toBeUndefined();
    expect(job.spanContext().traceId).not.toBe(outer.spanContext().traceId);
    expect(consumer.parentSpanContext?.spanId).toBe(job.spanContext().spanId);
    expect(job.attributes).toEqual({ 'elx.outbox.kind': 'push', 'elx.outbox.row_id': 'r1' });
  });

  it('marks a thrown error, unless it is control flow', async () => {
    await expect(withSpan('a', {}, () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    class Flow extends Error {}
    await expect(
      withSpan('b', {}, () => Promise.reject(new Flow('y')), {
        isError: (error) => !(error instanceof Flow),
      }),
    ).rejects.toThrow('y');
    const [a, b] = exporter.getFinishedSpans();
    expect(a?.status.code).toBe(SpanStatusCode.ERROR);
    expect(b?.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('records a finished tick span with its start time', () => {
    const startedAt = new Date(Date.now() - 50);
    recordSpan('outbox.relay.batch', startedAt, { 'elx.relay.selected': 3 });
    const span = only();
    expect(span.attributes).toEqual({ 'elx.relay.selected': 3 });
    expect(span.duration[0] * 1e3 + span.duration[1] / 1e6).toBeGreaterThanOrEqual(40);
  });
});

describe('withPortSpan (integrations §10)', () => {
  const call = {
    port: 'message_sender',
    method: 'send',
    provider: 'stub',
    accountId: '0192f0e0-0000-7000-8000-00000000000a',
    outboxRowId: '0192f0e0-0000-7000-8000-00000000000b',
    attempt: 2,
  };

  it('names the span after port and method and carries the §10 attributes', async () => {
    const result = await withPortSpan(call, (span) => {
      span.setHttpStatus(202);
      return Promise.resolve('sent');
    });
    expect(result).toBe('sent');
    const span = only();
    expect(span.name).toBe('integration.message_sender.send');
    expect(span.attributes).toEqual({
      'integration.port': 'message_sender',
      'integration.method': 'send',
      'integration.provider': 'stub',
      'elx.account.id': call.accountId,
      'elx.outbox.row_id': call.outboxRowId,
      'integration.attempt': 2,
      'http.response.status_code': 202,
      'integration.outcome': 'ok',
    });
  });

  it('takes outcome and status from a ProviderFailure and rethrows it', async () => {
    const failure = new ProviderFailure('rate_limited', 'slow down for +966512345678', {
      status: 429,
    });
    await expect(withPortSpan(call, () => Promise.reject(failure))).rejects.toBe(failure);
    const span = only();
    expect(span.attributes['integration.outcome']).toBe('rate_limited');
    expect(span.attributes['http.response.status_code']).toBe(429);
    expect(JSON.stringify(span.events)).not.toContain('966512345678');
  });

  it('refuses a port or method that is not an identifier', async () => {
    await expect(
      withPortSpan({ ...call, method: 'send to +966' }, () => Promise.resolve()),
    ).rejects.toThrow('snake_case');
  });
});
