import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, newNonce, securityHeaders } from './headers';
import { accessTokenStale, safeNextPath, signInPath } from './tokens';

// The request proxy of both web applications (web §3.2, §3.6; ADR-0032, ADR-0038; WEB-2 plan 2.2,
// 2.6): every matched response gets the security headers with a fresh nonce, which reaches Next.js
// through the request's `Content-Security-Policy` and `x-nonce` headers so the framework scripts
// carry it; a navigation under the signed-in group with a missing or nearly expired access cookie
// is refreshed over the internal network before the server components run, and they see the new
// access token in the rewritten `Cookie` header. Each app's `src/proxy.ts` passes its surface.

/** Which kind of route a path belongs to; each app maps its route groups onto these. */
export type ProxyGroup = 'session' | 'auth' | 'recipient' | 'other';

export interface SessionProxyOptions {
  /** The surface's cookie names (PLAT-11 plan 2.5). */
  readonly cookies: { readonly access: string; readonly refresh: string };
  /** The refresh operation's path (`refreshSession` or `platformRefresh`). */
  readonly refreshPath: string;
  /** `API_INTERNAL_URL`; without it no refresh is tried. */
  readonly apiInternalUrl: string | undefined;
  /** This app's public origin, the `Origin` the API's web client marker expects. */
  readonly publicOrigin: string | undefined;
  readonly groupOf: (pathname: string) => ProxyGroup;
  /** Where a suspended account lands (a full-page notice in the auth group). */
  readonly suspendedPath: string;
  readonly storageOrigin?: string | undefined;
  readonly development?: boolean;
  readonly hsts?: boolean;
  /** Test seams. */
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly nonce?: () => string;
}

const refreshTimeoutMs = 5000;

type Refresh =
  | { readonly kind: 'rotated'; readonly cookies: readonly string[] }
  | { readonly kind: 'ended'; readonly cookies: readonly string[] }
  | { readonly kind: 'suspended'; readonly cookies: readonly string[] }
  | { readonly kind: 'unavailable' };

/** A navigation the user asked for: a document load or an App Router navigation, never a prefetch. */
export function isNavigation(request: Pick<NextRequest, 'method' | 'headers'>): boolean {
  if (request.method !== 'GET') return false;
  const headers = request.headers;
  if (headers.has('next-router-prefetch') || headers.get('purpose') === 'prefetch') return false;
  if (headers.has('rsc')) return true;
  const destination = headers.get('sec-fetch-dest');
  if (destination !== null) return destination === 'document';
  return (headers.get('accept') ?? '').includes('text/html');
}

/** `name=value` pairs of `Set-Cookie` lines; a cleared cookie (`Max-Age=0`) maps to undefined. */
function cookieUpdates(setCookies: readonly string[]): Map<string, string | undefined> {
  const updates = new Map<string, string | undefined>();
  for (const line of setCookies) {
    const [pair = '', ...attributes] = line.split(';');
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    const cleared =
      value === '' || attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
    updates.set(name, cleared ? undefined : value);
  }
  return updates;
}

/** The request's `Cookie` header with the refreshed values, so this request's pages see them. */
export function rewriteCookieHeader(header: string | null, setCookies: readonly string[]): string {
  const updates = cookieUpdates(setCookies);
  const kept = (header ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !updates.has(part.slice(0, part.indexOf('=')).trim()));
  for (const [name, value] of updates) if (value !== undefined) kept.push(`${name}=${value}`);
  return kept.join('; ');
}

