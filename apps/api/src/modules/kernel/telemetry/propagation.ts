import type { Context, TextMapGetter, TextMapPropagator, TextMapSetter } from '@opentelemetry/api';
import { core } from '@opentelemetry/sdk-node';
import { surfaceOf } from '../auth/surfaces.js';

// Trace context across the edge (PLAT-14 plan 2.1; adversary A-6). A caller's `traceparent` is
// honoured only for a request that came through the trusted ingress (Cloudflare: `trust proxy`
// hops above 0) on a surface our own clients call (staff, platform, driver); a public or recipient
// request, or any request when no proxy is trusted, starts a new trace, so a stranger can neither
// join nor seed our traces. Outbound, `tracestate` is never sent.

/** The surfaces whose callers may continue a trace. */
const trustedSurfaces: ReadonlySet<string> = new Set(['staff', 'platform', 'driver']);

/** The incoming request a header object belongs to, recorded before extraction. */
const requestsByHeaders = new WeakMap<object, { readonly url?: string }>();

/** The HTTP instrumentation's `ignoreIncomingRequestHook` calls this before it extracts context. */
export function rememberIncoming(request: {
  readonly url?: string;
  readonly headers: object;
}): void {
  requestsByHeaders.set(request.headers, request);
}

/** Whether `request` may continue a caller's trace. */
export function isTrustedIngress(
  request: { readonly url?: string },
  trustProxyHops: number,
): boolean {
  if (trustProxyHops <= 0) return false;
  const path = (request.url ?? '').split(/[?#]/, 1)[0]?.toLowerCase() ?? '';
  const surface = surfaceOf(path);
  return surface !== undefined && trustedSurfaces.has(surface);
}

export class IngressTraceContextPropagator implements TextMapPropagator {
  readonly #w3c = new core.W3CTraceContextPropagator();

  constructor(private readonly trustProxyHops: number) {}

  inject(context: Context, carrier: unknown, setter: TextMapSetter): void {
    this.#w3c.inject(context, carrier, {
      set: (target, key, value) => {
        if (key.toLowerCase() !== 'tracestate') setter.set(target, key, value);
      },
    });
  }

  extract(context: Context, carrier: unknown, getter: TextMapGetter): Context {
    const request =
      typeof carrier === 'object' && carrier !== null ? requestsByHeaders.get(carrier) : undefined;
    if (request === undefined || !isTrustedIngress(request, this.trustProxyHops)) return context;
    return this.#w3c.extract(context, carrier, getter);
  }

  fields(): string[] {
    return ['traceparent'];
  }
}
