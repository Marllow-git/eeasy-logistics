import type { Config } from '@eeasy-logistics/config';
import type { Pool } from '@eeasy-logistics/db';
import { verifyPoolRole } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { purgeIntervalMs, runIdempotencyPurge } from './idempotency-purge.js';

// `--role worker` (platform §2). Until PLAT-8 brings BullMQ consumers and schedulers, the worker
// runs the system jobs on timers: today only the hourly idempotency purge (PLAT-6 plan 2.9).

export type WorkerJob = 'idempotency-purge';

export interface RunningWorker {
  /** The jobs scheduled; empty when the configuration enables none (outside production). */
  readonly jobs: readonly WorkerJob[];
  stop(): Promise<void>;
}

type PurgeRedis = Pick<Redis, 'set' | 'status' | 'connect' | 'disconnect'>;

/** What the worker builds from the configuration; replaced by doubles in unit tests. */
export interface WorkerDependencies {
  readonly platformPool: (config: Config) => Pool<PlatformDatabase>;
  readonly redis: (config: Config) => PurgeRedis;
  readonly verifyRole: (db: PlatformDatabase) => Promise<void>;
  readonly logger: Pick<Logger, 'log' | 'warn'>;
}

const defaults: WorkerDependencies = {
  platformPool: (config) => createPlatformPool(config.db, 'elx-worker-platform'),
  redis: (config) => {
    const client = new Redis(config.redis.url?.reveal() ?? '', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    client.on('error', () => undefined);
    return client;
  },
  verifyRole: (db) => verifyPoolRole(db, 'elx_platform'),
  logger: new Logger('Worker'),
};

/**
 * Starts the worker with whatever the configuration enables (review round 1, finding 5). The
 * purge needs the platform pool and Redis; when either is missing (allowed outside production,
 * where the config refusals require both) it logs one warning naming the disabled job and the
 * worker boots without it; with no job enabled nothing stays scheduled and the process ends
 * normally (the image probe runs `--role worker` in the foreground). A configured platform pool
 * must be a plain elx_platform login, or this throws and main.ts exits 78 naming the role (plan
 * 2.12). With both, the purge runs at once and every hour; a Redis failure skips one run.
 */
export async function startWorker(
  config: Config,
  overrides: Partial<WorkerDependencies> = {},
): Promise<RunningWorker> {
  const deps = { ...defaults, ...overrides };
  const pool = config.db.urls.platform === undefined ? undefined : deps.platformPool(config);
  if (pool !== undefined) {
    try {
      await deps.verifyRole(pool.db);
    } catch (error) {
      await pool.close();
      throw error;
    }
  }

  const missing = [
    ...(config.redis.url === undefined ? ['REDIS_URL'] : []),
    ...(pool === undefined ? ['DATABASE_URL_PLATFORM'] : []),
  ];
  if (pool === undefined || missing.length > 0) {
    deps.logger.warn(`idempotency purge disabled: ${missing.join(' and ')} not configured`);
    await pool?.close();
    return { jobs: [], stop: () => Promise.resolve() };
  }

  const redis = deps.redis(config);
  const tick = async () => {
    try {
      if (redis.status === 'wait') await redis.connect();
      const run = await runIdempotencyPurge(pool.db, redis);
      if (run.ran) deps.logger.log(`Idempotency purge: ${run.deleted} expired keys deleted`);
    } catch (error) {
      deps.logger.warn(
        `Idempotency purge skipped: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  };
  await tick();
  const timer = setInterval(() => void tick(), purgeIntervalMs);
  deps.logger.log('Idempotency purge scheduled hourly');
  return {
    jobs: ['idempotency-purge'],
    stop: async () => {
      clearInterval(timer);
      redis.disconnect();
      await pool.close();
    },
  };
}
