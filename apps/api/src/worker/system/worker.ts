import type { Config } from '@eeasy-logistics/config';
import type { Pool } from '@eeasy-logistics/db';
import { verifyPoolRole } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool, listenOnPlatformPool } from '@eeasy-logistics/db/platform';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { KindHandlerRegistry, kindHandlers } from '../../modules/kernel/outbox/kind-handlers.js';
import { OutboxQueues } from '../../modules/kernel/outbox/queues.js';
import { purgeIntervalMs, runIdempotencyPurge } from './idempotency-purge.js';
import { OutboxRelay } from './outbox-relay.js';

// `--role worker` (platform §2). The system jobs run on timers: the hourly idempotency purge
// (PLAT-6 plan 2.9) and the single-leader outbox relay (PLAT-8 plan 2.3); PLAT-8 leg 2 adds the
// queue workers.

export type WorkerJob = 'idempotency-purge' | 'outbox-relay';

/** A started background job: stopped on shutdown. */
export interface StartedJob {
  stop(): Promise<void>;
}

export interface RunningWorker {
  /** The jobs scheduled; empty when the configuration enables none (outside production). */
  readonly jobs: readonly WorkerJob[];
  stop(): Promise<void>;
}

type PurgeRedis = Pick<Redis, 'set' | 'eval' | 'status' | 'connect' | 'disconnect'>;

/** What the worker builds from the configuration; replaced by doubles in unit tests. */
export interface WorkerDependencies {
  readonly platformPool: (config: Config) => Pool<PlatformDatabase>;
  readonly redis: (config: Config) => PurgeRedis;
  readonly verifyRole: (db: PlatformDatabase) => Promise<void>;
  /** Starts the outbox relay on the platform pool, with the lock on `redis` (OUTBOX_RELAY=on). */
  readonly outboxRelay: (
    config: Config,
    pool: Pool<PlatformDatabase>,
    redis: PurgeRedis,
  ) => Promise<StartedJob>;
  readonly logger: Pick<Logger, 'log' | 'warn'>;
}

/** The real relay: its own BullMQ connection, the handler registry of this build, LISTEN. */
async function startOutboxRelay(
  config: Config,
  pool: Pool<PlatformDatabase>,
  redis: PurgeRedis,
): Promise<StartedJob> {
  const connection = new Redis(config.redis.url?.reveal() ?? '', {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  connection.on('error', () => undefined);
  const queues = new OutboxQueues(connection);
  const relay = new OutboxRelay({
    db: pool.db,
    queues,
    registry: new KindHandlerRegistry(kindHandlers),
    redis,
    listen: (onNotify) => listenOnPlatformPool(pool.db, 'elx_outbox', onNotify),
    batchSize: config.outbox.relayBatch,
    logger: new Logger('OutboxRelay'),
  });
  await relay.start();
  return {
    stop: async () => {
      await relay.stop();
      await queues.close();
      connection.disconnect();
    },
  };
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
  outboxRelay: startOutboxRelay,
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
    const disabled = config.outbox.relay
      ? 'idempotency purge and outbox relay'
      : 'idempotency purge';
    deps.logger.warn(`${disabled} disabled: ${missing.join(' and ')} not configured`);
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
  const jobs: WorkerJob[] = ['idempotency-purge'];
  let relay: StartedJob | undefined;
  if (config.outbox.relay) {
    if (redis.status === 'wait') await redis.connect().catch(() => undefined);
    relay = await deps.outboxRelay(config, pool, redis);
    jobs.push('outbox-relay');
    deps.logger.log('Outbox relay started (single leader by Redis lock)');
  } else {
    deps.logger.log('Outbox relay off (OUTBOX_RELAY=off)');
  }
  return {
    jobs,
    stop: async () => {
      clearInterval(timer);
      await relay?.stop();
      redis.disconnect();
      await pool.close();
    },
  };
}
