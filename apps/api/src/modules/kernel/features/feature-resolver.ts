import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { RolloutModeValue } from '../schema/rollout.js';
import { rolloutModes } from '../schema/rollout.js';
import type { FlagState } from './feature-rules.js';
import { featureVisible, flagGrants } from './feature-rules.js';

// The K-6 resolver of the feature gate (PLAT-13 plan 2.5): the rollout mode of a key and an
// account's flag, each read from Redis when cached (`elx:rollout:<key>`, `elx:feature:<account>:
// <key>`, 60 s), else from the tables, then cached. A change deletes the keys (the doors in their
// request, the `core.feature_flag.changed` consumer after commit). Redis is an optimisation only:
// without it, or when it fails, the resolver reads the tables.

export const featureCacheTtlSeconds = 60;

/** The table side: the rollout row of a key and an account's flag row. */
export interface FeatureStore {
  mode(key: string): Promise<RolloutModeValue | undefined>;
  flag(accountId: string, key: string): Promise<FlagState | undefined>;
}

/** Text values under named keys with a time to live; a failure is a miss, never an error. */
export interface FeatureCache {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  delete(names: readonly string[]): Promise<void>;
}

/** The cache key names (plan 2.5). `prefix` is `elx` outside tests. */
export const featureCacheKeys = {
  rollout: (key: string, prefix = 'elx') => `${prefix}:rollout:${key}`,
  flag: (accountId: string, key: string, prefix = 'elx') => `${prefix}:feature:${accountId}:${key}`,
};

const modes: ReadonlySet<string> = new Set(rolloutModes);

export class FeatureResolver {
  constructor(
    private readonly store: FeatureStore,
    private readonly cache: FeatureCache | null,
    private readonly prefix = 'elx',
  ) {}

  /** The rollout mode of `key` (`allowlist` when no row exists). */
  async mode(key: string): Promise<RolloutModeValue> {
    const name = featureCacheKeys.rollout(key, this.prefix);
    const cached = await this.cache?.get(name);
    if (cached !== undefined && modes.has(cached)) return cached as RolloutModeValue;
    const mode = (await this.store.mode(key)) ?? 'allowlist';
    await this.cache?.set(name, mode);
    return mode;
  }

  /** Whether the account's flag of `key` counts under `allowlist` (enabled, `provisioned_by`). */
  async flagGrants(accountId: string, key: string): Promise<boolean> {
    const name = featureCacheKeys.flag(accountId, key, this.prefix);
    const cached = await this.cache?.get(name);
    if (cached === '1' || cached === '0') return cached === '1';
    const grants = flagGrants(await this.store.flag(accountId, key));
    await this.cache?.set(name, grants ? '1' : '0');
    return grants;
  }

  /** K-6 for one account and key; the flag is read only under `allowlist`. */
  async enabled(accountId: string, key: string): Promise<boolean> {
    const mode = await this.mode(key);
    if (mode !== 'allowlist') return featureVisible(mode, undefined);
    return this.flagGrants(accountId, key);
  }

  /** Forgets the cached mode of `key` (a rollout change). */
  async forgetRollout(key: string): Promise<void> {
    await this.cache?.delete([featureCacheKeys.rollout(key, this.prefix)]);
  }

  /** Forgets the cached flag of an account and key (a flag change). */
  async forgetFlag(accountId: string, key: string): Promise<void> {
    await this.cache?.delete([featureCacheKeys.flag(accountId, key, this.prefix)]);
  }
}

/**
 * The cache on a Redis connection: `SET … EX 60`, `GET`, `DEL`. Every command failure is a miss
 * (or a skipped write), logged at most once a minute, so a Redis outage falls back to the tables.
 */
export function redisFeatureCache(client: Redis): FeatureCache {
  const logger = new Logger('FeatureCache');
  let loggedAt = 0;
  const failed = (error: unknown) => {
    const now = Date.now();
    if (now - loggedAt < 60_000) return;
    loggedAt = now;
    logger.warn(`Feature cache unavailable, reading the tables: ${(error as Error).name}`);
  };
  return {
    async get(name) {
      try {
        return (await client.get(name)) ?? undefined;
      } catch (error) {
        failed(error);
        return undefined;
      }
    },
    async set(name, value) {
      try {
        await client.set(name, value, 'EX', featureCacheTtlSeconds);
      } catch (error) {
        failed(error);
      }
    },
    async delete(names) {
      if (names.length === 0) return;
      try {
        await client.del(...names);
      } catch (error) {
        failed(error);
      }
    },
  };
}
