import { defineConfig } from '@eeasy-logistics/config';
import { ROOT_CONTEXT, SpanKind, trace, TraceFlags } from '@opentelemetry/api';
import { InMemorySpanExporter, SamplingDecision } from '@opentelemetry/sdk-trace';
import { afterAll, describe, expect, it } from 'vitest';
import { samplerFor, signalUrl, startTelemetry, telemetryResource } from './sdk.js';

// PLAT-14 item A (plan 2.1): the SDK bootstrap, through the in-memory exporter.

const release = 'sha-0123456789abcdef0123456789abcdef01234567';

describe('startTelemetry', () => {
  const exporter = new InMemorySpanExporter();
  const handle = startTelemetry(defineConfig({ APP_ENV: 'ci', ELX_RELEASE: release }), 'worker', {
    spanExporter: exporter,
  });
  afterAll(() => handle?.shutdown());

  it('exports spans carrying service name, version (the release) and environment', () => {
    expect(handle?.service).toBe('elx-worker');
    trace.getTracer('test').startSpan('probe').end();
    const [span] = exporter.getFinishedSpans();
    expect(span?.name).toBe('probe');
    expect(span?.resource.attributes).toMatchObject({
      'service.name': 'elx-worker',
      'service.version': release,
      'deployment.environment.name': 'ci',
      'deployment.environment': 'ci',
    });
  });

  it('detects nothing from the host or the environment (autoDetectResources off)', () => {
    const keys = Object.keys(handle?.resource.attributes ?? {});
    expect(keys.filter((key) => /^(host|process|os|container)\./.test(key))).toEqual([]);
  });
});

describe('telemetryResource', () => {
  it('names the api and defaults the release to dev', () => {
    const resource = telemetryResource(defineConfig({ APP_ENV: 'local' }), 'api');
    expect(resource.attributes).toMatchObject({
      'service.name': 'elx-api',
      'service.version': 'dev',
      'deployment.environment.name': 'local',
    });
  });
});

describe('samplerFor', () => {
  const traceId = 'ffffffffffffffffffffffffffffffff'; // above every ratio threshold below 1
  const sample = (env: Record<string, string>, parent: 'none' | 'remote-sampled' | 'local') => {
    let ctx = ROOT_CONTEXT;
    if (parent !== 'none') {
      ctx = trace.setSpanContext(ctx, {
        traceId,
        spanId: 'aaaaaaaaaaaaaaaa',
        traceFlags: TraceFlags.SAMPLED,
        isRemote: parent === 'remote-sampled',
      });
    }
    return samplerFor(defineConfig({ APP_ENV: 'local', ...env })).shouldSample(
      ctx,
      traceId,
      'GET',
      SpanKind.SERVER,
      {},
      [],
    ).decision;
  };

  it('samples every root at the default ratio outside production', () => {
    expect(sample({}, 'none')).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  it('applies the ratio to a root span', () => {
    expect(sample({ OTEL_TRACES_SAMPLER_ARG: '0' }, 'none')).toBe(SamplingDecision.NOT_RECORD);
  });

  it('never lets a remote caller force sampling with its traceparent flag', () => {
    expect(sample({ OTEL_TRACES_SAMPLER_ARG: '0' }, 'remote-sampled')).toBe(
      SamplingDecision.NOT_RECORD,
    );
  });

  it('keeps a local parent decision (a trace is whole)', () => {
    expect(sample({ OTEL_TRACES_SAMPLER_ARG: '0' }, 'local')).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
  });

  it('names the configured ratio (0.1 is the production default, packages/config)', () => {
    const config = defineConfig({ APP_ENV: 'local', OTEL_TRACES_SAMPLER_ARG: '0.1' });
    expect(samplerFor(config).toString()).toContain('root=TraceIdRatioBased{0.1}');
  });
});

describe('signalUrl', () => {
  it('appends the signal path to the base endpoint, with or without a trailing slash', () => {
    expect(signalUrl('https://otel.example.test', 'traces')).toBe(
      'https://otel.example.test/v1/traces',
    );
    expect(signalUrl('https://otel.example.test/base/', 'metrics')).toBe(
      'https://otel.example.test/base/v1/metrics',
    );
  });
});
