import { describe, expect, it } from 'vitest';
import { ProviderFailure } from '../outbox/provider-failure.js';
import type { GeocodeCacheEntry, GeocodeCacheStore } from '../platform/geocode-cache.repository.js';
import { ChainGeocoder } from './chain-geocoder.js';
import { GeocoderInputError } from './geocoder.js';
import { GeocoderService } from './geocoder.service.js';
import { SourceBreaker, memoryBreakerStore } from './source-breaker.js';
import { StubGeocoder } from './stub-geocoder.js';

// INT-2 plan 2.6, 2.8: the service's validation, the disabled and no-source answers, the degraded
// path, the stub never cached, a failing cache never failing a lookup, and logs that carry only
// the method, the outcome and a key prefix. The cache itself runs on the database and Redis in
// test/integration/geocoder.test.ts.

const chainOf = (stub: StubGeocoder) =>
  new ChainGeocoder({ sources: [stub], breaker: new SourceBreaker(memoryBreakerStore()) });

function recordingCache(): GeocodeCacheStore & { writes: GeocodeCacheEntry[] } {
  const writes: GeocodeCacheEntry[] = [];
  return {
    writes,
    read: () => Promise.resolve(undefined),
    write: (entry) => {
      writes.push(entry);
      return Promise.resolve();
    },
  };
}

function recordingLogger() {
  const lines: string[] = [];
  return { lines, warn: (line: string) => void lines.push(line) };
}

describe('GeocoderService', () => {
  const stub = new StubGeocoder();
  const service = new GeocoderService({ chain: chainOf(stub) });

  it.each([
    ['an empty text', { text: '   ', locale: 'en' }],
    ['a text over 500 characters', { text: 'a'.repeat(501), locale: 'en' }],
    ['a text of two lines', { text: 'Al Olaya\nRiyadh', locale: 'en' }],
    ['a city over 120 characters', { text: 'Al Olaya', city: 'c'.repeat(121), locale: 'en' }],
    ['a city of two lines', { text: 'Al Olaya', city: 'Riyadh\r\nKSA', locale: 'en' }],
    ['an unknown locale', { text: 'Al Olaya', locale: 'fr' }],
  ])('refuses %s', async (_name, query) => {
    await expect(service.geocode(query as never)).rejects.toBeInstanceOf(GeocoderInputError);
  });

  it('refuses a malformed short code and a point out of range', async () => {
    await expect(service.lookupShortCode('REMA757')).rejects.toMatchObject({ field: 'code' });
    for (const point of [
      { lat: 91, lng: 46 },
      { lat: 24, lng: -181 },
      { lat: Number.NaN, lng: 46 },
    ]) {
      await expect(service.reverse(point)).rejects.toMatchObject({ field: 'point' });
    }
  });

  it('answers through the chain, a text of exactly 500 characters included', async () => {
    expect(await service.geocode({ text: 'حي العليا', locale: 'ar' })).toMatchObject({
      kind: 'found',
      provider: 'stub',
    });
    expect(
      await service.geocode({ text: `Al Olaya ${'x'.repeat(491)}`, locale: 'en' }),
    ).toMatchObject({ kind: 'found' });
  });

  it('never caches the stub', async () => {
    const cache = recordingCache();
    const cached = new GeocoderService({ chain: chainOf(new StubGeocoder()), cache });
    await cached.lookupShortCode('REMA7572');
    await cached.geocode({ text: 'nowhere special', locale: 'en' });
    expect(cache.writes).toEqual([]);
  });

  it('answers unavailable everywhere when disabled, and without a source', async () => {
    const disabled = new GeocoderService({ chain: chainOf(stub), disabled: true });
    expect(await disabled.lookupShortCode('REMA7572')).toEqual({
      kind: 'unavailable',
      reason: 'disabled',
    });
    expect(await new GeocoderService().reverse({ lat: 24.7, lng: 46.7 })).toEqual({
      kind: 'unavailable',
      reason: 'no_source',
    });
  });

  it('gives a degraded caller unavailable and any other caller the failure, logging no input', async () => {
    const failing = new StubGeocoder();
    const logger = recordingLogger();
    const degradedService = new GeocoderService({ chain: chainOf(failing), logger });
    failing.failNext(new ProviderFailure('unauthorised', 'refused', { status: 401 }));
    expect(
      await degradedService.geocode({ text: 'Secret Lane 7', locale: 'en' }, { degraded: true }),
    ).toEqual({ kind: 'unavailable', reason: 'unauthorised' });
    failing.failNext(new ProviderFailure('transient', 'down', { status: 'NETWORK' }));
    await expect(
      degradedService.geocode({ text: 'Secret Lane 7', locale: 'en' }),
    ).rejects.toBeInstanceOf(ProviderFailure);
    expect(logger.lines).toHaveLength(2);
    for (const line of logger.lines) {
      expect(line).toMatch(/^geocoder lookup failed method=geocode outcome=\w+ key=[0-9a-f]{8}$/);
      expect(line).not.toContain('Secret');
    }
  });

  it('skips a failing cache and still answers', async () => {
    const logger = recordingLogger();
    const broken: GeocodeCacheStore = {
      read: () => Promise.reject(new Error('database down')),
      write: () => Promise.reject(new Error('database down')),
    };
    const brokenRedis = {
      get: () => Promise.reject(new Error('redis down')),
      set: () => Promise.reject(new Error('redis down')),
    };
    const resilient = new GeocoderService({
      chain: chainOf(new StubGeocoder()),
      cache: broken,
      redis: brokenRedis,
      logger,
    });
    expect(await resilient.lookupShortCode('JSFA1188')).toMatchObject({ kind: 'found' });
    expect(logger.lines.every((line) => !line.includes('JSFA'))).toBe(true);
  });
});
