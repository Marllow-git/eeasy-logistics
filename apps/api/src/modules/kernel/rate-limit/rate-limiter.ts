import type { OnApplicationShutdown } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Redis } from 'ioredis';
import type { Principal } from '../auth/principal.js';
import { surfaceOf } from '../auth/surfaces.js';
import { ApiException } from '../errors/api-exception.js';
import type { Budgets } from './budgets.js';
import { budgetFor, defaultBudgets, windowMs } from './budgets.js';

// Per-route budgets in Redis (PLAT-6 plan 2.10; contracts README §7; identity and tenancy §8). A
// fixed window per minute: one Lua script increments the counter and starts its expiry on the
// first hit, atomically, and answers the count with the time left. Redis unreachable fails open
// (owner question 1, default for wave 0): the request is served, a warning is logged at most once
// a minute and `failOpenCount` counts it until PLAT-14 exports metrics.

/** The provider token of the limiter; absent when `REDIS_URL` is not configured. */
export const RATE_LIMITER = Symbol('RATE_LIMITER');

export const rateLimitHeaders = {
  limit: 'RateLimit-Limit',
  remaining: 'RateLimit-Remaining',
  reset: 'RateLimit-Reset',
} as const;

export interface WindowCount {
  readonly count: number;
  /** Milliseconds until the window ends. */
  readonly ttlMs: number;
}

/** Where the counters live: Redis in the app, a fake in unit tests. */
export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<WindowCount>;
  close(): void;
}

// INCR and PEXPIRE in one script (atomic): the first hit of a window sets its expiry; a counter
// left without one (never expected) gets it again, so a key can never live forever.
const hitScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

interface RateLimitRedis {
  elxRateLimitHit(key: string, windowMs: number): Promise<[number, number]>;
}

/**
 * The Redis store: one long-lived client that reconnects in the background. No offline queue and
 * a short command timeout, so while Redis is down a hit fails at once and the request fails open
 * instead of waiting.
 */
export function redisRateLimitStore(url: string): RateLimitStore {
  const client = new Redis(url, {
    connectTimeout: 2000,
    commandTimeout: 500,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
  });
  client.on('error', () => undefined);
  client.defineCommand('elxRateLimitHit', { numberOfKeys: 1, lua: hitScript });
  const scripted = client as unknown as RateLimitRedis;
  return {
    async hit(key, window) {
      const [count, ttlMs] = await scripted.elxRateLimitHit(key, window);
      return { count: Number(count), ttlMs: Number(ttlMs) };
    },
    close: () => client.disconnect(),
  };
}

/** The identity a request is counted under: user, device, else the client address. */
export function rateLimitIdentity(principal: Principal | undefined, request: Request): string {
  if (principal === undefined) return `ip:${request.ip ?? 'unknown'}`;
  return principal.kind === 'driver' ? `device:${principal.deviceId}` : `user:${principal.userId}`;
}

/** `<METHOD> <route template>` of the matched route (the request path before routing). */
function routeKey(request: Request): string {
  const route = (request as { route?: { path?: unknown } }).route?.path;
  return `${request.method} ${typeof route === 'string' ? route : request.path}`;
}

export interface RateLimiterOptions {
  readonly budgets?: Budgets;
  /** Redis key prefix; tests use a fresh one so runs never share counters. */
  readonly prefix?: string;
  readonly logger?: Pick<Logger, 'warn'>;
  readonly now?: () => number;
}

export class RateLimiter implements OnApplicationShutdown {
  /** Requests served without a check because the store failed (the metric of plan 2.10). */
  failOpenCount = 0;
  readonly #store: RateLimitStore;
  readonly #budgets: Budgets;
  readonly #prefix: string;
  readonly #logger: Pick<Logger, 'warn'>;
  readonly #now: () => number;
  #lastWarning = Number.NEGATIVE_INFINITY;

  constructor(store: RateLimitStore, options: RateLimiterOptions = {}) {
    this.#store = store;
    this.#budgets = options.budgets ?? defaultBudgets;
    this.#prefix = options.prefix ?? 'elx:rl';
    this.#logger = options.logger ?? new Logger('RateLimit');
    this.#now = options.now ?? Date.now;
  }

  /**
   * Charges one request to its budget and sets the three `RateLimit-*` headers; throws
   * `429 rate_limited` with `Retry-After` and `details.retry_after_s` when over the budget.
   */
  async enforce(request: Request, response: Response, identity: string): Promise<void> {
    const surface = surfaceOf(request.path);
    const budget = budgetFor(surface, routeKey(request), this.#budgets);
    if (budget === undefined) return;
    const key = `${this.#prefix}:${surface ?? 'none'}:${budget.bucket}:${identity}`;
    let window: WindowCount;
    try {
      window = await this.#store.hit(key, windowMs);
    } catch {
      this.#failOpen();
      return;
    }
    const resetS = Math.max(1, Math.ceil(window.ttlMs / 1000));
    response.setHeader(rateLimitHeaders.limit, String(budget.limit));
    response.setHeader(
      rateLimitHeaders.remaining,
      String(Math.max(0, budget.limit - window.count)),
    );
    response.setHeader(rateLimitHeaders.reset, String(resetS));
    if (window.count > budget.limit) {
      throw new ApiException('rate_limited', {
        details: { retry_after_s: resetS },
        headers: { 'Retry-After': String(resetS) },
      });
    }
  }

  #failOpen(): void {
    this.failOpenCount += 1;
    const now = this.#now();
    if (now - this.#lastWarning < windowMs) return;
    this.#lastWarning = now;
    this.#logger.warn(
      `rate limits not enforced: the Redis store is unavailable (${this.failOpenCount} requests served unchecked so far)`,
    );
  }

  onApplicationShutdown(): void {
    this.#store.close();
  }
}
