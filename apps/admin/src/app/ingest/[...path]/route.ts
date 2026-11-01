import { observabilityConfig } from '../../../observability/settings';

// The PostHog proxy (web §10.4, PLAT-14 plan 2.8): posthog-js posts its event batches here, on
// the app's own origin, so the CSP keeps connect-src 'self'. Only the capture endpoints are
// forwarded (not an open proxy to PostHog's API), with the body and the SDK's own query
// parameters; the browser's cookies, address, user agent and any credential other than the
// project key are not passed on. Best effort: PostHog being down never fails a page.

/** The capture endpoints posthog-js uses; flags, decide, recordings and surveys are off. */
const capturePaths = new Set(['e', 'i/v0/e', 'batch', 'capture']);

/** Query parameters posthog-js sends that PostHog reads (compression, SDK version, cache buster). */
const forwardedQuery = ['compression', 'ver', '_'];

const maxBodyBytes = 512 * 1024;
const upstreamTimeoutMs = 5000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const config = observabilityConfig();
  if (config?.posthogKey === undefined) return new Response(null, { status: 204 });
  const path = (await params).path.join('/');
  if (!capturePaths.has(path)) return new Response(null, { status: 404 });
  if (Number(request.headers.get('content-length') ?? 0) > maxBodyBytes) {
    return new Response(null, { status: 413 });
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > maxBodyBytes) return new Response(null, { status: 413 });

  const target = new URL(`/${path}/`, config.posthogHost);
  const query = new URL(request.url).searchParams;
  for (const name of forwardedQuery) {
    const value = query.get(name);
    if (value !== null) target.searchParams.set(name, value);
  }
  const headers = new Headers({
    'Content-Type': request.headers.get('content-type') ?? 'text/plain',
  });
  // Capture v1 authenticates with the project key (public, in the bundle); nothing else passes.
  if (request.headers.get('authorization') === `Bearer ${config.posthogKey}`) {
    headers.set('Authorization', `Bearer ${config.posthogKey}`);
  }
  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(upstreamTimeoutMs),
    });
    // posthog-js reads a JSON status; PostHog's own answer is not passed back.
    return upstream.ok ? Response.json({ status: 1 }) : new Response(null, { status: 502 });
  } catch {
    return new Response(null, { status: 502 });
  }
}
