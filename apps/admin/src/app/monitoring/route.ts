import { filterSentryEnvelope, maxEnvelopeBytes } from '@eeasy-logistics/ui/observability';
import { observabilityConfig } from '../../observability/settings';

// The Sentry tunnel (web §10.4, PLAT-14 plan 2.7): the browser SDK posts its envelopes here, on
// the app's own origin, so the CSP keeps connect-src 'self'. Only envelopes addressed to the
// configured DSN are forwarded (not an open proxy), only error events, each scrubbed again; the
// browser's cookies, headers and address are not passed on. Best effort: Sentry being down never
// fails a page.

const upstreamTimeoutMs = 5000;

export async function POST(request: Request): Promise<Response> {
  const dsn = observabilityConfig()?.sentryDsn;
  if (dsn === undefined) return new Response(null, { status: 204 });
  if (Number(request.headers.get('content-length') ?? 0) > maxEnvelopeBytes) {
    return new Response(null, { status: 413 });
  }
  const decision = filterSentryEnvelope(new Uint8Array(await request.arrayBuffer()), dsn);
  if (decision.kind === 'reject') return new Response(null, { status: decision.status });
  if (decision.kind === 'drop') return new Response(null, { status: 204 });
  try {
    const upstream = await fetch(decision.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: decision.body,
      signal: AbortSignal.timeout(upstreamTimeoutMs),
    });
    return new Response(null, { status: upstream.ok ? 200 : 502 });
  } catch {
    return new Response(null, { status: 502 });
  }
}
