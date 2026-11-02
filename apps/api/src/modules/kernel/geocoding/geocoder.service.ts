import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ProviderFailure } from '../outbox/provider-failure.js';
import type { GeocodeCacheStore } from '../platform/geocode-cache.repository.js';
import type { CachedGeocodeSource } from '../schema/geocode-cache.js';
import { cachedGeocodeSources } from '../schema/geocode-cache.js';
import { getMetrics } from '../telemetry/metrics.js';
import { geocodeKey, reverseKey, roundedPoint, shortCodeKey } from './cache-key.js';
import type { ChainAnswer, ChainGeocoder, GeocodeMethod } from './chain-geocoder.js';
import type {
  GeoPoint,
  GeocodeQuery,
  GeocodeResult,
  NotFound,
  ReverseResult,
  ShortCodeResult,
  Unavailable,
} from './geocoder.js';
import { GeocoderInputError, normaliseShortCode } from './geocoder.js';

// The geocoder port the callers inject (INT-2 plan 2.6; integrations §2.2, §6.2): validates and
// normalises the input, answers from the cache (Redis `elx:geocode:<key hex>`, then
// `core_geocode_cache`), else asks the chain of sources and writes the answer back: 30 days for a
// hit, 24 hours for `not_found` (plan §7 #2: change the two constants below when Q-28's contract
// states a rule). The stub's answers are never cached. A caller that asks for `degraded: true`
// (DEL-2's intake) never sees a provider failure: it gets `{ kind: 'unavailable', reason }`, so an
// order is stored without a point; any other caller gets the failure. With GEOCODER_DISABLED every
// lookup answers `unavailable`. Logs carry the method, the outcome and the key's first 8 hex
// characters only; a cache that fails is skipped, never the lookup.

export const GEOCODER = Symbol('GEOCODER');

/** Plan 2.4: how long an answer is kept. */
export const geocodeHitTtlMs = 30 * 24 * 60 * 60 * 1000;
export const geocodeNotFoundTtlMs = 24 * 60 * 60 * 1000;
export const geocodeRedisPrefix = 'elx:geocode';

export interface GeocodeOptions {
  /** Answer `unavailable` instead of throwing a provider failure (plan 2.6). */
  readonly degraded?: boolean;
  /**
   * Caps the chain below its own 6 s (DEL-2 adversary round 1: the order doors ask with 2 s, so a
   * slow provider costs a dispatcher two seconds at most). Unset keeps the chain's deadline.
   */
  readonly deadlineMs?: number | undefined;
}

export interface GeocoderServiceParts {
  /** The sources in order; absent when the configuration has none (answers `no_source`). */
  readonly chain?: ChainGeocoder | undefined;
  /** `GEOCODER_DISABLED=true`. */
  readonly disabled?: boolean;
  /** `core_geocode_cache` on the platform pool; absent without it (no table cache). */
  readonly cache?: GeocodeCacheStore | undefined;
  /** Redis in front of the table; absent without `REDIS_URL`. */
  readonly redis?: Pick<Redis, 'get' | 'set'> | undefined;
  /** Key prefix in Redis (tests use their own). */
  readonly redisPrefix?: string;
  readonly logger?: Pick<Logger, 'warn'>;
}

const textLimit = 500;
const cityLimit = 120;
const oneLine = (value: string) => !/[\r\n\u2028\u2029]/.test(value);

type Answer<T> = T | NotFound | Unavailable;

export class GeocoderService {
  readonly #chain: ChainGeocoder | undefined;
  readonly #disabled: boolean;
  readonly #cache: GeocodeCacheStore | undefined;
  readonly #redis: Pick<Redis, 'get' | 'set'> | undefined;
  readonly #prefix: string;
  readonly #logger: Pick<Logger, 'warn'>;

  constructor(parts: GeocoderServiceParts = {}) {
    this.#chain = parts.chain;
    this.#disabled = parts.disabled ?? false;
    this.#cache = parts.cache;
    this.#redis = parts.redis;
    this.#prefix = parts.redisPrefix ?? geocodeRedisPrefix;
    this.#logger = parts.logger ?? new Logger('Geocoder');
  }

