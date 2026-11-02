import { randomBytes } from 'node:crypto';
import type { Pool } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { AuditWriter } from '../../src/modules/kernel/audit/audit-writer.js';
import { geocodeKey } from '../../src/modules/kernel/geocoding/cache-key.js';
import { ChainGeocoder } from '../../src/modules/kernel/geocoding/chain-geocoder.js';
import type {
  GeocodeResult,
  GeocoderSource,
  NotFound,
} from '../../src/modules/kernel/geocoding/geocoder.js';
import { notFound } from '../../src/modules/kernel/geocoding/geocoder.js';
import {
  GEOCODER,
  GeocoderService,
  geocodeHitTtlMs,
  geocodeNotFoundTtlMs,
} from '../../src/modules/kernel/geocoding/geocoder.service.js';
import {
  SourceBreaker,
  memoryBreakerStore,
} from '../../src/modules/kernel/geocoding/source-breaker.js';
import { ProviderFailure } from '../../src/modules/kernel/outbox/provider-failure.js';
import { geocodeCacheStore } from '../../src/modules/kernel/platform/geocode-cache.repository.js';
import {
  geocodeCachePurgeAuditAction,
  purgeGeocodeCache,
} from '../../src/worker/system/geocode-cache-purge.js';
import { connectAs, integrationConfig } from './support.js';

// INT-2 item C (plan 2.4, 2.6, 2.10): the geocoder service on the real database and Redis. A
// counting source stands for Hudhud (the adapters have their own tests); Redis keys live under a
// per-run prefix; only this suite writes `core_geocode_cache`.

const config = integrationConfig();
const run = randomBytes(4).toString('hex');
const redisPrefix = `elx-test-${run}:geocode`;

type Script = () => Promise<GeocodeResult | NotFound>;

/** A source that answers what the test plants and counts its calls. */
function countingSource(script: Script) {
  const source = {
    provider: 'hudhud' as const,
    calls: 0,
    script,
    geocode() {
      source.calls += 1;
      return source.script();
    },
  };
  return source satisfies GeocoderSource;
}

const located = (formatted: string): GeocodeResult => ({
  kind: 'found',
  point: { lat: 24.6957, lng: 46.6844 },
  confidence: 0.9,
  formatted,
  provider: 'hudhud',
});

