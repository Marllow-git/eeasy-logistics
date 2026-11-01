import type { Context } from '@opentelemetry/api';
import {
  defaultTextMapGetter,
  defaultTextMapSetter,
  ROOT_CONTEXT,
  trace,
} from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import {
  IngressTraceContextPropagator,
  isTrustedIngress,
  rememberIncoming,
} from './propagation.js';

// PLAT-14 adversary A-6: a caller's trace context only through the trusted ingress, on our own
// clients' surfaces; no tracestate sent out.

const foreignTrace = '0af7651916cd43dd8448eb211c80319c';
const traceparent = `00-${foreignTrace}-b7ad6b7169203331-01`;

function extracted(url: string, hops: number): Context {
  const headers = { traceparent, tracestate: 'vendor=x' };
  rememberIncoming({ url, headers });
  return new IngressTraceContextPropagator(hops).extract(
    ROOT_CONTEXT,
    headers,
    defaultTextMapGetter,
  );
}

const traceIdOf = (context: Context) => trace.getSpanContext(context)?.traceId;

describe('IngressTraceContextPropagator', () => {
  it('continues a staff, platform or driver trace that came through the trusted ingress', () => {
    for (const url of ['/v1/staff/orders', '/v1/platform/accounts?x=1', '/v1/driver/me']) {
      expect(traceIdOf(extracted(url, 1)), url).toBe(foreignTrace);
    }
  });

  it('starts a new trace for a public or recipient request, or anything off a surface', () => {
    for (const url of ['/v1/public/track', '/v1/recipient/tracking/x', '/ready', '/V1/PUBLIC/x']) {
      expect(traceIdOf(extracted(url, 1)), url).toBeUndefined();
    }
  });

  it('starts a new trace for every request when no proxy is trusted', () => {
    expect(traceIdOf(extracted('/v1/staff/orders', 0))).toBeUndefined();
  });

  it('extracts nothing from a carrier that is not a remembered request', () => {
    const context = new IngressTraceContextPropagator(1).extract(
      ROOT_CONTEXT,
      { traceparent },
      defaultTextMapGetter,
    );
    expect(traceIdOf(context)).toBeUndefined();
  });

  it('injects traceparent but never tracestate', () => {
    const headers = { traceparent, tracestate: 'vendor=x' };
    rememberIncoming({ url: '/v1/staff/orders', headers });
    const propagator = new IngressTraceContextPropagator(1);
    const context = propagator.extract(ROOT_CONTEXT, headers, defaultTextMapGetter);
    const out: Record<string, string> = {};
    propagator.inject(context, out, defaultTextMapSetter);
    expect(Object.keys(out)).toEqual(['traceparent']);
    expect(out.traceparent).toContain(foreignTrace);
  });

  it('reads the surface from the lowercased path only', () => {
    expect(isTrustedIngress({ url: '/v1/staff/x' }, 1)).toBe(true);
    expect(isTrustedIngress({ url: '/x?next=/v1/staff/y' }, 1)).toBe(false);
  });
});
