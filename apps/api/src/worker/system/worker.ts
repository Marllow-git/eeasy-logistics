import type { Config } from '@eeasy-logistics/config';
import type { Pool } from '@eeasy-logistics/db';
import { verifyPoolRole } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool, listenOnPlatformPool } from '@eeasy-logistics/db/platform';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { KindHandler } from '../../modules/kernel/outbox/kind-handlers.js';
import { KindHandlerRegistry } from '../../modules/kernel/outbox/kind-handlers.js';
import { OutboxQueues } from '../../modules/kernel/outbox/queues.js';
import { purgeIntervalMs, runIdempotencyPurge } from './idempotency-purge.js';
import { buildKindHandlers } from './kind-handlers.js';
import { OutboxRelay } from './outbox-relay.js';
import { OutboxWorkers } from './outbox-workers.js';

// `--role worker` (platform §2). The system jobs run on timers: the hourly idempotency purge
// (PLAT-6 plan 2.9) and the single-leader outbox relay (PLAT-8 plan 2.3); the outbox queue
// workers (PLAT-8 plan 2.4) consume the queues of the kinds with a handler.

export type WorkerJob = 'idempotency-purge' | 'outbox-relay' | 'outbox-queues';

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
  /** The outbox kind handlers of this build (plan 2.5). */
  readonly kindHandlers: (config: Config, pool: Pool<PlatformDatabase>) => readonly KindHandler[];
  /** Starts the outbox relay on the platform pool, with the lock on `redis` (OUTBOX_RELAY=on). */
  readonly outboxRelay: (
    config: Config,
    pool: Pool<PlatformDatabase>,
    redis: PurgeRedis,
    registry: KindHandlerRegistry,
  ) => Promise<StartedJob>;
  /** Starts one queue worker per kind with a handler; `stop()` drains them (plan 2.9). */
  readonly outboxWorkers: (
    config: Config,
    pool: Pool<PlatformDatabase>,
    registry: KindHandlerRegistry,
  ) => Promise<StartedJob>;
  readonly logger: Pick<Logger, 'log' | 'warn'>;
}

/** The real relay: its own BullMQ connection, the handler registry of this build, LISTEN. */
async function startOutboxRelay(
  config: Config,
  pool: Pool<PlatformDatabase>,
  redis: PurgeRedis,
  registry: KindHandlerRegistry,
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
    registry,
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

/**
 * The real queue workers: their own connection (BullMQ workers need `maxRetriesPerRequest: null`
 * and duplicate it for their blocking reads); `stop()` drains for 30 s, then disconnects.
 */
async function startOutboxWorkers(
  config: Config,
  pool: Pool<PlatformDatabase>,
  registry: KindHandlerRegistry,
): Promise<StartedJob> {
  const connection = new Redis(config.redis.url?.reveal() ?? '', { maxRetriesPerRequest: null });
  connection.on('error', () => undefined);
  const workers = new OutboxWorkers({
    db: pool.db,
    connection,
    registry,
    logger: new Logger('OutboxWorkers'),
  });
  workers.start();
  return Promise.resolve({
    stop: async () => {
      await workers.close();
      connection.disconnect();
    },
  });
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
  kindHandlers: buildKindHandlers,
  outboxRelay: startOutboxRelay,
  outboxWorkers: startOutboxWorkers,
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
      ? 'idempotency purge, outbox relay and outbox queues'
      : 'idempotency purge and outbox queues';
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
  const registry = new KindHandlerRegistry(deps.kindHandlers(config, pool));
  let relay: StartedJob | undefined;
  if (config.outbox.relay) {
    if (redis.status === 'wait') await redis.connect().catch(() => undefined);
    relay = await deps.outboxRelay(config, pool, redis, registry);
    jobs.push('outbox-relay');
    deps.logger.log('Outbox relay started (single leader by Redis lock)');
  } else {
    deps.logger.log('Outbox relay off (OUTBOX_RELAY=off)');
  }
  const queues = await deps.outboxWorkers(config, pool, registry);
  jobs.push('outbox-queues');
  deps.logger.log(`Outbox queue workers started: ${registry.kinds.join(', ') || 'no kind'}`);
  return {
    jobs,
    stop: async () => {
      clearInterval(timer);
      // The relay first (no new jobs), then the workers drain (platform §5), then the clients.
      await relay?.stop();
      await queues.stop();
      redis.disconnect();
      await pool.close();
    },
  };
}
