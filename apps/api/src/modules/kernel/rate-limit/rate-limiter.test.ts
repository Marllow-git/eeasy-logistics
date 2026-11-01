import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { ApiException } from '../errors/api-exception.js';
import { budgetFor, defaultBudgets } from './budgets.js';
import type { RateLimitStore } from './rate-limiter.js';
import { RateLimiter, addressKey, rateLimitIdentity } from './rate-limiter.js';

// PLAT-6 item F, the limiter without Redis: budgets per surface and route, headers, the 429 body,
// identities, and fail-open with one warning a minute.

function memoryStore(): RateLimitStore & { keys: () => string[] } {
  const counts = new Map<string, number>();
  return {
    hit: (key) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return Promise.resolve({ count, ttlMs: 42_100 });
    },
    close: () => undefined,
    keys: () => [...counts.keys()],
  };
}

const failingStore: RateLimitStore = {
  hit: () => Promise.reject(new Error('connection refused')),
  close: () => undefined,
};

function call(method: string, path: string, route?: string) {
  const headers = new Map<string, string>();
  const request = { method, path, ip: '203.0.113.9', route: { path: route ?? path } };
  const response = { setHeader: (name: string, value: string) => headers.set(name, value) };
  return {
    request: request as unknown as Request,
    response: response as unknown as Response,
    headers,
  };
}

describe('budgetFor', () => {
  it('uses the surface budget of README §7', () => {
    expect(budgetFor('staff', 'GET /v1/staff/orders')).toEqual({ bucket: 'all', limit: 600 });
    expect(budgetFor('platform', 'GET /v1/platform/accounts')).toEqual({
      bucket: 'all',
      limit: 300,
    });
    expect(budgetFor('driver', 'GET /v1/driver/run')).toEqual({ bucket: 'all', limit: 300 });
    expect(budgetFor('recipient', 'GET /v1/recipient/x')).toEqual({ bucket: 'all', limit: 60 });
    expect(budgetFor('public', 'GET /v1/public/orders')).toEqual({ bucket: 'all', limit: 600 });
  });

  it('gives an overridden route a bucket of its own', () => {
    expect(budgetFor('driver', 'POST /v1/driver/locations')).toEqual({
      bucket: 'POST /v1/driver/locations',
      limit: 12,
    });
    expect(budgetFor('public', 'POST /v1/public/orders')?.limit).toBe(120);
  });

  it('limits nothing outside the surfaces (health probes)', () => {
    expect(budgetFor(undefined, 'GET /health')).toBeUndefined();
  });

  it('never reads an inherited key as a route', () => {
    expect(budgetFor('staff', 'constructor', defaultBudgets)).toEqual({
      bucket: 'all',
      limit: 600,
    });
  });
});

describe('rateLimitIdentity', () => {
  const request = { ip: '198.51.100.7' } as Request;
  const facts = { userId: 'u-1', roles: [], scopes: '', sites: [], tokenVersion: 1 };

  it('counts staff and platform by user, the driver by device, anyone else by address', () => {
    expect(
      rateLimitIdentity({ kind: 'staff', accountId: 'a', membershipId: 'm', ...facts }, request),
    ).toBe('user:u-1');
    expect(rateLimitIdentity({ kind: 'platform', ...facts }, request)).toBe('user:u-1');
    expect(
      rateLimitIdentity(
        { kind: 'driver', accountId: 'a', membershipId: 'm', deviceId: 'd-1', ...facts },
        request,
      ),
    ).toBe('device:d-1');
    expect(rateLimitIdentity(undefined, request)).toBe('ip:198.51.100.7');
  });
});

