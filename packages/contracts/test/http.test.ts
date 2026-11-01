// The fetcher behind every generated client (PLAT-15 plan 2.4): headers, error parsing, no
// environment read, and the call path from a generated function through `apiFetch`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { platformListAccounts, platformProvisionAccount } from '../generated/platform/client.ts';
import { ApiError, apiFetch, createFetcher, defaultRequestId } from '../src/http.ts';

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

/** A fetch double that records each call and answers with `respond`. */
function fakeFetch(respond: () => Response) {
  const calls: Call[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    });
    return Promise.resolve(respond());
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const page = { data: [], next_cursor: null };

afterEach(() => vi.unstubAllGlobals());

describe('createFetcher headers', () => {
  it('joins the base URL with the generated path, which carries the surface base path', async () => {
    const { calls, fetch } = fakeFetch(() => json(200, page));
    const fetcher = createFetcher({ baseUrl: 'https://api.example.test/', fetch });
    await platformListAccounts({ limit: 10 }, { fetcher });
    expect(calls[0]?.url).toBe('https://api.example.test/v1/platform/accounts?limit=10');
  });

  it('sends Accept-Language and a fresh X-Request-Id on every call', async () => {
    const { calls, fetch } = fakeFetch(() => json(200, page));
    const fetcher = createFetcher({ baseUrl: '', fetch, locale: 'ar' });
    await platformListAccounts(undefined, { fetcher });
    await platformListAccounts(undefined, { fetcher });
    const ids = calls.map((c) => c.headers.get('x-request-id'));
    expect(calls.map((c) => c.headers.get('accept-language'))).toEqual(['ar', 'ar']);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('reads locale and headers per call when given functions', async () => {
    const { calls, fetch } = fakeFetch(() => json(200, page));
    let locale: 'ar' | 'en' = 'en';
    const fetcher = createFetcher({
      baseUrl: '',
      fetch,
      locale: () => locale,
      headers: () => ({ cookie: `el_platform_at=${locale}` }),
    });
    await platformListAccounts(undefined, { fetcher });
    locale = 'ar';
    await platformListAccounts(undefined, { fetcher });
    expect(calls.map((c) => c.headers.get('accept-language'))).toEqual(['en', 'ar']);
    expect(calls.map((c) => c.headers.get('cookie'))).toEqual([
      'el_platform_at=en',
      'el_platform_at=ar',
    ]);
  });

  it('marks non-GET calls with X-EL-Client: web and leaves GET unmarked', async () => {
    const { calls, fetch } = fakeFetch(() => json(201, { id: 'a' }));
    const fetcher = createFetcher({ baseUrl: '', fetch });
    await platformListAccounts(undefined, { fetcher });
    await platformProvisionAccount(
      { name: 'Acme' } as Parameters<typeof platformProvisionAccount>[0],
      { headers: { 'Idempotency-Key': '00000000-0000-7000-8000-000000000001' }, fetcher },
    );
    expect(calls[0]?.headers.has('x-el-client')).toBe(false);
    expect(calls[1]?.method).toBe('POST');
    expect(calls[1]?.headers.get('x-el-client')).toBe('web');
    expect(calls[1]?.headers.get('idempotency-key')).toBe('00000000-0000-7000-8000-000000000001');
    expect(calls[1]?.headers.get('content-type')).toBe('application/json');
    expect(calls[1]?.body).toBe(JSON.stringify({ name: 'Acme' }));
  });

  it('marks every non-GET method, HEAD and OPTIONS included', async () => {
    const { calls, fetch } = fakeFetch(() => new Response(null, { status: 204 }));
    const fetcher = createFetcher({ baseUrl: '', fetch });
    for (const method of ['HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE', 'get']) {
      await apiFetch('/x', { method, fetcher });
    }
    expect(calls.map((c) => c.headers.get('x-el-client'))).toEqual([
      'web',
      'web',
      'web',
      'web',
      'web',
      null,
    ]);
  });

  it('does not mark writes when webClient is false (driver app)', async () => {
    const { calls, fetch } = fakeFetch(() => new Response(null, { status: 204 }));
    const fetcher = createFetcher({ baseUrl: '', fetch, webClient: false, requestId: () => 'r-1' });
    await apiFetch('/v1/driver/shifts', { method: 'POST', fetcher });
    expect(calls[0]?.headers.has('x-el-client')).toBe(false);
    expect(calls[0]?.headers.get('x-request-id')).toBe('r-1');
  });
});

describe('apiFetch responses', () => {
  it('returns data, status and headers for a 2xx', async () => {
    const { fetch } = fakeFetch(() => json(200, page, { 'x-request-id': 'srv-1' }));
    const result = await platformListAccounts(undefined, {
      fetcher: createFetcher({ baseUrl: '', fetch }),
    });
    expect(result.status).toBe(200);
    expect(result.data).toEqual(page);
    expect((result as unknown as { headers: Headers }).headers.get('x-request-id')).toBe('srv-1');
  });

  it('returns undefined data for 204', async () => {
    const { fetch } = fakeFetch(() => new Response(null, { status: 204 }));
    const result = await apiFetch<{ data: unknown; status: number }>('/x', {
      method: 'DELETE',
      fetcher: createFetcher({ baseUrl: '', fetch }),
    });
    expect(result).toMatchObject({ data: undefined, status: 204 });
  });

  it('throws ApiError with code, message, details and request_id from the Error body', async () => {
    const { fetch } = fakeFetch(() =>
      json(409, {
        code: 'version_conflict',
        message: 'Version conflict',
        details: { current_status: 'assigned', version: 7 },
        request_id: 'req-9',
      }),
    );
    const error = await platformListAccounts(undefined, {
      fetcher: createFetcher({ baseUrl: '', fetch }),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'version_conflict',
      message: 'Version conflict',
      details: { current_status: 'assigned', version: 7 },
      requestId: 'req-9',
    });
  });

  it('falls back to unexpected_response and the X-Request-Id header for a non-Error body', async () => {
    const { fetch } = fakeFetch(
      () =>
        new Response('<html>Bad gateway</html>', {
          status: 502,
          headers: { 'content-type': 'text/html', 'x-request-id': 'edge-1' },
        }),
    );
    const error = await apiFetch('/x', {
      fetcher: createFetcher({ baseUrl: '', fetch }),
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, code: 'unexpected_response', requestId: 'edge-1' });
  });

  it('rejects with a clear message when no fetcher is passed', async () => {
    await expect(platformListAccounts()).rejects.toThrow(/fetcher: createFetcher/);
  });

  it('lets a network failure through unchanged (no retry)', async () => {
    const failure = new TypeError('fetch failed');
    const fetch = vi.fn(() => Promise.reject(failure));
    const fetcher = createFetcher({ baseUrl: '', fetch });
    await expect(apiFetch('/x', { fetcher })).rejects.toBe(failure);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('defaultRequestId', () => {
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('uses crypto.randomUUID when present', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'from-random-uuid' });
    expect(defaultRequestId()).toBe('from-random-uuid');
  });

  it('builds a v4 UUID from crypto.getRandomValues when randomUUID is missing (Hermes)', () => {
    const getRandomValues = <T extends ArrayBufferView>(array: T): T => {
      new Uint8Array(array.buffer).fill(0xff);
      return array;
    };
    vi.stubGlobal('crypto', { getRandomValues });
    const id = defaultRequestId();
    expect(id).toMatch(uuidV4);
    expect(id).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('sends the fallback id through createFetcher', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: <T extends ArrayBufferView>(array: T): T => array,
    });
    const { calls, fetch } = fakeFetch(() => json(200, page));
    await platformListAccounts(undefined, { fetcher: createFetcher({ baseUrl: '', fetch }) });
    expect(calls[0]?.headers.get('x-request-id')).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('throws an error naming the requestId option when Web Crypto is absent', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => defaultRequestId()).toThrow(/requestId option/);
  });
});

describe('no environment read', () => {
  it('builds and calls without touching process.env', async () => {
    const env = new Proxy(
      {},
      {
        get(_target, key) {
          throw new Error(`process.env.${String(key)} was read`);
        },
        has(_target, key) {
          throw new Error(`process.env has ${String(key)} was read`);
        },
      },
    );
    // The one place this package touches process: replacing env with a trap proves no read.
    // eslint-disable-next-line no-restricted-properties
    vi.stubGlobal('process', { ...globalThis.process, env });
    const { calls, fetch } = fakeFetch(() => json(200, page));
    const result = await platformListAccounts(undefined, {
      fetcher: createFetcher({ baseUrl: 'https://api.example.test', fetch, locale: 'en' }),
    });
    expect(result.status).toBe(200);
    expect(calls).toHaveLength(1);
  });
});
