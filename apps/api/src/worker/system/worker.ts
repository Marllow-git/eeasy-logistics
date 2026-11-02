import type { Config } from '@eeasy-logistics/config';
import type { AppDatabase, Pool } from '@eeasy-logistics/db';
import { createAppPool, verifyPoolRole } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool, listenOnPlatformPool } from '@eeasy-logistics/db/platform';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AuditWriter } from '../../modules/kernel/audit/audit-writer.js';
import type { KindHandler } from '../../modules/kernel/outbox/kind-handlers.js';
import { KindHandlerRegistry } from '../../modules/kernel/outbox/kind-handlers.js';
import { OutboxQueues } from '../../modules/kernel/outbox/queues.js';
import { getMetrics } from '../../modules/kernel/telemetry/metrics.js';
import { purgeIntervalMs, runIdempotencyPurge } from './idempotency-purge.js';
import { gaugeIntervalMs, runOutboxGauges } from './outbox-gauges.js';
import { buildKindHandlers } from './kind-handlers.js';
import type { PruneRun } from './outbox-prune.js';
import { pruneIntervalMs, runOutboxPrune } from './outbox-prune.js';
import { OutboxRelay } from './outbox-relay.js';
import { OutboxWorkers } from './outbox-workers.js';
import type { OtpPurgeRun } from './otp-purge.js';
import { otpPurgeIntervalMs, runOtpPurge } from './otp-purge.js';
import { PushKindHandler } from '../../modules/kernel/push/push.handler.js';
import type { PushReceiptsRun } from './push-receipts.js';
import { pushReceiptsIntervalMs, runPushReceipts } from './push-receipts.js';
import type { ShiftSweeperRun } from './shift-sweeper.js';
import { runShiftSweeper, shiftSweeperIntervalMs } from './shift-sweeper.js';
import type { RetentionRun } from './telemetry-retention.js';
import { retentionTickMs, runTelemetryRetention } from './telemetry-retention.js';
import type { TrailAppenderRun } from './trail-appender.js';
import { runTrailAppender, trailAppenderIntervalMs } from './trail-appender.js';

// `--role worker` (platform §2). The system jobs run on timers: the hourly idempotency purge
// (PLAT-6 plan 2.9) and the single-leader outbox relay (PLAT-8 plan 2.3); the outbox queue
// workers (PLAT-8 plan 2.4) consume the queues of the kinds with a handler.

export type WorkerJob =
  | 'idempotency-purge'
  | 'otp-purge'
  | 'outbox-prune'
  | 'outbox-relay'
  | 'outbox-queues'
  | 'outbox-gauges'
  | 'push-receipts'
  | 'trail-appender'
  | 'telemetry-retention'
  | 'shift-sweeper';

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
  /** The `elx_app` pool internal consumers run on (adversary M-3); only with `DATABASE_URL_APP`. */
  readonly appPool: (config: Config) => Pool<AppDatabase>;
  readonly redis: (config: Config) => PurgeRedis;
  readonly verifyRole: (db: PlatformDatabase) => Promise<void>;
  /** The outbox kind handlers of this build (plan 2.5). */
  readonly kindHandlers: (
    config: Config,
    pool: Pool<PlatformDatabase>,
    app: Pool<AppDatabase> | undefined,
  ) => readonly KindHandler[];
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
  /** One hourly OTP purge under its Redis lock, with its audit row (PLAT-9 plan 2.6). */
  readonly otpPurge: (pool: Pool<PlatformDatabase>, redis: PurgeRedis) => Promise<OtpPurgeRun>;
  /** One daily outbox pruning run under its Redis lock (OUTBOX_PRUNE=on, plan 2.8). */
  readonly outboxPrune: (db: PlatformDatabase, redis: PurgeRedis) => Promise<PruneRun>;
  readonly logger: Pick<Logger, 'log' | 'warn'>;
  /** One outbox gauge run: one query, values stored for the next metric export (PLAT-14). */
  readonly outboxGauges: (db: PlatformDatabase) => Promise<void>;
  /** One push receipts run under its Redis lock, with the push handler's adapter (INT-4 2.4). */
  readonly pushReceipts: (
    pool: Pool<PlatformDatabase>,
    redis: PurgeRedis,
    push: PushKindHandler,
  ) => Promise<PushReceiptsRun>;
  /** DEL-5 plan 2.8: one trail appender run under its lock (scan on platform, writes on elx_app). */
  readonly trailAppender: (
    pool: Pool<PlatformDatabase>,
    app: Pool<AppDatabase>,
    redis: PurgeRedis,
  ) => Promise<TrailAppenderRun>;
  /** DEL-5 plan 2.8: one retention tick (runs only in the 03:00 hour in Riyadh, under its lock). */
  readonly telemetryRetention: (
    pool: Pool<PlatformDatabase>,
    app: Pool<AppDatabase>,
    redis: PurgeRedis,
  ) => Promise<RetentionRun>;
  /** DEL-5 plan 2.5, 2.8: one shift sweep (no-shows, stale alerts) under its lock. */
  readonly shiftSweeper: (
    pool: Pool<PlatformDatabase>,
    app: Pool<AppDatabase>,
    redis: PurgeRedis,
  ) => Promise<ShiftSweeperRun>;
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
    audit: new AuditWriter(pool),
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
  appPool: (config) => createAppPool(config.db, 'elx-worker-app'),
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
  outboxPrune: (db, redis) => runOutboxPrune(db, redis),
  otpPurge: (pool, redis) => runOtpPurge(pool.db, redis, new AuditWriter(pool)),
  outboxGauges: (db) => runOutboxGauges(db, getMetrics(), new Logger('OutboxGauges')),
  pushReceipts: (pool, redis, push) =>
    runPushReceipts({
      db: pool.db,
      redis,
      sender: push.sender,
      invalidations: push.invalidations,
      audit: new AuditWriter(pool),
      logger: new Logger('PushReceipts'),
    }),
  trailAppender: (pool, app, redis) =>
    runTrailAppender({ db: pool.db, app: app.db, redis, logger: new Logger('TrailAppender') }),
  telemetryRetention: (pool, app, redis) =>
    runTelemetryRetention({
      db: pool.db,
      app: app.db,
      redis,
      logger: new Logger('TelemetryRetention'),
    }),
  shiftSweeper: (pool, app, redis) =>
    runShiftSweeper({ db: pool.db, app: app.db, redis, logger: new Logger('ShiftSweeper') }),
  logger: new Logger('Worker'),
};

