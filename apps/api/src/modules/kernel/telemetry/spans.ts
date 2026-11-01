import { IncomingMessage } from 'node:http';
import type { Attributes, AttributeValue, Context, Span } from '@opentelemetry/api';
import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { ReadableSpan, Span as SdkSpan, SpanProcessor } from '@opentelemetry/sdk-trace';
import { surfaceOf as surfaceOfRoute } from '../auth/surfaces.js';
import { redactText } from './redact.js';

// Spans and their attributes (PLAT-14 plan 2.2; integrations §10; platform §7). The allowlist is
// enforced in code, at export: whatever an instrumentation or a caller set, only the keys below
// leave the process, string values through the redactor. A request span never carries a path
// parameter value, a query string, a header or a body.

export const tracerName = 'elx';

/** The span attributes that may be exported; anything else is dropped (plan 2.2). */
export const spanAttributeAllowlist: ReadonlySet<string> = new Set([
  // the request frame
  'elx.request_id',
  'elx.account.id',
  'elx.surface',
  'elx.operation_id',
  // outbox relay, jobs and consumers
  'elx.outbox.row_id',
  'elx.outbox.kind',
  'elx.outbox.result',
  'elx.outbox.attempt',
  'elx.correlation_id',
  'elx.event_type',
  'elx.consumer',
  'elx.relay.selected',
  'elx.relay.relayed',
  'elx.relay.held',
  'elx.job',
  // port calls (integrations §10)
  'integration.port',
  'integration.method',
  'integration.provider',
  'integration.outcome',
  'integration.attempt',
  // HTTP, both semantic-convention generations: method, status, route template, protocol
  'http.request.method',
  'http.method',
  'http.response.status_code',
  'http.status_code',
  'http.route',
  'url.scheme',
  'http.scheme',
  'network.protocol.version',
  'http.flavor',
  'server.address',
  'server.port',
  'net.peer.name',
  'net.peer.port',
  'net.host.port',
  'error.type',
  // Express router and handler layers (the route template)
  'express.name',
  'express.type',
  // Redis commands (name only)
  'db.system',
  'db.system.name',
  'db.operation.name',
]);

/** Event attributes kept on an `exception` event; every other event is dropped. */
const exceptionAttributes: ReadonlySet<string> = new Set([
  'exception.type',
  'exception.message',
  'exception.stacktrace',
]);

function cleanValue(value: AttributeValue | undefined): AttributeValue | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return redactText(value, 1_000);
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? redactText(item, 1_000) : item)) as
      string[] | number[] | boolean[];
  }
  return value;
}

/** `attributes` reduced to `allowed` keys, every string redacted. */
export function allowedAttributes(
  attributes: Attributes,
  allowed: ReadonlySet<string> = spanAttributeAllowlist,
): Attributes {
  const out: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!allowed.has(key)) continue;
    const clean = cleanValue(value);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

/** The exported view of a span: allowed attributes, exception events only, redacted texts. */
export function allowlistedSpan(span: ReadableSpan): ReadableSpan {
  const spanContext = span.spanContext();
  const attributes = allowedAttributes(span.attributes);
  const events = span.events
    .filter((event) => event.name === 'exception')
    .map((event) => ({
      ...event,
      attributes: allowedAttributes(event.attributes ?? {}, exceptionAttributes),
    }));
  const message = span.status.message;
  return {
    name: redactText(span.name, 200),
    kind: span.kind,
    spanContext: () => spanContext,
    ...(span.parentSpanContext === undefined ? {} : { parentSpanContext: span.parentSpanContext }),
    startTime: span.startTime,
    endTime: span.endTime,
    status: {
      code: span.status.code,
      ...(message === undefined ? {} : { message: redactText(message, 500) }),
    },
    attributes,
    links: span.links.map((link) => ({ context: link.context })),
    events,
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount:
      span.droppedAttributesCount +
      Object.keys(span.attributes).length -
      Object.keys(attributes).length,
    droppedEventsCount: span.droppedEventsCount + span.events.length - events.length,
    droppedLinksCount: span.droppedLinksCount,
  };
}

/**
 * Wraps the exporting processor: every ended span reaches it only as `allowlistedSpan`. Export
 * stays the inner processor's (batched, dropped on overflow, never awaited by a request).
 */
