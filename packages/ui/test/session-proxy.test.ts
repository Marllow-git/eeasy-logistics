// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import {
  contentSecurityPolicy,
  cspViolations,
  newNonce,
  securityHeaders,
} from '../src/session/headers';
import { createSessionProxy, isNavigation, rewriteCookieHeader } from '../src/session/proxy';
import {
  accessTokenExpiry,
  accessTokenStale,
  safeNextPath,
  signInPath,
} from '../src/session/tokens';

// WEB-2 plan 2.2, 2.6, 2.14: the proxy's pure parts (the access cookie's expiry, the `next`
// validator, the CSP) and the proxy itself against a fake API.

const base64Url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
// Assembled from parts: the commit hook's secret scanner flags literal JWTs.
const jwt = (payload: Record<string, unknown>) =>
  [base64Url({ alg: 'HS256', typ: 'at+jwt' }), base64Url(payload), 'c2lnbmF0dXJl'].join('.');
const now = 1_800_000_000;

describe('accessTokenExpiry and accessTokenStale', () => {
  it('reads exp without verifying the signature', () => {
    expect(accessTokenExpiry(jwt({ exp: now + 900, sub: 'u' }))).toBe(now + 900);
  });

  it('gives undefined for anything that is not a compact JWT with a numeric exp', () => {
    for (const value of [
      undefined,
      '',
      'abc',
      'a.b',
      'a.b.c.d',
      `x.${base64Url({ exp: 'soon' })}.y`,
      `x.${base64Url([1])}.y`,
      `x.${Buffer.from('not json').toString('base64url')}.y`,
      `x.%%%.y`,
      `x.${'A'.repeat(5000)}.y`,
    ]) {
      expect(accessTokenExpiry(value), String(value).slice(0, 20)).toBeUndefined();
    }
  });

  it('is stale when missing, unreadable or within the 60 s margin', () => {
    expect(accessTokenStale(undefined, now)).toBe(true);
    expect(accessTokenStale('garbage', now)).toBe(true);
    expect(accessTokenStale(jwt({ exp: now + 60 }), now)).toBe(true);
    expect(accessTokenStale(jwt({ exp: now - 1 }), now)).toBe(true);
    expect(accessTokenStale(jwt({ exp: now + 61 }), now)).toBe(false);
    expect(accessTokenStale(jwt({ exp: now + 1 }), now, 0)).toBe(false);
  });
});

describe('safeNextPath (open redirect, web §3.4)', () => {
  it('keeps a same-origin relative path with its query and fragment', () => {
    expect(safeNextPath('/orders?status=open#top')).toBe('/orders?status=open#top');
    expect(safeNextPath('/')).toBe('/');
    expect(safeNextPath('/a/../b')).toBe('/b');
  });

  it('refuses every way off the origin and the sign-in pages themselves', () => {
    for (const value of [
      null,
      undefined,
      '',
      'orders',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      '/%0d%0aLocation:x\r\n',
      '/\tevil',
      'javascript:alert(1)',
      ' /orders',
      '/sign-in',
      '/sign-in/second-factor',
      `/${'a'.repeat(2048)}`,
    ]) {
      expect(safeNextPath(value), String(value)).toBeUndefined();
    }
  });

  it('builds the sign-in path with a safe next and the reason', () => {
    expect(signInPath('/orders?x=1', 'ended')).toBe('/sign-in?next=%2Forders%3Fx%3D1&reason=ended');
    expect(signInPath('//evil.example')).toBe('/sign-in');
    expect(signInPath('/')).toBe('/sign-in');
  });
});