/** A job run at once and then every `intervalMs`; a failure is one warning and one skipped run. */
function every(
  intervalMs: number,
  name: string,
  logger: Pick<Logger, 'warn'>,
  run: () => Promise<void>,
): { first: Promise<void>; timer: NodeJS.Timeout } {
  const tick = async () => {
    try {
      await run();
    } catch (error) {
      logger.warn(`${name} skipped: ${error instanceof Error ? error.name : 'unknown error'}`);
    }
  };
  return { first: tick(), timer: setInterval(() => void tick(), intervalMs) };
}

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
    const names = [
      'idempotency purge',
      ...(config.outbox.relay ? ['outbox relay'] : []),
      ...(config.outbox.prune ? ['outbox prune'] : []),
    ];
    const disabled = `${names.join(', ')} and outbox queues`;
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
  // PLAT-9 plan 2.6: OTP rows, challenges and callback nonces, at once and every hour.
  const otpPurge = async () => {
    try {
      if (redis.status === 'wait') await redis.connect();
      const run = await deps.otpPurge(pool, redis);
      if (run.ran) {
        const c = run.counts;
        deps.logger.log(
          `OTP purge: ${c.messages} message rows, ${c.challenges} challenges, ${c.nonces} callback nonces deleted`,
        );
        const a = run.auth;
        if (a !== undefined) {
          deps.logger.log(
            `Auth purge: ${a.refreshTokens} refresh tokens, ${a.invitations} invitations, ${a.passwordResets} resets, ${a.challenges} challenges deleted; ${a.successorsCleared} kept successors cleared`,
          );
        }
      }
    } catch (error) {
      deps.logger.warn(
        `OTP purge skipped: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  };
  await otpPurge();
  const otpTimer = setInterval(() => void otpPurge(), otpPurgeIntervalMs);
  jobs.push('otp-purge');
  deps.logger.log('OTP purge scheduled hourly');
  let pruneTimer: NodeJS.Timeout | undefined;
  if (config.outbox.prune) {
    // Daily (plan 2.8): at boot, then every 24 h; the 23 h lock lets one worker a day run it.
    const prune = async () => {
      try {
        if (redis.status === 'wait') await redis.connect();
        const run = await deps.outboxPrune(pool.db, redis);
        if (run.ran) {
          const c = run.counts;
          deps.logger.log(
            `Outbox prune: ${c.finished} done or superseded rows, ${c.dead} dead rows, ` +
              `${c.receipts} receipts, ${c.deadLetters} dead letters deleted`,
          );
        }
      } catch (error) {
        deps.logger.warn(
          `Outbox prune skipped: ${error instanceof Error ? error.name : 'unknown error'}`,
        );
      }
    };
    await prune();
    pruneTimer = setInterval(() => void prune(), pruneIntervalMs);
    jobs.push('outbox-prune');
    deps.logger.log('Outbox prune scheduled daily');
  } else {
    deps.logger.log('Outbox prune off (OUTBOX_PRUNE=off)');
  }
  const app = config.db.urls.app === undefined ? undefined : deps.appPool(config);
  const registry = new KindHandlerRegistry(deps.kindHandlers(config, pool, app));
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
  // PLAT-14 plan 2.3: the outbox gauges, at once and every 30 s.
  await deps.outboxGauges(pool.db);
  const gaugeTimer = setInterval(() => void deps.outboxGauges(pool.db), gaugeIntervalMs);
  jobs.push('outbox-gauges');
  // INT-4 plan 2.4: push receipts every 5 minutes, whenever this build has a push handler.
  let receiptsTimer: NodeJS.Timeout | undefined;
  const push = registry.get('push');
  if (push instanceof PushKindHandler) {
    const receipts = async () => {
      try {
        if (redis.status === 'wait') await redis.connect();
        const run = await deps.pushReceipts(pool, redis, push);
        if (run.ran) {
          const c = run.counts;
          deps.logger.log(
            `Push receipts: ${c.checked} tickets checked (${c.ok} ok, ${c.error} error, ` +
              `${c.noReceipt} without receipt), ${c.invalidated} tokens invalidated, ` +
              `${c.purged} tickets purged`,
          );
        }
      } catch (error) {
        deps.logger.warn(
          `Push receipts skipped: ${error instanceof Error ? error.name : 'unknown error'}`,
        );
      }
    };
    await receipts();
    receiptsTimer = setInterval(() => void receipts(), pushReceiptsIntervalMs);
    jobs.push('push-receipts');
    deps.logger.log('Push receipts scheduled every 5 minutes');
  } else {
    deps.logger.log('Push receipts off: no push handler');
  }
  // DEL-5 plan 2.5, 2.8: the telemetry and shift jobs scan on the platform pool and write per
  // account on elx_app (elx_platform only reads those tables), so they need DATABASE_URL_APP.
  const deliveryTimers: NodeJS.Timeout[] = [];
  if (app === undefined) {
    deps.logger.log(
      'Trail appender, telemetry retention and shift sweeper off: DATABASE_URL_APP not configured',
    );
  } else {
    const connected = async () => {
      if (redis.status === 'wait') await redis.connect();
    };
    const appender = every(trailAppenderIntervalMs, 'Trail appender', deps.logger, async () => {
      await connected();
      const run = await deps.trailAppender(pool, app, redis);
      if (run.ran && (run.counts.points > 0 || run.counts.failed > 0)) {
        const c = run.counts;
        deps.logger.log(
          `Trail appender: ${c.points} points of ${c.drivers} drivers appended, ${c.failed} failed`,
        );
      }
    });
    const retention = every(retentionTickMs, 'Telemetry retention', deps.logger, async () => {
      await connected();
      const run = await deps.telemetryRetention(pool, app, redis);
      if (run.ran) {
        const c = run.counts;
        deps.logger.log(
          `Telemetry retention: ${c.trails} trails, ${c.ringRows} ring rows and ${c.heads} heads ` +
            `deleted in ${c.accounts} accounts, ${c.failed} failed`,
        );
      }
    });
    const sweeper = every(shiftSweeperIntervalMs, 'Shift sweeper', deps.logger, async () => {
      await connected();
      const run = await deps.shiftSweeper(pool, app, redis);
      if (run.ran && (run.counts.noShows > 0 || run.counts.stale > 0 || run.counts.failed > 0)) {
        const c = run.counts;
        deps.logger.log(
          `Shift sweeper: ${c.noShows} no-shows, ${c.stale} stale alerts, ${c.failed} failed`,
        );
      }
    });
    await Promise.all([appender.first, retention.first, sweeper.first]);
    deliveryTimers.push(appender.timer, retention.timer, sweeper.timer);
    jobs.push('trail-appender', 'telemetry-retention', 'shift-sweeper');
    deps.logger.log(
      'Trail appender and shift sweeper scheduled every 5 minutes, telemetry retention daily at 03:00 Asia/Riyadh',
    );
  }
  return {
    jobs,
    stop: async () => {
      for (const deliveryTimer of deliveryTimers) clearInterval(deliveryTimer);
      clearInterval(timer);
      clearInterval(otpTimer);
      clearInterval(pruneTimer);
      clearInterval(gaugeTimer);
      clearInterval(receiptsTimer);
      // The relay first (no new jobs), then the workers drain (platform §5), then the clients.
      await relay?.stop();
      await queues.stop();
      await registry.close();
      redis.disconnect();
      await Promise.all([pool.close(), app?.close()]);
    },
  };
}
