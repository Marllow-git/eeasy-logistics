// The browser's session fetcher (WEB-2 plan 2.4, web §3.2): MSW plays the API with a cookie it
// rotates on refresh. Two concurrent `401 token_expired` cause one refresh (Web Locks, and the
// module promise without them); a retried write keeps its Idempotency-Key; `token_invalid` and a
// refused refresh end the session; the session doors never refresh.
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPlatformLogoutUrl, getPlatformRefreshUrl } from '../generated/platform/client.ts';
import { getLogoutUrl, getRefreshSessionUrl } from '../generated/staff/client.ts';
import {
  apiFetch,
  createSessionFetcher,
  refreshLockNames,
  sessionPaths,
  uuidv7,
  type RefreshLocks,
} from '../src/http.ts';

const origin = 'http://localhost:3001';

/** The API's view: which access token is current, and what each request carried. */
const api = {
  token: 'a1',
  refreshes: 0,
  refreshAnswer: 204 as 204 | 401 | 403,
  seen: [] as {
    path: string;
    token: string | undefined;
    key: string | null;
    client: string | null;
  }[],
};

const error = (status: number, code: string) =>
  HttpResponse.json({ code, message: code }, { status });

function tokenOf(request: Request): string | undefined {
  return /(?:^|;\s*)el_staff_at=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
}

/** Cookies in this test are a header the fetcher's caller sets from `api.token`, like a browser. */
let browserToken = 'a0';

const server = setupServer(
  http.post(`${origin}/v1/staff/auth/refresh`, async () => {
    api.refreshes++;
    // The refresh takes a moment, so concurrent requests overlap it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (api.refreshAnswer === 401) return error(401, 'token_invalid');
    if (api.refreshAnswer === 403) return error(403, 'account_suspended');
    api.token = `a${api.refreshes + 1}`;
    browserToken = api.token;
    return new HttpResponse(null, { status: 204 });
  }),
  http.all(`${origin}/v1/staff/orders/:id`, ({ request, params }) => {
    const token = tokenOf(request);
    api.seen.push({
      path: `/orders/${String(params.id)}`,
      token,
      key: request.headers.get('idempotency-key'),
      client: request.headers.get('x-el-client'),
    });
    if (params.id === 'revoked') return error(401, 'token_invalid');
    if (token !== api.token) return error(401, 'token_expired');
    return HttpResponse.json({ id: params.id });
  }),
  http.post(`${origin}/v1/staff/auth/select-account`, () => error(401, 'token_expired')),
);

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  api.token = 'a1';
  api.refreshes = 0;
  api.refreshAnswer = 204;
  api.seen = [];
  browserToken = 'a0';
});
afterAll(() => server.close());

function fetcher(extra: Partial<Parameters<typeof createSessionFetcher>[0]> = {}) {
  return createSessionFetcher({
    surface: 'staff',
    baseUrl: origin,
    // The browser sends its cookie jar; here the jar is `browserToken`.
    headers: () => ({ Cookie: `el_staff_at=${browserToken}` }),
    ...extra,
  });
}

const get = (f: ReturnType<typeof fetcher>, id: string) =>
  apiFetch<{ data: { id: string } }>(`/v1/staff/orders/${id}`, { fetcher: f, method: 'GET' });

