import { describe, expect, it } from 'vitest';
import type { BreakerStore } from './source-breaker.js';
import { SourceBreaker, memoryBreakerStore, redisBreakerStore } from './source-breaker.js';

// INT-2 plan 2.11: the breaker's states on the memory store, the Redis store's commands on a fake
// client (the integration suite runs it on Redis), and a failing store never blocking a lookup.

/** A fake of the five Redis commands the store uses, with expiry on a clock. */
function fakeRedis(clock: { now: number }) {
  const values = new Map<string, { value: string; expires: number }>();
  const live = (key: string) => {
    const entry = values.get(key);
    if (entry !== undefined && entry.expires <= clock.now) values.delete(key);
    return values.get(key);
  };
  return {
    values,
    incr: (key: string) => {
      const next = Number(live(key)?.value ?? '0') + 1;
      values.set(key, { value: String(next), expires: live(key)?.expires ?? Infinity });
      return Promise.resolve(next);
    },
    pexpire: (key: string, ms: number) => {
      const entry = live(key);
      if (entry !== undefined) entry.expires = clock.now + ms;
      return Promise.resolve(entry === undefined ? 0 : 1);
    },
    get: (key: string) => Promise.resolve(live(key)?.value ?? null),
    set: (key: string, value: string, _px: 'PX', ms: number, nx?: 'NX') => {
      if (nx === 'NX' && live(key) !== undefined) return Promise.resolve(null);
      values.set(key, { value, expires: clock.now + ms });
      return Promise.resolve('OK');
    },
    del: (...keys: string[]) => {
      let n = 0;
      for (const key of keys) if (values.delete(key)) n += 1;
      return Promise.resolve(n);
    },
  };
}

describe.each([
  ['memory', (clock: { now: number }) => memoryBreakerStore(() => clock.now)],
  [
    'redis',
    (clock: { now: number }) =>
      redisBreakerStore(fakeRedis(clock) as unknown as Parameters<typeof redisBreakerStore>[0]),
  ],
])('SourceBreaker on the %s store', (_name, makeStore) => {
  const setup = () => {
    const clock = { now: 1_000_000 };
    const breaker = new SourceBreaker(makeStore(clock), { now: () => clock.now });
    return { clock, breaker };
  };

  it('stays closed below three outages in the window', async () => {
    const { breaker } = setup();
    await breaker.outage('spl');
    await breaker.outage('spl');
    expect(await breaker.admit('spl')).toBe(true);
  });

  it('opens at three for two minutes, then admits exactly one probe', async () => {
    const { clock, breaker } = setup();
    for (let n = 0; n < 3; n += 1) await breaker.outage('spl');
    expect(await breaker.admit('spl')).toBe(false);
    expect(await breaker.admit('sayyar')).toBe(true);
    clock.now += 120_001;
    expect(await breaker.admit('spl')).toBe(true);
    expect(await breaker.admit('spl')).toBe(false);
    await breaker.reachable('spl');
    expect(await breaker.admit('spl')).toBe(true);
    expect(await breaker.admit('spl')).toBe(true);
  });

  it('re-opens on an outage during the probe', async () => {
    const { clock, breaker } = setup();
    for (let n = 0; n < 3; n += 1) await breaker.outage('spl');
    clock.now += 120_001;
    expect(await breaker.admit('spl')).toBe(true);
    await breaker.outage('spl');
    expect(await breaker.admit('spl')).toBe(false);
  });

  it('forgets outages outside the minute window', async () => {
    const { clock, breaker } = setup();
    await breaker.outage('spl');
    await breaker.outage('spl');
    clock.now += 60_001;
    await breaker.outage('spl');
    expect(await breaker.admit('spl')).toBe(true);
  });
});

describe('SourceBreaker with a failing store', () => {
  it('admits the call and swallows the error', async () => {
    const broken: BreakerStore = {
      countOutage: () => Promise.reject(new Error('redis down')),
      openUntil: () => Promise.reject(new Error('redis down')),
      open: () => Promise.reject(new Error('redis down')),
      close: () => Promise.reject(new Error('redis down')),
      claimProbe: () => Promise.reject(new Error('redis down')),
    };
    const breaker = new SourceBreaker(broken);
    expect(await breaker.admit('spl')).toBe(true);
    await expect(breaker.outage('spl')).resolves.toBeUndefined();
    await expect(breaker.reachable('spl')).resolves.toBeUndefined();
  });
});
