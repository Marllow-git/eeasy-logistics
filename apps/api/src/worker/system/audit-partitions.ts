import { randomUUID } from 'node:crypto';
import type { Config } from '@eeasy-logistics/config';
import { uuidv7 } from '@eeasy-logistics/db';
import type { AuditPartitionRun } from '@eeasy-logistics/db/migrate';
import { maintainAuditPartitions } from '@eeasy-logistics/db/migrate';
import type { Redis } from 'ioredis';
import type { AuditSink } from '../../modules/kernel/audit/audit-sink.js';

// The audit partition job (PLAT-7 plan 2.8; data §3.1, §10, §11.5): daily, under a Redis lock, as
// elx_owner on a dedicated connection, keep three months of core_audit_log partitions ahead and
// drop those past the retention; every drop is audited on the platform pool. This file is the only
// place outside the migration job that reads the owner URL (ESLint `owner-url` rule, dependency
// rule `db-migrate-only-in-owner-jobs`; config refusals allow the worker the URL only while
// AUDIT_PARTITION_JOB=on).

export const partitionLockKey = 'elx:lock:audit-partitions';
export const partitionLockTtlMs = 23 * 60 * 60 * 1000;
export const partitionIntervalMs = 24 * 60 * 60 * 1000;

/**
 * The first day (UTC) of the month `months` before the month of `now`, `YYYY-MM-DD`: partitions
 * whose upper bound is on or before it hold only rows older than the retention.
 */
export function retentionCutoff(now: Date, months: number): string {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  return cutoff.toISOString().slice(0, 10);
}

/** What the job needs that the configuration lacks; empty when it can run. */
export function auditPartitionJobMissing(config: Config): string[] {
  return [
    ...(config.redis.url === undefined ? ['REDIS_URL'] : []),
    ...(config.db.urls.platform === undefined ? ['DATABASE_URL_PLATFORM'] : []),
    ...(config.db.urls.owner === undefined ? ['DATABASE_URL_OWNER'] : []),
  ];
}

/** The owner-side work, replaced by a double in unit tests. */
export type MaintainPartitions = (cutoff: string) => Promise<AuditPartitionRun>;

/** The owner-side work on the configured owner URL (read here only). */
export function ownerPartitionMaintenance(config: Config): MaintainPartitions {
  const url = config.db.urls.owner;
  return (cutoff) => maintainAuditPartitions({ url, cutoff });
}

export type PartitionRun =
  | { readonly ran: true; readonly created: number; readonly dropped: number }
  | { readonly ran: false };

/**
 * One scheduled run: takes the lock (`SET NX PX`, 23 h, never released early, so at most one run
 * a day across workers), maintains the partitions, then writes one committed audit row per
 * dropped partition (`platform.audit_partition.dropped`, actor `system`).
 */
export async function runAuditPartitionJob(
  maintain: MaintainPartitions,
  audit: Pick<AuditSink, 'recordCommitted'>,
  redis: Pick<Redis, 'set'>,
  retentionMonths: number,
  now: Date = new Date(),
): Promise<PartitionRun> {
  const acquired = await redis.set(partitionLockKey, randomUUID(), 'PX', partitionLockTtlMs, 'NX');
  if (acquired !== 'OK') return { ran: false };
  const run = await maintain(retentionCutoff(now, retentionMonths));
  const requestId = uuidv7(); // one id per job run, as request_id for its rows
  for (const dropped of run.dropped) {
    await audit.recordCommitted({
      actorType: 'system',
      actorId: null,
      accountId: null,
      targetType: 'audit_partition',
      targetId: dropped.partition,
      action: 'platform.audit_partition.dropped',
      after: { partition: dropped.partition, upper_bound: dropped.upperBound },
      reason: `retention ${retentionMonths} months`,
      requestId,
    });
  }
  return { ran: true, created: run.created, dropped: run.dropped.length };
}
