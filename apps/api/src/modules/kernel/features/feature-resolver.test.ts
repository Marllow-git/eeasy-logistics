import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import type { DomainEvent } from '../outbox/domain-event.js';
import type { RolloutModeValue } from '../schema/rollout.js';
import { FeatureCacheBustConsumer } from './feature-cache.consumer.js';
import type { FeatureCache, FeatureStore } from './feature-resolver.js';
import {
  FeatureResolver,
  featureCacheKeys,
  featureCacheTtlSeconds,
  redisFeatureCache,
} from './feature-resolver.js';
import type { FlagState } from './feature-rules.js';
import { nameAggregateId, rolloutReasonProblem } from './features.service.js';

// The gate's resolver over its cache (PLAT-13 plan 2.5, 2.12): reads cached, invalidated by a
// change and by the `core.feature_flag.changed` consumer; Redis failures fall back to the tables.

const account = '01900000-0000-7000-8000-000000000001';

function memoryCache(): FeatureCache & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: (name) => Promise.resolve(values.get(name)),
    set: (name, value) => {
      values.set(name, value);
      return Promise.resolve();
    },
    delete: (names) => {
      for (const name of names) values.delete(name);
      return Promise.resolve();
    },
  };
}

function tables(initial: { mode?: RolloutModeValue; flag?: FlagState } = {}) {
  const state = { mode: initial.mode, flag: initial.flag };
  const mode = vi.fn(() => Promise.resolve(state.mode));
  const flag = vi.fn(() => Promise.resolve(state.flag));
  const store: FeatureStore = { mode, flag };
  return { state, store, reads: { mode, flag } };
}

const enabled: FlagState = { enabled: true, provisionedBy: 'u1' };

describe('FeatureResolver', () => {
  it('names the cache keys elx:rollout:<key> and elx:feature:<account>:<key>, 60 s', () => {
    expect(featureCacheKeys.rollout('wms')).toBe('elx:rollout:wms');
    expect(featureCacheKeys.flag(account, 'wms')).toBe(`elx:feature:${account}:wms`);
    expect(featureCacheTtlSeconds).toBe(60);
  });

  it('caches the mode and the flag, reads the flag only under allowlist', async () => {
    const { state, store, reads } = tables({ mode: 'allowlist', flag: enabled });
    const cache = memoryCache();
    const resolver = new FeatureResolver(store, cache);
    expect(await resolver.enabled(account, 'delivery')).toBe(true);
    expect(await resolver.enabled(account, 'delivery')).toBe(true);
    expect(reads.mode).toHaveBeenCalledTimes(1);
    expect(reads.flag).toHaveBeenCalledTimes(1);
    expect(cache.values.get('elx:rollout:delivery')).toBe('allowlist');
    expect(cache.values.get(`elx:feature:${account}:delivery`)).toBe('1');

    // A table change is not seen until the cached value is forgotten.
    state.flag = { enabled: false, provisionedBy: null };
    expect(await resolver.enabled(account, 'delivery')).toBe(true);
    await resolver.forgetFlag(account, 'delivery');
    expect(await resolver.enabled(account, 'delivery')).toBe(false);
    expect(reads.flag).toHaveBeenCalledTimes(2);

    state.mode = 'all';
    expect(await resolver.enabled(account, 'delivery')).toBe(false);
    await resolver.forgetRollout('delivery');
    expect(await resolver.enabled(account, 'delivery')).toBe(true);
    state.mode = 'off';
    state.flag = enabled;
    await resolver.forgetRollout('delivery');
    await resolver.forgetFlag(account, 'delivery');
    const flagReads = reads.flag.mock.calls.length;
    expect(await resolver.enabled(account, 'delivery')).toBe(false);
    expect(reads.flag).toHaveBeenCalledTimes(flagReads);
  });

  it('reads a missing rollout row as allowlist and works without a cache', async () => {
    const { store } = tables({});
    const resolver = new FeatureResolver(store, null);
    expect(await resolver.mode('wms')).toBe('allowlist');
    expect(await resolver.enabled(account, 'wms')).toBe(false);
  });

  it('ignores a cached value it does not recognise', async () => {
    const { store } = tables({ mode: 'all' });
    const cache = memoryCache();
    cache.values.set('elx:rollout:wms', 'everything');
    expect(await new FeatureResolver(store, cache).enabled(account, 'wms')).toBe(true);
    expect(cache.values.get('elx:rollout:wms')).toBe('all');
  });

  it('falls back to the tables when Redis fails', async () => {
    const failing = {
      get: vi.fn(() => Promise.reject(new Error('down'))),
      set: vi.fn(() => Promise.reject(new Error('down'))),
      del: vi.fn(() => Promise.reject(new Error('down'))),
    } as unknown as Redis;
    const { store } = tables({ mode: 'allowlist', flag: enabled });
    const resolver = new FeatureResolver(store, redisFeatureCache(failing));
    expect(await resolver.enabled(account, 'wms')).toBe(true);
    await expect(resolver.forgetFlag(account, 'wms')).resolves.toBeUndefined();
  });

  it('writes SET EX 60 to Redis', async () => {
    const set = vi.fn(() => Promise.resolve('OK'));
    const client = {
      get: vi.fn(() => Promise.resolve(null)),
      set,
      del: vi.fn(),
    } as unknown as Redis;
    await new FeatureResolver(tables({ mode: 'all' }).store, redisFeatureCache(client)).mode('wms');
    expect(set).toHaveBeenCalledWith('elx:rollout:wms', 'all', 'EX', 60);
  });
});

describe('FeatureCacheBustConsumer', () => {
  const event = (payload: Record<string, unknown>) =>
    ({ id: 'e1', payload }) as unknown as DomainEvent;

  it('forgets the rollout of a mode change and the flag of a flag change', async () => {
    const cache = memoryCache();
    cache.values.set('elx:rollout:wms', 'off');
    cache.values.set(`elx:feature:${account}:wms`, '0');
    cache.values.set(`elx:feature:${account}:delivery`, '1');
    const consumer = new FeatureCacheBustConsumer(cache);
    await consumer.handle(event({ feature_key: 'wms', mode: 'all' }));
    expect(cache.values.has('elx:rollout:wms')).toBe(false);
    expect(cache.values.has(`elx:feature:${account}:wms`)).toBe(true);
    await consumer.handle(event({ account_id: account, feature_key: 'wms', enabled: true }));
    expect(cache.values.has(`elx:feature:${account}:wms`)).toBe(false);
    expect(cache.values.get(`elx:feature:${account}:delivery`)).toBe('1');
  });

  it('does nothing without a cache', async () => {
    await expect(
      new FeatureCacheBustConsumer(null).handle(event({ feature_key: 'wms' })),
    ).resolves.toBeUndefined();
  });
});

describe('rollout inputs', () => {
  it('bounds the reason to 5 to 500 characters without control characters', () => {
    expect(rolloutReasonProblem('pilot')).toBeUndefined();
    expect(rolloutReasonProblem(' no ')).toBe('too_short');
    expect(rolloutReasonProblem('x'.repeat(501))).toBe('too_long');
    expect(rolloutReasonProblem('two\nlines')).toBe('invalid');
  });

  it('names an aggregate with a stable version 5 UUID', () => {
    const id = nameAggregateId('rollout:wms');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(nameAggregateId('rollout:wms')).toBe(id);
    expect(nameAggregateId('rollout:delivery')).not.toBe(id);
  });
});
