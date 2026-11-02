import { describe, expect, it } from 'vitest';
import { ProviderFailure } from '../outbox/provider-failure.js';
import { ChainGeocoder } from './chain-geocoder.js';
import type {
  GeocodeResult,
  GeocoderProviderName,
  GeocoderSource,
  NotFound,
  ShortCodeResult,
} from './geocoder.js';
import { notFound } from './geocoder.js';
import { SourceBreaker, memoryBreakerStore } from './source-breaker.js';

// INT-2 plan 2.10, 2.11: the chain's order and fallthrough, and the breaker per source.

type Step = 'found' | 'not_found' | 'timeout' | 'network' | 'server' | 'refused' | 'slow';

const failureFor: Record<Exclude<Step, 'found' | 'not_found' | 'slow'>, () => ProviderFailure> = {
  timeout: () => new ProviderFailure('transient', 'timed out', { status: 'TIMEOUT' }),
  network: () => new ProviderFailure('transient', 'unreachable', { status: 'NETWORK' }),
  server: () => new ProviderFailure('transient', 'failed', { status: 503 }),
  refused: () => new ProviderFailure('unauthorised', 'refused', { status: 401 }),
};

/** A scripted source: each call takes the next step (the last one repeats). */
function scripted(provider: GeocoderProviderName, steps: Step[], calls: string[]) {
  let index = 0;
  const run = async <T>(found: T): Promise<T | NotFound> => {
    calls.push(provider);
    const step = steps[Math.min(index, steps.length - 1)]!;
    index += 1;
    if (step === 'found') return found;
    if (step === 'not_found') return notFound;
    if (step === 'slow') return new Promise<T>(() => undefined);
    throw failureFor[step]();
  };
  const place: GeocodeResult = {
    kind: 'found',
    point: { lat: 24.7, lng: 46.7 },
    confidence: 0.8,
    formatted: provider,
    provider,
  };
  const code: ShortCodeResult = {
    kind: 'found',
    point: { lat: 24.7, lng: 46.7 },
    confidence: 1,
    addressAr: provider,
    addressEn: provider,
    shortCode: 'REMA7572',
    provider,
  };
  return {
    provider,
    geocode: () => run(place),
    lookupShortCode: () => run(code),
  } satisfies GeocoderSource;
}

function chain(sources: GeocoderSource[], clock = { now: 0 }, deadlineMs?: number) {
  const now = () => clock.now;
  return new ChainGeocoder({
    sources,
    breaker: new SourceBreaker(memoryBreakerStore(now), { now }),
    now,
    ...(deadlineMs === undefined ? {} : { deadlineMs }),
  });
}

async function failureOf(promise: Promise<unknown>): Promise<ProviderFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProviderFailure) return error;
    throw error;
  }
  throw new Error('expected a ProviderFailure');
}

const query = { text: 'Al Olaya', locale: 'en' } as const;