describe('security headers (web §3.6)', () => {
  it('builds the policy of web §3.6 with the nonce and the storage origin', () => {
    const policy = contentSecurityPolicy({
      nonce: 'bm9uY2U=',
      storageOrigin: 'https://files.example.test',
    });
    expect(policy.split('; ')).toEqual([
      "default-src 'self'",
      "script-src 'self' 'nonce-bm9uY2U=' 'strict-dynamic'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://files.example.test",
      "connect-src 'self' https://files.example.test",
      "worker-src 'self' blob:",
      "font-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      'report-to csp',
    ]);
    expect(contentSecurityPolicy({ nonce: 'n' })).toContain("img-src 'self' data: blob:;");
    expect(contentSecurityPolicy({ nonce: 'n', development: true })).toContain(
      "'strict-dynamic' 'unsafe-eval'",
    );
  });

  it('gives a fresh base64 nonce each time', () => {
    const nonces = new Set(Array.from({ length: 20 }, () => newNonce()));
    expect(nonces.size).toBe(20);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('adds HSTS only when asked and no referrer for recipient pages', () => {
    const plain = securityHeaders({ policy: 'p', hsts: false, noReferrer: false });
    expect(plain).toEqual({
      'Content-Security-Policy': 'p',
      'Reporting-Endpoints': 'csp="/monitoring/csp"',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
    });
    const strict = securityHeaders({ policy: 'p', hsts: true, noReferrer: true });
    expect(strict['Strict-Transport-Security']).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
    expect(strict['Referrer-Policy']).toBe('no-referrer');
  });

  it('reduces a CSP report to directive and blocked origin', () => {
    const reports = JSON.stringify([
      {
        type: 'csp-violation',
        url: 'https://app.example.test/track/secret-token',
        body: {
          documentURL: 'https://app.example.test/track/secret-token',
          effectiveDirective: 'script-src-elem',
          blockedURL: 'https://evil.example/x.js?token=1',
          sample: 'secret',
        },
      },
      { type: 'csp-violation', body: { effectiveDirective: 'style-src', blockedURL: 'inline' } },
      { type: 'deprecation', body: {} },
    ]);
    expect(cspViolations(reports)).toEqual([
      { directive: 'script-src-elem', blockedOrigin: 'https://evil.example' },
      { directive: 'style-src', blockedOrigin: 'inline' },
    ]);
    expect(
      cspViolations(
        JSON.stringify({
          'csp-report': { 'violated-directive': 'img-src https:', 'blocked-uri': 'data:x' },
        }),
      ),
    ).toEqual([{ directive: 'img-src', blockedOrigin: 'other' }]);
    expect(cspViolations('not json')).toEqual([]);
    expect(
      cspViolations(
        JSON.stringify([{ type: 'csp-violation', body: { effectiveDirective: 'X;' } }]),
      ),
    ).toEqual([]);
  });
});

describe('isNavigation and rewriteCookieHeader', () => {
  const request = (headers: Record<string, string>, method = 'GET') =>
    new NextRequest('http://localhost:3001/orders', { method, headers });

  it('counts documents and App Router navigations, never prefetches or writes', () => {
    expect(isNavigation(request({ 'sec-fetch-dest': 'document' }))).toBe(true);
    expect(isNavigation(request({ rsc: '1' }))).toBe(true);
    expect(isNavigation(request({ rsc: '1', 'next-router-prefetch': '1' }))).toBe(false);
    expect(isNavigation(request({ purpose: 'prefetch', 'sec-fetch-dest': 'document' }))).toBe(
      false,
    );
    expect(isNavigation(request({ 'sec-fetch-dest': 'image' }))).toBe(false);
    expect(isNavigation(request({ accept: 'text/html' }))).toBe(true);
    expect(isNavigation(request({ 'sec-fetch-dest': 'document' }, 'POST'))).toBe(false);
  });

  it('replaces the refreshed cookies and drops cleared ones', () => {
    expect(
      rewriteCookieHeader('el_locale=ar; el_staff_at=old; el_staff_rt=old-r', [
        'el_staff_at=new; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax',
        'el_staff_rt=new-r; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax',
      ]),
    ).toBe('el_locale=ar; el_staff_at=new; el_staff_rt=new-r');
    expect(
      rewriteCookieHeader('el_staff_at=old; el_locale=en', [
        'el_staff_at=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
      ]),
    ).toBe('el_locale=en');
    expect(rewriteCookieHeader(null, ['a=1; Path=/'])).toBe('a=1');
  });
});

describe('createSessionProxy (web §3.2)', () => {
  const cookies = { access: 'el_staff_at', refresh: 'el_staff_rt' };
  const rotated = [
    'el_staff_at=fresh; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax',
    'el_staff_rt=fresh-r; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax',
  ];
  const groupOf = (path: string) =>
    path.startsWith('/sign-in') ? 'auth' : path.startsWith('/track/') ? 'recipient' : 'session';

  function setup(answer: () => Response | Promise<Response>) {
    const fetch = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(answer()));
    const proxy = createSessionProxy({
      cookies,
      refreshPath: '/v1/staff/auth/refresh',
      apiInternalUrl: 'http://api.internal:3000',
      publicOrigin: 'http://localhost:3001',
      groupOf,
      suspendedPath: '/account-suspended',
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => now * 1000,
      nonce: () => 'bm9uY2U=',
    });
    return { fetch, proxy };
  }

  const navigate = (path: string, cookie: string, extra: Record<string, string> = {}) =>
    new NextRequest(`http://localhost:3001${path}`, {
      headers: { 'sec-fetch-dest': 'document', cookie, 'user-agent': 'census-agent', ...extra },
    });

  const forwardedCookie = (response: Response) =>
    response.headers.get('x-middleware-request-cookie');

  it('passes a fresh session through with the headers and the nonce for Next.js', async () => {
    const { fetch, proxy } = setup(() => new Response(null, { status: 204 }));
    const response = await proxy(
      navigate('/orders', `el_staff_at=${jwt({ exp: now + 600 })}; el_staff_rt=r`),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(response.headers.get('content-security-policy')).toContain("'nonce-bm9uY2U='");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe('bm9uY2U=');
    expect(response.headers.get('x-middleware-request-x-el-path')).toBe('/orders');
    expect(response.headers.get('x-middleware-request-content-security-policy')).toContain(
      "'nonce-bm9uY2U='",
    );
  });

  it('refreshes a stale access cookie once and forwards the new cookies both ways', async () => {
    const { fetch, proxy } = setup(() => {
      const headers = new Headers();
      for (const line of rotated) headers.append('Set-Cookie', line);
      return new Response(null, { status: 204, headers });
    });
    const response = await proxy(
      navigate(
        '/orders?x=1',
        `el_locale=ar; el_staff_at=${jwt({ exp: now + 30 })}; el_staff_rt=old-r`,
      ),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://api.internal:3000/v1/staff/auth/refresh');
    const sent = new Headers(init?.headers);
    expect(init?.method).toBe('POST');
    expect(sent.get('cookie')).toBe('el_staff_rt=old-r');
    expect(sent.get('x-el-client')).toBe('web');
    expect(sent.get('origin')).toBe('http://localhost:3001');
    expect(sent.get('user-agent')).toBe('census-agent');
    expect(response.headers.getSetCookie()).toEqual(rotated);
    expect(response.headers.get('x-middleware-request-cookie')).toBe(
      'el_locale=ar; el_staff_at=fresh; el_staff_rt=fresh-r',
    );
    expect(response.headers.get('location')).toBeNull();
  });

  it('refreshes a missing access cookie when the refresh cookie is there', async () => {
    const { fetch, proxy } = setup(() => new Response(null, { status: 204 }));
    await proxy(navigate('/', 'el_staff_rt=r'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sends a refused refresh to sign-in with next and the cleared cookies', async () => {
    const cleared = 'el_staff_at=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';
    const { proxy } = setup(
      () =>
        new Response(JSON.stringify({ code: 'token_invalid', message: 'x' }), {
          status: 401,
          headers: { 'Set-Cookie': cleared, 'Content-Type': 'application/json' },
        }),
    );
    const response = await proxy(navigate('/orders?x=1', 'el_staff_rt=r'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3001/sign-in?next=%2Forders%3Fx%3D1&reason=ended',
    );
    expect(response.headers.getSetCookie()).toEqual([cleared]);
    expect(response.headers.get('content-security-policy')).not.toBeNull();
  });

  it('sends a suspended account to the notice', async () => {
    const { proxy } = setup(
      () =>
        new Response(JSON.stringify({ code: 'account_suspended', message: 'x' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const response = await proxy(navigate('/orders', 'el_staff_rt=r'));
    expect(response.headers.get('location')).toBe('http://localhost:3001/account-suspended');
  });

  it('passes through when the API cannot be reached or rate-limits', async () => {
    for (const answer of [
      () => Promise.reject(new TypeError('fetch failed')),
      () => new Response('{}', { status: 429 }),
      () => new Response('{"code":"forbidden"}', { status: 403 }),
    ]) {
      const { proxy } = setup(answer);
      const response = await proxy(navigate('/orders', 'el_staff_rt=r'));
      expect(response.headers.get('location')).toBeNull();
      expect(forwardedCookie(response)).toBe('el_staff_rt=r');
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });

  it('never refreshes without a refresh cookie, on a prefetch, on auth or recipient pages', async () => {
    const { fetch, proxy } = setup(() => new Response(null, { status: 204 }));
    await proxy(navigate('/orders', ''));
    await proxy(navigate('/orders', 'el_staff_rt=r', { 'next-router-prefetch': '1' }));
    await proxy(navigate('/sign-in', 'el_staff_rt=r'));
    const recipient = await proxy(navigate('/track/abc', 'el_staff_rt=r'));
    expect(fetch).not.toHaveBeenCalled();
    expect(recipient.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('sends a signed-in user from /sign-in to a safe next, and clears cookies after an ended session', async () => {
    const { proxy } = setup(() => new Response(null, { status: 204 }));
    const live = `el_staff_at=${jwt({ exp: now + 600 })}`;
    expect((await proxy(navigate('/sign-in?next=%2Forders', live))).headers.get('location')).toBe(
      'http://localhost:3001/orders',
    );
    expect(
      (await proxy(navigate('/sign-in?next=%2F%2Fevil.example', live))).headers.get('location'),
    ).toBe('http://localhost:3001/');
    const ended = await proxy(navigate('/sign-in?reason=ended', live));
    expect(ended.headers.get('location')).toBeNull();
    expect(ended.headers.getSetCookie()).toEqual([
      'el_staff_at=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
      'el_staff_rt=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
    ]);
    const expired = await proxy(navigate('/sign-in', `el_staff_at=${jwt({ exp: now - 5 })}`));
    expect(expired.headers.get('location')).toBeNull();
  });
});