/** `Set-Cookie` values that clear the surface's cookies with the API's own attributes. */
function clearedCookies(cookies: SessionProxyOptions['cookies']): string[] {
  return [cookies.access, cookies.refresh].map(
    (name) => `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  );
}

async function refreshOnce(
  request: NextRequest,
  options: SessionProxyOptions,
  refreshToken: string,
): Promise<Refresh> {
  if (options.apiInternalUrl === undefined || options.publicOrigin === undefined) {
    return { kind: 'unavailable' };
  }
  const doFetch = options.fetch ?? globalThis.fetch;
  const headers = new Headers({
    Cookie: `${options.cookies.refresh}=${refreshToken}`,
    'X-EL-Client': 'web',
    Origin: options.publicOrigin,
    'X-Request-Id': request.headers.get('x-request-id') ?? crypto.randomUUID(),
  });
  // The API's 30 s reuse grace compares the user agent (PLAT-11 plan 2.6); the address is the
  // client's as the edge reported it.
  for (const name of ['user-agent', 'x-forwarded-for', 'accept-language']) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  let response: Response;
  try {
    response = await doFetch(`${options.apiInternalUrl}${options.refreshPath}`, {
      method: 'POST',
      headers,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(refreshTimeoutMs),
    });
  } catch {
    return { kind: 'unavailable' };
  }
  const cookies = response.headers.getSetCookie();
  if (response.status === 204 || response.status === 200) return { kind: 'rotated', cookies };
  if (response.status === 401) return { kind: 'ended', cookies };
  if (response.status === 403) {
    const body = (await response.json().catch(() => undefined)) as { code?: unknown } | undefined;
    if (body?.code === 'account_suspended') return { kind: 'suspended', cookies };
  }
  // A rate limit, a refused marker (a misconfigured origin) or a server error: the page's own call
  // shows what went wrong.
  return { kind: 'unavailable' };
}

function redirectTo(request: NextRequest, path: string, setCookies: readonly string[]) {
  const response = NextResponse.redirect(new URL(path, request.nextUrl.origin));
  for (const line of setCookies) response.headers.append('Set-Cookie', line);
  return response;
}

/** Builds the `proxy()` of one application. */
export function createSessionProxy(options: SessionProxyOptions) {
  return async function proxy(request: NextRequest): Promise<NextResponse> {
    const nonce = (options.nonce ?? newNonce)();
    const policy = contentSecurityPolicy({
      nonce,
      storageOrigin: options.storageOrigin,
      development: options.development,
    });
    const { pathname, search, searchParams } = request.nextUrl;
    const group = options.groupOf(pathname);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('content-security-policy', policy);
    const finish = (response: NextResponse) => {
      const headers = securityHeaders({
        policy,
        hsts: options.hsts ?? false,
        noReferrer: group === 'recipient',
      });
      for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
      return response;
    };
    const pass = (setCookies: readonly string[] = []) => {
      const response = NextResponse.next({ request: { headers: requestHeaders } });
      for (const line of setCookies) response.headers.append('Set-Cookie', line);
      return finish(response);
    };

    if (!isNavigation(request)) return pass();
    const access = request.cookies.get(options.cookies.access)?.value || undefined;
    const refreshToken = request.cookies.get(options.cookies.refresh)?.value || undefined;
    const now = Math.floor((options.now ?? Date.now)() / 1000);
    const here = `${pathname}${search}`;

    // Without a refresh cookie there is nothing to renew: the layout's session read answers 401 and
    // sends the user to sign-in (plan 2.3).
    if (group === 'session' && refreshToken !== undefined && accessTokenStale(access, now)) {
      const refreshed = await refreshOnce(request, options, refreshToken);
      switch (refreshed.kind) {
        case 'rotated':
          requestHeaders.set(
            'cookie',
            rewriteCookieHeader(request.headers.get('cookie'), refreshed.cookies),
          );
          return pass(refreshed.cookies);
        case 'ended':
          return finish(redirectTo(request, signInPath(here, 'ended'), refreshed.cookies));
        case 'suspended':
          return finish(redirectTo(request, options.suspendedPath, refreshed.cookies));
        case 'unavailable':
          return pass();
      }
    }

    if (group === 'auth' && pathname === '/sign-in') {
      // The session ended (a refused refresh, or a page whose session read failed): the cookies go,
      // so a token the API no longer accepts cannot send the user back and forth.
      if (searchParams.get('reason') === 'ended') return pass(clearedCookies(options.cookies));
      if (!accessTokenStale(access, now, 0)) {
        return finish(redirectTo(request, safeNextPath(searchParams.get('next')) ?? '/', []));
      }
    }
    return pass();
  };
}