describe('ChainGeocoder', () => {
  it('asks the sources in order and takes the first answer', async () => {
    const calls: string[] = [];
    const geocoder = chain([
      scripted('spl', ['found'], calls),
      scripted('sayyar', ['found'], calls),
    ]);
    expect(await geocoder.lookupShortCode('REMA7572')).toMatchObject({
      source: 'spl',
      answer: { provider: 'spl' },
    });
    expect(calls).toEqual(['spl']);
  });

  it("moves on after a source's not_found, and answers not_found only when every source said so", async () => {
    const calls: string[] = [];
    const geocoder = chain([
      scripted('spl', ['not_found'], calls),
      scripted('sayyar', ['not_found', 'found'], calls),
      scripted('hudhud', ['not_found'], calls),
    ]);
    expect(await geocoder.lookupShortCode('REMA7572')).toEqual({
      answer: { kind: 'not_found' },
      source: 'hudhud',
    });
    expect(await geocoder.lookupShortCode('REMA7572')).toMatchObject({ source: 'sayyar' });
    expect(calls).toEqual(['spl', 'sayyar', 'hudhud', 'spl', 'sayyar']);
  });

  it('moves on after a failure of any kind', async () => {
    for (const step of ['timeout', 'network', 'server', 'refused'] as const) {
      const calls: string[] = [];
      const geocoder = chain([
        scripted('sayyar', [step], calls),
        scripted('hudhud', ['found'], calls),
      ]);
      expect(await geocoder.geocode(query)).toMatchObject({ source: 'hudhud' });
      expect(calls).toEqual(['sayyar', 'hudhud']);
    }
  });

  it('raises the last failure when no source answered, or one failed and the rest said not found', async () => {
    const calls: string[] = [];
    const failing = chain([
      scripted('sayyar', ['timeout'], calls),
      scripted('hudhud', ['refused'], calls),
    ]);
    expect(await failureOf(failing.geocode(query))).toMatchObject({ reason: 'unauthorised' });
    const uncertain = chain([
      scripted('sayyar', ['server'], calls),
      scripted('hudhud', ['not_found'], calls),
    ]);
    expect(await failureOf(uncertain.geocode(query))).toMatchObject({
      reason: 'transient',
      status: 503,
    });
  });

  it('asks a source only for the lookups it has', async () => {
    const calls: string[] = [];
    const reverseOnly: GeocoderSource = {
      provider: 'spl',
      reverse: () => Promise.resolve({ kind: 'found', formatted: 'x', provider: 'spl' }),
    };
    const geocoder = chain([reverseOnly, scripted('sayyar', ['found'], calls)]);
    expect(geocoder.sourcesFor('geocode')).toEqual(['sayyar']);
    expect(geocoder.sourcesFor('reverse')).toEqual(['spl']);
    expect(geocoder.sourcesFor('shortcode')).toEqual(['sayyar']);
    expect(await geocoder.reverse({ lat: 24.7, lng: 46.7 })).toMatchObject({ source: 'spl' });
  });

  it('refuses a lookup no source has', async () => {
    expect(await failureOf(chain([]).reverse({ lat: 1, lng: 1 }))).toMatchObject({
      reason: 'permanent',
      status: 'NO_SOURCE',
    });
  });

  it('caps the whole chain and moves on from a source that does not answer', async () => {
    const calls: string[] = [];
    const geocoder = new ChainGeocoder({
      sources: [scripted('sayyar', ['slow'], calls), scripted('hudhud', ['found'], calls)],
      breaker: new SourceBreaker(memoryBreakerStore()),
      deadlineMs: 50,
    });
    // The first source used the whole budget: the chain stops with a timeout.
    expect(await failureOf(geocoder.geocode(query))).toMatchObject({
      reason: 'transient',
      status: 'TIMEOUT',
    });
    expect(calls).toEqual(['sayyar']);
  });

  it("caps a lookup at the caller's deadline below the chain's own (DEL-2 intake, 2 s)", async () => {
    const calls: string[] = [];
    const geocoder = new ChainGeocoder({
      sources: [scripted('sayyar', ['slow'], calls)],
      breaker: new SourceBreaker(memoryBreakerStore()),
    });
    const started = Date.now();
    expect(await failureOf(geocoder.geocode(query, 40))).toMatchObject({ status: 'TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(calls).toEqual(['sayyar']);
  });
});

describe('the source breaker in the chain', () => {
  it('opens after three timeouts in a minute, skips the source, then lets one probe through', async () => {
    const clock = { now: 0 };
    const calls: string[] = [];
    const geocoder = chain(
      [
        scripted('spl', ['timeout', 'timeout', 'timeout', 'found'], calls),
        scripted('sayyar', ['found'], calls),
      ],
      clock,
    );
    for (let n = 0; n < 3; n += 1) {
      expect(await geocoder.lookupShortCode('REMA7572')).toMatchObject({ source: 'sayyar' });
      clock.now += 1_000;
    }
    expect(calls.filter((name) => name === 'spl')).toHaveLength(3);
    // Open: spl is skipped for two minutes.
    calls.length = 0;
    expect(await geocoder.lookupShortCode('REMA7572')).toMatchObject({ source: 'sayyar' });
    expect(calls).toEqual(['sayyar']);
    clock.now += 118_000;
    calls.length = 0;
    await geocoder.lookupShortCode('REMA7572');
    expect(calls).toEqual(['sayyar']);
    // Half-open after the period: one probe passes, answers, and closes the breaker.
    clock.now += 2_000;
    calls.length = 0;
    expect(await geocoder.lookupShortCode('REMA7572')).toMatchObject({ source: 'spl' });
    expect(calls).toEqual(['spl']);
    expect(await geocoder.lookupShortCode('REMA7572')).toMatchObject({ source: 'spl' });
  });

  it('does not open on timeouts spread beyond the window, nor on 5xx answers', async () => {
    const clock = { now: 0 };
    const calls: string[] = [];
    const geocoder = chain(
      [scripted('spl', ['timeout'], calls), scripted('sayyar', ['found'], calls)],
      clock,
    );
    for (let n = 0; n < 4; n += 1) {
      await geocoder.lookupShortCode('REMA7572');
      clock.now += 31_000;
    }
    expect(calls.filter((name) => name === 'spl')).toHaveLength(4);
    const serverCalls: string[] = [];
    const flaky = chain(
      [scripted('spl', ['server'], serverCalls), scripted('sayyar', ['found'], serverCalls)],
      { now: 0 },
    );
    for (let n = 0; n < 5; n += 1) await flaky.lookupShortCode('REMA7572');
    expect(serverCalls.filter((name) => name === 'spl')).toHaveLength(5);
  });

  it('re-opens at once when the half-open probe times out', async () => {
    const clock = { now: 0 };
    const calls: string[] = [];
    const geocoder = chain(
      [scripted('spl', ['timeout'], calls), scripted('sayyar', ['found'], calls)],
      clock,
    );
    for (let n = 0; n < 3; n += 1) await geocoder.lookupShortCode('REMA7572');
    clock.now += 121_000;
    calls.length = 0;
    await geocoder.lookupShortCode('REMA7572');
    expect(calls).toEqual(['spl', 'sayyar']);
    calls.length = 0;
    clock.now += 1_000;
    await geocoder.lookupShortCode('REMA7572');
    expect(calls).toEqual(['sayyar']);
  });
});
