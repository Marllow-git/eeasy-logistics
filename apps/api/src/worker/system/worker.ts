import type { Config } from '@eeasy-logistics/config';
import { verifyPoolRole } from '@eeasy-logistics/db';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { purgeIntervalMs, runIdempotencyPurge } from './idempotency-purge.js';

// `--role worker` (platform §2). Until PLAT-8 brings BullMQ consumers and schedulers, the worker
// runs the system jobs on timers: today only the hourly idempotency purge (PLAT-6 plan 2.9).

export interface RunningWorker {
  stop(): Promise<void>;
}

/**
 * Starts the worker: checks the platform pool's role first (PLAT-6 plan 2.12; a mismatch throws
 * and main.ts exits 78), then runs the purge at once and every hour. Redis failures skip a run
 * with a warning; the next hour tries again.
 */
export async function startWorker(config: Config): Promise<RunningWorker> {
  const logger = new Logger('Worker');
  if (config.redis.url === undefined) throw new Error('REDIS_URL is not configured');
  const pool = createPlatformPool(config.db, 'elx-worker-platform');
  try {
    await verifyPoolRole(pool.db, 'elx_platform');
  } catch (error) {
    await pool.close();
    throw error;
  }
  const redis = new Redis(config.redis.url.reveal(), {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  redis.on('error', () => undefined);

  const tick = async () => {
    try {
      if (redis.status === 'wait') await redis.connect();
      const run = await runIdempotencyPurge(pool.db, redis);
      if (run.ran) logger.log(`Idempotency purge: ${run.deleted} expired keys deleted`);
    } catch (error) {
      logger.warn(
        `Idempotency purge skipped: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  };
  await tick();
  const timer = setInterval(() => void tick(), purgeIntervalMs);
  return {
    stop: async () => {
      clearInterval(timer);
      redis.disconnect();
      await pool.close();
    },
  };
}
