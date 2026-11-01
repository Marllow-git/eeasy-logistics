import {
  filterSentryEnvelope,
  maxEnvelopeBytes,
  readCappedBody,
} from '@eeasy-logistics/ui/observability';
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
  // The cap holds while reading: no length 411, over 256 kB 413 (adversary W-1).
  const read = await readCappedBody(request, maxEnvelopeBytes);
  if (!read.ok) return new Response(null, { status: read.status });
  const decision = filterSentryEnvelope(read.body, dsn);
  if (decision.kind === 'reject') return new Response(null, { status: decision.status });
  if (decision.kind === 'drop') return new Response(null, { status: 204 });
  try {
    const upstream = await fetch(decision.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: decision.body,
      signal: AbortSignal.timeout(upstreamTimeoutMs),
    });
    // Sentry's rate limits reach the browser SDK, so it backs off (adversary W-2); a per-IP rule
    // for this route belongs to the edge (OPS-1).
    const headers = new Headers();
    for (const name of ['X-Sentry-Rate-Limits', 'Retry-After']) {
      const value = upstream.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const status = upstream.ok ? 200 : upstream.status === 429 ? 429 : 502;
    return new Response(null, { status, headers });
  } catch {
    return new Response(null, { status: 502 });
  }
}