  /** An address text (1 to 500 characters, one line) and an optional city (120). */
  async geocode(query: GeocodeQuery, options: GeocodeOptions = {}): Promise<Answer<GeocodeResult>> {
    const text = typeof query.text === 'string' ? query.text.trim() : '';
    if (text === '' || text.length > textLimit || !oneLine(text)) {
      throw new GeocoderInputError('text');
    }
    let city: string | undefined;
    if (query.city !== undefined) {
      if (typeof query.city !== 'string' || query.city.length > cityLimit || !oneLine(query.city)) {
        throw new GeocoderInputError('city');
      }
      city = query.city.trim() === '' ? undefined : query.city.trim();
    }
    if (query.locale !== 'ar' && query.locale !== 'en') throw new GeocoderInputError('text');
    const normalised: GeocodeQuery = { text, locale: query.locale, ...(city ? { city } : {}) };
    return await this.#lookup('geocode', geocodeKey(normalised), options, (chain) =>
      chain.geocode(normalised, options.deadlineMs),
    );
  }

  /** A National Address short code in any spelling `normaliseShortCode` accepts. */
  async lookupShortCode(
    code: string,
    options: GeocodeOptions = {},
  ): Promise<Answer<ShortCodeResult>> {
    const shortCode = normaliseShortCode(code);
    if (shortCode === undefined) throw new GeocoderInputError('code');
    return await this.#lookup('shortcode', shortCodeKey(shortCode), options, (chain) =>
      chain.lookupShortCode(shortCode, options.deadlineMs),
    );
  }

  /** A WGS84 point; asked rounded to 5 decimals. */
  async reverse(point: GeoPoint, options: GeocodeOptions = {}): Promise<Answer<ReverseResult>> {
    const valid = (value: unknown, limit: number) =>
      typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
    if (!valid(point?.lat, 90) || !valid(point?.lng, 180)) throw new GeocoderInputError('point');
    const rounded = roundedPoint(point);
    return await this.#lookup('reverse', reverseKey(rounded), options, (chain) =>
      chain.reverse(rounded, options.deadlineMs),
    );
  }

  async #lookup<T extends { kind: 'found' }>(
    method: GeocodeMethod,
    key: Buffer,
    options: GeocodeOptions,
    ask: (chain: ChainGeocoder) => Promise<ChainAnswer<T>>,
  ): Promise<Answer<T>> {
    const count = (source: string, outcome: string) =>
      getMetrics().add('geocoder_calls_total', 1, { method, source, outcome });
    const ref = key.toString('hex').slice(0, 8);
    if (this.#disabled) {
      count('none', 'unavailable');
      return { kind: 'unavailable', reason: 'disabled' };
    }
    const chain = this.#chain;
    if (chain === undefined || chain.sourcesFor(method).length === 0) {
      count('none', 'unavailable');
      return { kind: 'unavailable', reason: 'no_source' };
    }
    const cached = await this.#readCache<T>(method, key, ref);
    if (cached !== undefined) {
      count(cached.source, 'hit');
      return cached.answer;
    }
    let answer: ChainAnswer<T>;
    try {
      answer = await ask(chain);
    } catch (error) {
      if (!(error instanceof ProviderFailure)) throw error;
      this.#logger.warn(
        `geocoder lookup failed method=${method} outcome=${error.reason} key=${ref}`,
      );
      if (options.degraded !== true) throw error;
      count('none', 'unavailable');
      return { kind: 'unavailable', reason: error.reason };
    }
    await this.#writeCache(method, key, ref, answer);
    return answer.answer;
  }

  async #readCache<T>(
    method: GeocodeMethod,
    key: Buffer,
    ref: string,
  ): Promise<{ answer: T | NotFound; source: CachedGeocodeSource } | undefined> {
    const redisKey = `${this.#prefix}:${key.toString('hex')}`;
    if (this.#redis !== undefined) {
      try {
        const value = await this.#redis.get(redisKey);
        const parsed = value === null ? undefined : cachedValue<T>(JSON.parse(value));
        if (parsed !== undefined) return parsed;
      } catch {
        this.#logger.warn(`geocoder cache skipped method=${method} store=redis key=${ref}`);
      }
    }
    if (this.#cache === undefined) return undefined;
    try {
      const row = await this.#cache.read(key);
      const parsed =
        row === undefined
          ? undefined
          : cachedValue<T>({ provider: row.provider, result: row.result });
      if (parsed === undefined || row === undefined) return undefined;
      // Redis is filled from the table for the row's remaining life.
      const remaining = row.expiresAt.getTime() - Date.now();
      if (this.#redis !== undefined && remaining > 1000) {
        await this.#redis
          .set(
            redisKey,
            JSON.stringify({ provider: row.provider, result: row.result }),
            'PX',
            remaining,
          )
          .catch(() => undefined);
      }
      return parsed;
    } catch {
      this.#logger.warn(`geocoder cache skipped method=${method} store=table key=${ref}`);
      return undefined;
    }
  }

  async #writeCache<T extends { kind: 'found' }>(
    method: GeocodeMethod,
    key: Buffer,
    ref: string,
    answer: ChainAnswer<T>,
  ): Promise<void> {
    const provider = answer.source;
    if (provider === 'stub') return;
    const ttlMs = answer.answer.kind === 'not_found' ? geocodeNotFoundTtlMs : geocodeHitTtlMs;
    try {
      await this.#cache?.write({ key, method, provider, result: answer.answer, ttlMs });
      await this.#redis?.set(
        `${this.#prefix}:${key.toString('hex')}`,
        JSON.stringify({ provider, result: answer.answer }),
        'PX',
        ttlMs,
      );
    } catch {
      this.#logger.warn(`geocoder cache not written method=${method} key=${ref}`);
    }
  }
}

/** A cached `{ provider, result }`, when it has the shape this service writes. */
function cachedValue<T>(
  value: unknown,
): { answer: T | NotFound; source: CachedGeocodeSource } | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const { provider, result } = value as { provider?: unknown; result?: unknown };
  const sources: readonly unknown[] = cachedGeocodeSources;
  if (!sources.includes(provider) || result === null || typeof result !== 'object')
    return undefined;
  const kind = (result as { kind?: unknown }).kind;
  if (kind !== 'found' && kind !== 'not_found') return undefined;
  return { answer: result as T | NotFound, source: provider as CachedGeocodeSource };
}
