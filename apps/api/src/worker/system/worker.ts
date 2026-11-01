import type { Config } from '@eeasy-logistics/config';
import type { Pool } from '@eeasy-logistics/db';
import { verifyPoolRole } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { AuditSink } from '../../modules/kernel/audit/audit-sink.js';
import { AuditWriter } from '../../modules/kernel/audit/audit-writer.js';
import type { MaintainPartitions } from './audit-partitions.js';
import {
  auditPartitionJobMissing,
  ownerPartitionMaintenance,
  partitionIntervalMs,
  runAuditPartitionJob,
} from './audit-partitions.js';
import { purgeIntervalMs, runIdempotencyPurge } from './idempotency-purge.js';

// `--role worker` (platform §2). Until PLAT-8 brings BullMQ consumers and schedulers, the worker
// runs the system jobs on timers: the hourly idempotency purge (PLAT-6 plan 2.9) and the daily
// audit partition job (PLAT-7 plan 2.8).

export type WorkerJob = 'idempotency-purge' | 'audit-partitions';

export interface RunningWorker {
  /** The jobs scheduled; empty when the configuration enables none (outside production). */
  readonly jobs: readonly WorkerJob[];
  stop(): Promise<void>;
}

type JobRedis = Pick<Redis, 'set' | 'status' | 'connect' | 'disconnect'>;

/** What the worker builds from the configuration; replaced by doubles in unit tests. */
export interface WorkerDependencies {
  readonly platformPool: (config: Config) => Pool<PlatformDatabase>;
  readonly redis: (config: Config) => JobRedis;
  readonly verifyRole: (db: PlatformDatabase) => Promise<void>;
  /** The partition job's owner-side work (elx_owner, a dedicated connection per run). */
  readonly maintainPartitions: (config: Config) => MaintainPartitions;
  /** The committed audit writer on the platform pool. */
  readonly audit: (pool: Pool<PlatformDatabase>) => Pick<AuditSink, 'recordCommitted'>;
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
  maintainPartitions: ownerPartitionMaintenance,
  audit: (pool) => new AuditWriter(pool),
  logger: new Logger('Worker'),
};

const errorName = (error: unknown) => (error instanceof Error ? error.name : 'unknown error');

/**
 * Starts the worker with whatever the configuration enables (review round 1, finding 5). The
 * purge needs the platform pool and Redis; the partition job also needs the owner URL and
 * `AUDIT_PARTITION_JOB=on`. A job whose variables are missing (allowed outside production, where
 * the config refusals require Redis and the platform URL) is disabled with one warning naming
 * them; with no job enabled nothing stays scheduled and the process ends normally (the image probe
 * runs `--role worker` in the foreground). A configured platform pool must be a plain
 * elx_platform login, or this throws and main.ts exits 78 naming the role (plan 2.12). Each job
 * runs at once and then on its interval; a failure skips one run.
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

  const purgeMissing = [
    ...(config.redis.url === undefined ? ['REDIS_URL'] : []),
    ...(pool === undefined ? ['DATABASE_URL_PLATFORM'] : []),
  ];
  const purge = purgeMissing.length === 0;
  if (!purge) {
    deps.logger.warn(`idempotency purge disabled: ${purgeMissing.join(' and ')} not configured`);
  }
  const partitionMissing = auditPartitionJobMissing(config);
  const partitions = config.audit.partitionJob && partitionMissing.length === 0;
  if (!config.audit.partitionJob) {
    deps.logger.log('audit partition job off (AUDIT_PARTITION_JOB=off)');
  } else if (!partitions) {
    deps.logger.warn(
      `audit partition job disabled: ${partitionMissing.join(' and ')} not configured`,
    );
  }
  if (pool === undefined || (!purge && !partitions)) {
    await pool?.close();
    return { jobs: [], stop: () => Promise.resolve() };
  }

  const redis = deps.redis(config);
  const connected = async () => {
    if (redis.status === 'wait') await redis.connect();
  };
  const jobs: WorkerJob[] = [];
  const timers: NodeJS.Timeout[] = [];

  if (purge) {
    const tick = async () => {
      try {
        await connected();
        const run = await runIdempotencyPurge(pool.db, redis);
        if (run.ran) deps.logger.log(`Idempotency purge: ${run.deleted} expired keys deleted`);
      } catch (error) {
        deps.logger.warn(`Idempotency purge skipped: ${errorName(error)}`);
      }
    };
    await tick();
    timers.push(setInterval(() => void tick(), purgeIntervalMs));
    jobs.push('idempotency-purge');
    deps.logger.log('Idempotency purge scheduled hourly');
  }

  if (partitions) {
    const maintain = deps.maintainPartitions(config);
    const audit = deps.audit(pool);
    const tick = async () => {
      try {
        await connected();
        const run = await runAuditPartitionJob(
          maintain,
          audit,
          redis,
          config.audit.retentionMonths,
        );
        if (run.ran) {
          deps.logger.log(
            `Audit partitions: ${run.created} created, ${run.dropped} dropped past ${config.audit.retentionMonths} months`,
          );
          if (run.defaultRows > 0) {
            deps.logger.warn(
              `core_audit_log_default holds ${run.defaultRows} row(s): a month had no partition; retention does not drop them until moved`,
            );
          }
        }
      } catch (error) {
        deps.logger.warn(`Audit partition job skipped: ${errorName(error)}`);
      }
    };
    await tick();
    timers.push(setInterval(() => void tick(), partitionIntervalMs));
    jobs.push('audit-partitions');
    deps.logger.log('Audit partition job scheduled daily');
  }

  return {
    jobs,
    stop: async () => {
      for (const timer of timers) clearInterval(timer);
      redis.disconnect();
      await pool.close();
    },
  };
}