describe('addressKey (adversary L-7)', () => {
  it('keeps IPv4, unwraps IPv4-mapped IPv6 and keys IPv6 by its /64', () => {
    expect(addressKey('203.0.113.9')).toBe('203.0.113.9');
    expect(addressKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(addressKey('2001:db8:aa:bb:1:2:3:4')).toBe('2001:db8:aa:bb::/64');
    expect(addressKey('2001:DB8:AA:BB::99')).toBe('2001:db8:aa:bb::/64');
    expect(addressKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(addressKey('::1')).toBe('0:0:0:0::/64');
    expect(addressKey(undefined)).toBe('unknown');
  });

  it('puts two addresses of one /64 in one budget', () => {
    const a = rateLimitIdentity(undefined, { ip: '2001:db8:1:2::a' } as Request);
    const b = rateLimitIdentity(undefined, { ip: '2001:db8:1:2:ffff::b' } as Request);
    expect(a).toBe(b);
  });
});

describe('RateLimiter', () => {
  const budgets = { surfaces: { ...defaultBudgets.surfaces, staff: 2 }, routes: {} };

  it('sets the three headers and answers 429 with Retry-After and retry_after_s past the budget', async () => {
    const limiter = new RateLimiter(memoryStore(), { budgets });
    const first = call('GET', '/v1/staff/orders');
    await limiter.enforce(first.request, first.response, 'user:u-1');
    expect(Object.fromEntries(first.headers)).toEqual({
      'RateLimit-Limit': '2',
      'RateLimit-Remaining': '1',
      'RateLimit-Reset': '43',
    });
    const second = call('GET', '/v1/staff/orders');
    await limiter.enforce(second.request, second.response, 'user:u-1');
    expect(second.headers.get('RateLimit-Remaining')).toBe('0');

    const third = call('GET', '/v1/staff/orders');
    const refusal = await limiter
      .enforce(third.request, third.response, 'user:u-1')
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ApiException);
    const exception = refusal as ApiException;
    expect(exception.code).toBe('rate_limited');
    expect(exception.status).toBe(429);
    expect(exception.options.details).toEqual({ retry_after_s: 43 });
    expect(exception.options.headers).toEqual({ 'Retry-After': '43' });
    expect(third.headers.get('RateLimit-Remaining')).toBe('0');
  });

  it('keeps identities, surfaces and overridden routes in separate counters', async () => {
    const store = memoryStore();
    const limiter = new RateLimiter(store, { prefix: 'p' });
    const { request, response } = call('GET', '/v1/staff/orders/1', '/v1/staff/orders/:id');
    await limiter.enforce(request, response, 'user:a');
    await limiter.enforce(request, response, 'user:b');
    const location = call('POST', '/v1/driver/locations');
    await limiter.enforce(location.request, location.response, 'device:d');
    expect(location.headers.get('RateLimit-Limit')).toBe('12');
    expect(store.keys()).toEqual([
      'p:staff:all:user:a',
      'p:staff:all:user:b',
      'p:driver:POST /v1/driver/locations:device:d',
    ]);
  });

  it('does not count a path outside every surface', async () => {
    const store = memoryStore();
    const limiter = new RateLimiter(store);
    const health = call('GET', '/health');
    await limiter.enforce(health.request, health.response, 'ip:x');
    expect(store.keys()).toEqual([]);
    expect(health.headers.size).toBe(0);
  });

  it('fails open when the store fails: served, counted, one warning a minute', async () => {
    const warnings: string[] = [];
    let now = 1_000_000;
    const limiter = new RateLimiter(failingStore, {
      logger: { warn: (message: string) => warnings.push(message) },
      now: () => now,
    });
    for (let index = 0; index < 3; index += 1) {
      const { request, response, headers } = call('GET', '/v1/staff/orders');
      await expect(limiter.enforce(request, response, 'user:u')).resolves.toBeUndefined();
      expect(headers.size).toBe(0);
    }
    expect(limiter.failOpenCount).toBe(3);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('rate limits not enforced');
    now += 60_000;
    const { request, response } = call('GET', '/v1/staff/orders');
    await limiter.enforce(request, response, 'user:u');
    expect(warnings).toHaveLength(2);
  });
});