describe('createSessionFetcher (WEB-2 plan 2.4)', () => {
  it('names the doors and locks the contracts and web §3.2 name', () => {
    expect(sessionPaths.staff.refresh).toBe(getRefreshSessionUrl());
    expect(sessionPaths.staff.logout).toBe(getLogoutUrl());
    expect(sessionPaths.platform.refresh).toBe(getPlatformRefreshUrl());
    expect(sessionPaths.platform.logout).toBe(getPlatformLogoutUrl());
    expect(refreshLockNames).toEqual({
      staff: 'el-staff-refresh',
      platform: 'el-platform-refresh',
    });
  });

  it('refreshes once for two concurrent token_expired answers (Web Locks) and retries both', async () => {
    const f = fetcher();
    const [one, two] = await Promise.all([get(f, '1'), get(f, '2')]);
    expect([one.data.id, two.data.id]).toEqual(['1', '2']);
    expect(api.refreshes).toBe(1);
  });

  it('refreshes once per tab without Web Locks, through the module promise', async () => {
    const f = fetcher({ locks: null });
    const results = await Promise.all([get(f, '1'), get(f, '2'), get(f, '3')]);
    expect(results.map((result) => result.data.id)).toEqual(['1', '2', '3']);
    expect(api.refreshes).toBe(1);
  });

  it('uses the browser-wide lock by name', async () => {
    const names: string[] = [];
    const real = navigator.locks as unknown as RefreshLocks;
    const locks: RefreshLocks = {
      request: (name, options, callback) => {
        names.push(name);
        return real.request(name, options, callback);
      },
    };
    await get(fetcher({ locks }), '1');
    expect(names[0]).toBe('el-staff-refresh');
  });

  it('retries a write once with the same Idempotency-Key and the web client marker', async () => {
    const f = fetcher({ idempotencyKey: () => 'key-1' });
    await apiFetch(`/v1/staff/orders/9`, { fetcher: f, method: 'PUT', body: '{}' });
    expect(api.seen.map((seen) => seen.key)).toEqual(['key-1', 'key-1']);
    expect(api.seen.every((seen) => seen.client === 'web')).toBe(true);
    expect(api.refreshes).toBe(1);
  });

  it('gives each write call its own UUID v7 key and none to a read', async () => {
    browserToken = 'a1';
    const f = fetcher();
    await apiFetch(`/v1/staff/orders/1`, { fetcher: f, method: 'POST', body: '{}' });
    await apiFetch(`/v1/staff/orders/2`, { fetcher: f, method: 'POST', body: '{}' });
    await get(f, '3');
    const [first, second, read] = api.seen.map((seen) => seen.key);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
    expect(read).toBeNull();
    expect(api.refreshes).toBe(0);
  });

  it('keeps a key the caller set', async () => {
    browserToken = 'a1';
    await apiFetch(`/v1/staff/orders/1`, {
      fetcher: fetcher(),
      method: 'POST',
      body: '{}',
      headers: { 'Idempotency-Key': 'mine' },
    });
    expect(api.seen[0]?.key).toBe('mine');
  });

  it('ends the session on token_invalid without refreshing', async () => {
    const onSessionEnded = vi.fn();
    await expect(get(fetcher({ onSessionEnded }), 'revoked')).rejects.toMatchObject({
      status: 401,
      code: 'token_invalid',
    });
    expect(onSessionEnded).toHaveBeenCalledWith('token_invalid');
    expect(api.refreshes).toBe(0);
  });

  it('ends the session when the refresh is refused, and on a suspended account', async () => {
    const onSessionEnded = vi.fn();
    api.refreshAnswer = 401;
    await expect(get(fetcher({ onSessionEnded }), '1')).rejects.toMatchObject({
      code: 'token_expired',
    });
    expect(onSessionEnded).toHaveBeenLastCalledWith('refresh_refused');
    api.refreshAnswer = 403;
    await expect(get(fetcher({ onSessionEnded }), '1')).rejects.toMatchObject({ status: 401 });
    expect(onSessionEnded).toHaveBeenLastCalledWith('account_suspended');
  });

  it('retries with the original key after the user signs in again in the dialog', async () => {
    api.refreshAnswer = 401;
    const onSessionEnded = vi.fn(() => {
      browserToken = api.token;
      return Promise.resolve(true);
    });
    const f = fetcher({ onSessionEnded, idempotencyKey: () => 'key-2' });
    const result = await apiFetch<{ data: { id: string } }>(`/v1/staff/orders/5`, {
      fetcher: f,
      method: 'PATCH',
      body: '{}',
    });
    expect(result.data.id).toBe('5');
    expect(api.seen.map((seen) => seen.key)).toEqual(['key-2', 'key-2']);
  });

  it('never refreshes for a session door, whose 401 speaks of its own token', async () => {
    const onSessionEnded = vi.fn();
    const response = await fetcher({ onSessionEnded })('/v1/staff/auth/select-account', {
      method: 'POST',
      body: '{}',
    });
    expect(response.status).toBe(401);
    expect(api.refreshes).toBe(0);
    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it('sends every call same-origin with the credentials', async () => {
    const seen: RequestInit[] = [];
    const f = createSessionFetcher({
      surface: 'staff',
      fetch: (_input, init) => {
        seen.push(init ?? {});
        return Promise.resolve(new Response('{}', { status: 200 }));
      },
    });
    await f('/v1/staff/me', { method: 'GET' });
    expect(seen[0]?.credentials).toBe('same-origin');
  });
});

describe('uuidv7', () => {
  it('is time-ordered and versioned', () => {
    const early = uuidv7(1_700_000_000_000);
    const late = uuidv7(1_700_000_000_001);
    expect(early < late).toBe(true);
    expect(early.slice(0, 13)).toBe('018bcfe5-6800');
    expect(early[14]).toBe('7');
  });
});
