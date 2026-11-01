import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import type { Config } from '@eeasy-logistics/config';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import type { Instrumentation } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation, ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import type { Resource } from '@opentelemetry/resources';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import type { LogRecordExporter, LogRecordProcessor } from '@opentelemetry/sdk-logs';
import { BatchLogRecordProcessor, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import type { IMetricReader, ViewOptions } from '@opentelemetry/sdk-metrics';
import { AggregationType, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { core, NodeSDK } from '@opentelemetry/sdk-node';
import type { Sampler, SpanExporter, SpanProcessor } from '@opentelemetry/sdk-trace';
import { AllowlistSpanProcessor, finishServerSpan, rememberServerSpan } from './spans.js';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace';

// OpenTelemetry for the api and worker roles (PLAT-14 plan 2.1; platform §7). main.ts starts it
// after the configuration and before it loads the Nest graph; the migrate role never imports
// this file (dependency-cruiser `migrate-job-loads-no-application`, `main-loads-telemetry-lazily`).
// Export is best-effort: batch processors drop on overflow and never make a request wait; without
// `OTEL_EXPORTER_OTLP_ENDPOINT` every signal goes to a no-op sink and the process runs unchanged.

export type TelemetryRole = 'api' | 'worker';

/** `service.name` per process role. */
export const serviceNames: Readonly<Record<TelemetryRole, string>> = {
  api: 'elx-api',
  worker: 'elx-worker',
};

/** Modules the ESM loader hook wraps; everything else loads untouched (import-in-the-middle). */
export const hookedModules: readonly string[] = [
  'ioredis',
  'express',
  'http',
  'https',
  'node:http',
  'node:https',
];

/** Metric export period; the outbox gauges are refreshed every 30 s as well (plan 2.3). */
export const metricExportIntervalMs = 30_000;

/** Overrides for tests: in-memory exporters and readers, no loader hook. */
export interface TelemetryOptions {
  readonly spanExporter?: SpanExporter;
  readonly metricReader?: IMetricReader;
  readonly logExporter?: LogRecordExporter;
  /** Register the ESM loader hook (main.ts only; tests and in-process callers leave it off). */
  readonly loaderHook?: boolean;
}

export interface TelemetryHandle {
  readonly service: string;
  readonly resource: Resource;
  /** Flushes and stops every provider; never throws. */
  shutdown(): Promise<void>;
}

/** The resource every signal carries: service, release and environment (plan 2.1). */
export function telemetryResource(config: Config, role: TelemetryRole): Resource {
  return defaultResource().merge(
    resourceFromAttributes({
      'service.name': serviceNames[role],
      'service.version': config.observability.release,
      'service.instance.id': randomUUID(),
      'deployment.environment.name': config.app.env,
      // The pre-1.27 key, still what many backends group by.
      'deployment.environment': config.app.env,
    }),
  );
}

/**
 * Parent-based sampling with the configured ratio at the root. A remote parent (a caller's
 * `traceparent`) is sampled by the same ratio, never by its flag: a client on the internet cannot
 * force or suppress sampling. A local parent's decision is kept, so a trace is whole or absent.
 */
export function samplerFor(config: Config): Sampler {
  const ratio = new TraceIdRatioBasedSampler(config.observability.traceSampleRatio);
  return new ParentBasedSampler({
    root: ratio,
    remoteParentSampled: ratio,
    remoteParentNotSampled: ratio,
  });
}

/** A sink for the case without an endpoint: the SDK still mints trace ids for the log lines. */
export const noopSpanExporter: SpanExporter = {
  export: (_spans, done) => done({ code: core.ExportResultCode.SUCCESS }),
  shutdown: () => Promise.resolve(),
};

/** `<endpoint>/v1/<signal>`: the base URL semantics of `OTEL_EXPORTER_OTLP_ENDPOINT`. */
export function signalUrl(endpoint: string, signal: 'traces' | 'metrics' | 'logs'): string {
  return new URL(`v1/${signal}`, endpoint.endsWith('/') ? endpoint : `${endpoint}/`).toString();
}

/** The instrumentation set (plan 2.1; §8.1 records why there is none for postgres.js or BullMQ). */
export function instrumentations(): Instrumentation[] {
  return [
    new HttpInstrumentation({
      // Liveness probes every few seconds are noise; `/ready` is kept.
      ignoreIncomingRequestHook: (request) => request.url === '/health',
      // An outbound call is traced only inside a request, job or port span.
      requireParentforOutgoingSpans: true,
      // No header is ever recorded (plan 2.2); the allowlist would drop them anyway.
      headersToSpanAttributes: { client: {}, server: {} },
      // The request frame annotates the server span of each request (request id, surface, ...).
      requestHook: rememberServerSpan,
      // Surface, route template and span name, right before the server span ends.
      applyCustomAttributesOnSpan: (span, request) => finishServerSpan(span, request),
    }),
    // Router and handler spans only: they carry the route template, never a path value.
    new ExpressInstrumentation({ ignoreLayersType: [ExpressLayerType.MIDDLEWARE] }),
    // Commands inside a request or job only (relay polls and lock renewals would flood), and the
    // command name alone: rate-limit keys hold user ids and client addresses.
    new IORedisInstrumentation({
      requireParentSpan: true,
      dbStatementSerializer: (command) => command,
    }),
  ];
}

/**
 * The instrumentations' own HTTP metrics are dropped: `http_request_duration_ms` (plan 2.3) is
 * recorded by the request middleware with the route template only.
 */
export const droppedInstrumentMetrics: ViewOptions[] = [
  'http.server.duration',
  'http.client.duration',
  'http.server.request.duration',
  'http.client.request.duration',
].map((instrumentName) => ({ instrumentName, aggregation: { type: AggregationType.DROP } }));

let active: TelemetryHandle | undefined;

/** The running telemetry, if started. */
export function activeTelemetry(): TelemetryHandle | undefined {
  return active;
}

/**
 * Starts the SDK for `role` and registers it with the OpenTelemetry API. A failure to start is
 * written to stderr and the process continues without telemetry: it is never a reason not to serve.
 */
export function startTelemetry(
  config: Config,
  role: TelemetryRole,
  options: TelemetryOptions = {},
): TelemetryHandle | undefined {
  try {
    if (options.loaderHook === true) {
      // Before any instrumented module is imported (main.ts loads Nest and ioredis after this).
      register('@opentelemetry/instrumentation/hook.mjs', import.meta.url, {
        data: { include: hookedModules },
      });
    }
    const endpoint = config.observability.otlpEndpoint;
    const spanProcessor: SpanProcessor =
      options.spanExporter !== undefined
        ? new SimpleSpanProcessor({ exporter: options.spanExporter })
        : endpoint !== undefined
          ? new BatchSpanProcessor({
              exporter: new OTLPTraceExporter({ url: signalUrl(endpoint, 'traces') }),
            })
          : new SimpleSpanProcessor({ exporter: noopSpanExporter });
    const metricReaders: IMetricReader[] =
      options.metricReader !== undefined
        ? [options.metricReader]
        : endpoint !== undefined
          ? [
              new PeriodicExportingMetricReader({
                exporter: new OTLPMetricExporter({ url: signalUrl(endpoint, 'metrics') }),
                exportIntervalMillis: metricExportIntervalMs,
              }),
            ]
          : [];
    const logRecordProcessors: LogRecordProcessor[] =
      options.logExporter !== undefined
        ? [new SimpleLogRecordProcessor({ exporter: options.logExporter })]
        : endpoint !== undefined
          ? [
              new BatchLogRecordProcessor({
                exporter: new OTLPLogExporter({ url: signalUrl(endpoint, 'logs') }),
              }),
            ]
          : [];
    const resource = telemetryResource(config, role);
    const sdk = new NodeSDK({
      resource,
      // Every setting comes from packages/config; nothing is detected from the environment.
      autoDetectResources: false,
      sampler: samplerFor(config),
      // Every span reaches the exporter through the attribute allowlist (plan 2.2).
      spanProcessors: [new AllowlistSpanProcessor(spanProcessor)],
      metricReaders,
      views: droppedInstrumentMetrics,
      logRecordProcessors,
      // W3C trace context only: no baggage is read from callers or sent to providers.
      textMapPropagator: new core.W3CTraceContextPropagator(),
      instrumentations: instrumentations(),
    });
    sdk.start();
    const handle: TelemetryHandle = {
      service: serviceNames[role],
      resource,
      shutdown: async () => {
        if (active === handle) active = undefined;
        await sdk.shutdown().catch(() => undefined);
      },
    };
    active = handle;
    return handle;
  } catch (error) {
    process.stderr.write(
      `Telemetry not started (${error instanceof Error ? error.name : 'unknown error'}); ` +
        'continuing without it\n',
    );
    return undefined;
  }
}

/** Flushes and stops the running telemetry within `timeoutMs`; for the shutdown hooks. */
export async function shutdownTelemetry(timeoutMs = 5_000): Promise<void> {
  const handle = active;
  if (handle === undefined) return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    handle.shutdown(),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
}