describe('geocoder service (INT-2 plan 2.4, 2.6)', () => {
  let owner: postgres.Sql;
  let pool: Pool<PlatformDatabase>;
  let redis: Redis;
  const written: Buffer[] = [];

  const serviceOn = (source: GeocoderSource, withRedis = true) =>
    new GeocoderService({
      chain: new ChainGeocoder({
        sources: [source],
        breaker: new SourceBreaker(memoryBreakerStore()),
      }),
      cache: geocodeCacheStore(pool.db),
      redis: withRedis ? redis : undefined,
      redisPrefix,
    });

  const rowOf = async (key: Buffer) =>
    (
      await owner<
        { method: string; provider: string; result: unknown; ttl_s: number }[]
      >`SELECT method, provider, result,
               extract(epoch FROM expires_at - created_at)::int AS ttl_s
        FROM core_geocode_cache WHERE key = ${key}`
    )[0];

  beforeAll(() => {
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'geocoder-test');
    const url = config.redis.url?.reveal();
    if (url === undefined) throw new Error('The geocoder suite needs REDIS_URL');
    redis = new Redis(url, { maxRetriesPerRequest: 1 });
  });

  afterAll(async () => {
    if (written.length > 0) {
      await owner`DELETE FROM core_geocode_cache WHERE encode(key, 'hex') = ANY(${written.map((key) => key.toString('hex'))})`;
    }
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `elx-test-${run}:*`, 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
    redis.disconnect();
    await Promise.all([owner.end(), pool.close()]);
  });

  it('asks the source once, then answers from Redis, then from the table once Redis forgets', async () => {
    const text = `King Fahd Road ${run}`;
    const source = countingSource(() => Promise.resolve(located(`${text}, Riyadh`)));
    const service = serviceOn(source);
    const key = geocodeKey({ text, city: 'Riyadh', locale: 'en' });
    written.push(key);

    const first = await service.geocode({ text, city: 'Riyadh', locale: 'en' });
    expect(first).toEqual(located(`${text}, Riyadh`));
    expect(source.calls).toBe(1);
    expect(await rowOf(key)).toEqual({
      method: 'geocode',
      provider: 'hudhud',
      result: located(`${text}, Riyadh`),
      ttl_s: geocodeHitTtlMs / 1000,
    });
    const redisKey = `${redisPrefix}:${key.toString('hex')}`;
    const ttl = await redis.pttl(redisKey);
    expect(ttl).toBeGreaterThan(geocodeHitTtlMs - 60_000);

    // Another spelling of the same address (case, spaces) is the same key: a Redis hit.
    const second = await service.geocode({
      text: `  KING  fahd road ${run.toUpperCase()} `,
      city: 'riyadh',
      locale: 'en',
    });
    expect(second).toEqual(first);
    expect(source.calls).toBe(1);

    // Redis forgets: the table answers, and Redis is filled again.
    await redis.del(redisKey);
    const third = await service.geocode({ text, city: 'Riyadh', locale: 'en' });
    expect(third).toEqual(first);
    expect(source.calls).toBe(1);
    expect(await redis.exists(redisKey)).toBe(1);

    // Without Redis at all, the table alone answers.
    const tableOnly = serviceOn(source, false);
    expect(await tableOnly.geocode({ text, city: 'Riyadh', locale: 'en' })).toEqual(first);
    expect(source.calls).toBe(1);
  });

  it('caches a not_found for 24 hours', async () => {
    const text = `Nowhere Lane ${run}`;
    const source = countingSource(() => Promise.resolve(notFound));
    const service = serviceOn(source);
    const key = geocodeKey({ text, locale: 'ar' });
    written.push(key);
    expect(await service.geocode({ text, locale: 'ar' })).toEqual({ kind: 'not_found' });
    expect(await service.geocode({ text, locale: 'ar' })).toEqual({ kind: 'not_found' });
    expect(source.calls).toBe(1);
    expect(await rowOf(key)).toMatchObject({
      result: { kind: 'not_found' },
      ttl_s: geocodeNotFoundTtlMs / 1000,
    });
  });

  it('turns a provider failure into unavailable for a degraded caller only, caching nothing', async () => {
    const text = `Outage Street ${run}`;
    const source = countingSource(() =>
      Promise.reject(new ProviderFailure('transient', 'planted', { status: 'NETWORK' })),
    );
    const service = serviceOn(source);
    const key = geocodeKey({ text, locale: 'en' });
    expect(await service.geocode({ text, locale: 'en' }, { degraded: true })).toEqual({
      kind: 'unavailable',
      reason: 'transient',
    });
    await expect(service.geocode({ text, locale: 'en' })).rejects.toMatchObject({
      reason: 'transient',
    });
    expect(source.calls).toBe(2);
    expect(await rowOf(key)).toBeUndefined();
    expect(await redis.exists(`${redisPrefix}:${key.toString('hex')}`)).toBe(0);
  });

  it('purges expired rows with one audit row of the count, and none when nothing expired', async () => {
    const expired = [randomBytes(32), randomBytes(32)];
    const live = randomBytes(32);
    written.push(...expired, live);
    for (const key of expired) {
      await owner`
        INSERT INTO core_geocode_cache (key, method, provider, result, created_at, expires_at)
        VALUES (${key}, 'reverse', 'spl', ${owner.json({ kind: 'not_found' })},
                now() - interval '2 days', now() - interval '1 hour')`;
    }
    await owner`
      INSERT INTO core_geocode_cache (key, method, provider, result, expires_at)
      VALUES (${live}, 'shortcode', 'sayyar', ${owner.json({ kind: 'not_found' })},
              now() + interval '1 hour')`;
    const runId = crypto.randomUUID();
    const audit = new AuditWriter(pool);
    expect(await purgeGeocodeCache(pool.db, audit, runId)).toBe(2);
    const remaining = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM core_geocode_cache WHERE encode(key, 'hex') = ANY(${[...expired, live].map((key) => key.toString('hex'))})`;
    expect(remaining[0]?.n).toBe(1);
    const rows = await owner<{ after: unknown; account_id: string | null }[]>`
      SELECT after, account_id FROM core_audit_log
      WHERE action = ${geocodeCachePurgeAuditAction} AND target_id = ${runId}`;
    expect(rows).toEqual([{ after: { rows: 2 }, account_id: null }]);

    const idle = crypto.randomUUID();
    expect(await purgeGeocodeCache(pool.db, audit, idle)).toBe(0);
    const none = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM core_audit_log WHERE target_id = ${idle}`;
    expect(none[0]?.n).toBe(0);
  });

  it('reaches the table only on the platform pool', async () => {
    const rows = await owner<{ role: string; privileges: string | null }[]>`
      SELECT r AS role,
             (SELECT string_agg(p, ',' ORDER BY p) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p
              WHERE has_table_privilege(r, 'core_geocode_cache', p)) AS privileges
      FROM unnest(ARRAY['elx_app', 'elx_platform']) r ORDER BY r`;
    expect(rows).toEqual([
      { role: 'elx_app', privileges: null },
      { role: 'elx_platform', privileges: 'DELETE,INSERT,SELECT,UPDATE' },
    ]);
  });

  it('is provided by the application as GEOCODER, on the stub in local and ci', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({ ...config, geo: { ...config.geo, geocoderSources: ['stub'] } }),
      ],
    }).compile();
    try {
      const geocoder = moduleRef.get<GeocoderService>(GEOCODER, { strict: false });
      expect(await geocoder.lookupShortCode('rema 7572')).toMatchObject({
        kind: 'found',
        provider: 'stub',
        addressEn: 'Al Olaya, Riyadh',
      });
      expect(await geocoder.reverse({ lat: 21.566, lng: 39.154 })).toMatchObject({
        district: 'Al Rawdah',
      });
    } finally {
      await moduleRef.close();
    }
  });
});
