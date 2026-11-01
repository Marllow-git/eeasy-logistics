import { fileURLToPath } from 'node:url';
import type { Config } from '@eeasy-logistics/config';
import { uuidv7 } from '@eeasy-logistics/db';
import type { AuditPartitionRun } from '@eeasy-logistics/db/migrate';
import { maintainAuditPartitions, runMigrations } from '@eeasy-logistics/db/migrate';
import { Logger } from '@nestjs/common';

/**
 * `apps/api/drizzle/`: the reviewed SQL migrations and their journal. Resolved from this file, so
 * it is the same folder from `src/migrate/` and from the compiled `dist/migrate/`; the image must
 * ship the folder next to `dist/`.
 */
export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * The first day (UTC) of the month `months` before the month of `now`, `YYYY-MM-DD`: partitions
 * whose upper bound is on or before it hold only rows older than the retention.
 */
export function retentionCutoff(now: Date, months: number): string {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  return cutoff.toISOString().slice(0, 10);
}

/**
 * The audit partition maintenance (PLAT-7 plan 2.8, amended by adversary M-3): partitions ahead,
 * then the retention drop past `AUDIT_RETENTION_MONTHS`, each drop audited by the SQL function in
 * the same transaction. Runs in the short-lived migration job only, as `elx_owner`.
 */
export async function maintainAuditLog(
  config: Config,
  log: (line: string) => void,
  warn: (line: string) => void,
  now: Date = new Date(),
): Promise<AuditPartitionRun> {
  const run = await maintainAuditPartitions({
    url: config.db.urls.owner,
    cutoff: retentionCutoff(now, config.audit.retentionMonths),
    runId: uuidv7(),
  });
  if (!run.ran) {
    warn('Audit partitions skipped: a lock was not granted within the timeout; next run retries.');
    return run;
  }
  log(
    `Audit partitions: ${run.created} created, ${run.dropped.length} dropped past ${config.audit.retentionMonths} months` +
      (run.dropped.length === 0 ? '.' : ` (${run.dropped.map((d) => d.partition).join(', ')}).`),
  );
  if (run.defaultRows > 0) {
    warn(
      `core_audit_log_default holds ${run.defaultRows} row(s): a month had no partition; retention does not drop them until moved`,
    );
  }
  return run;
}

/**
 * The one-shot migration job, `api --role migrate` (data §11.5, platform §5): runs as `elx_owner`,
 * applies every pending migration under the advisory lock, records the version for `/ready`, then
 * maintains the audit partitions, and returns. Nothing to do is a success. OPS-1 runs it daily as
 * well as before each deploy, so retention drops do not wait for a deploy.
 */
export async function runMigrateJob(config: Config): Promise<void> {
  const logger = new Logger('Migrate');
  const result = await runMigrations({
    url: config.db.urls.owner,
    folder: migrationsFolder,
    rls: config.db.rls,
    log: (line) => logger.log(line),
  });
  logger.log(
    result.applied === 0
      ? `Nothing to migrate; the database is at ${result.version}.`
      : `Applied ${result.applied} migration(s); the database is at ${result.version}.`,
  );
  await maintainAuditLog(
    config,
    (line) => logger.log(line),
    (line) => logger.warn(line),
  );
}