export class AllowlistSpanProcessor implements SpanProcessor {
  readonly #inner: SpanProcessor;

  constructor(inner: SpanProcessor) {
    this.#inner = inner;
  }

  onStart(span: SdkSpan, parentContext: Context): void {
    this.#inner.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    try {
      this.#inner.onEnd(allowlistedSpan(span));
    } catch {
      // Telemetry never fails the code it observes.
    }
  }

  forceFlush(): Promise<void> {
    return this.#inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.#inner.shutdown();
  }
}

// ---------------------------------------------------------------- the request span

const requestSpans = new WeakMap<object, Span>();

/** The HTTP instrumentation's `requestHook`: remembers the server span of each request. */
export function rememberServerSpan(span: Span, request: unknown): void {
  if (request instanceof IncomingMessage) requestSpans.set(request, span);
}

/** The route template Express matched (`/v1/platform/outbox/:outbox_id`), never the path. */
export function routeTemplateOf(request: { readonly route?: unknown }): string | undefined {
  const path = (request.route as { path?: unknown } | undefined)?.path;
  return typeof path === 'string' ? path : undefined;
}

/**
 * The HTTP instrumentation's `applyCustomAttributesOnSpan`, right before the server span ends:
 * the surface and route template of the matched route (a refused request has them too) and the
 * span name `<METHOD> <template>`; an unmatched request keeps the bare method as its name.
 */
export function finishServerSpan(span: Span, request: unknown): void {
  if (!(request instanceof IncomingMessage)) return;
  const route = routeTemplateOf(request as IncomingMessage & { route?: unknown });
  if (route === undefined) return;
  span.setAttribute('http.route', route);
  const surface = surfaceOfRoute(route);
  if (surface !== undefined) span.setAttribute('elx.surface', surface);
  span.updateName(`${request.method ?? 'GET'} ${route}`);
}

/** Request attributes the frame sets (plan 2.2). */
export interface RequestAttributes {
  readonly 'elx.request_id'?: string;
  readonly 'elx.account.id'?: string | null;
  readonly 'elx.surface'?: string;
  readonly 'elx.operation_id'?: string;
}

/** Sets attributes on the server span of `request`; a no-op without telemetry. */
export function annotateRequest(request: object, attributes: RequestAttributes): void {
  const span = requestSpans.get(request);
  if (span === undefined) return;
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === 'string') span.setAttribute(key, value);
  }
}

// ---------------------------------------------------------------- spans of jobs and port calls

/** Sets attributes on the active span (inside `withSpan` or a request); skips undefined values. */
export function annotateActiveSpan(attributes: Record<string, AttributeValue | undefined>): void {
  const span = trace.getActiveSpan();
  if (span === undefined) return;
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) span.setAttribute(key, value);
  }
}

export interface SpanOptions {
  readonly kind?: SpanKind;
  /** Start a new trace instead of a child of the active span (a queue job, a relay tick). */
  readonly root?: boolean;
  /** Whether a thrown value counts as an error; `false` for control-flow throws. */
  readonly isError?: (error: unknown) => boolean;
}

/**
 * Runs `fn` inside a span named `name` (a fixed name: values go in attributes). A thrown error
 * ends the span with status ERROR and an `exception` event (redacted at export), then rethrows.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, AttributeValue | undefined>,
  fn: (span: Span) => Promise<T>,
  options: SpanOptions = {},
): Promise<T> {
  const tracer = trace.getTracer(tracerName);
  const parent = options.root === true ? trace.deleteSpan(context.active()) : context.active();
  const span = tracer.startSpan(name, { kind: options.kind ?? SpanKind.INTERNAL }, parent);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) span.setAttribute(key, value);
  }
  try {
    return await context.with(trace.setSpan(parent, span), () => fn(span));
  } catch (error) {
    if (options.isError?.(error) ?? true) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (error instanceof Error) span.recordException(error);
    }
    throw error;
  } finally {
    span.end();
  }
}

/** A span that already happened (`startTime` to now), recorded only when there was work. */
export function recordSpan(
  name: string,
  startTime: Date,
  attributes: Record<string, AttributeValue | undefined>,
): void {
  const span = trace
    .getTracer(tracerName)
    .startSpan(name, { startTime, kind: SpanKind.INTERNAL }, trace.deleteSpan(context.active()));
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) span.setAttribute(key, value);
  }
  span.end();
}
