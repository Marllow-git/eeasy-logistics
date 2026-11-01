import type { EnvRecord } from '@eeasy-logistics/config';
import { defineConfig } from '@eeasy-logistics/config';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  partitionIntervalMs,
  partitionLockKey,
  retentionCutoff,
} from '../src/worker/system/audit-partitions.js';
import { purgeIntervalMs, purgeLockKey } from '../src/worker/system/idempotency-purge.js';
import type { WorkerDependencies } from '../src/worker/system/worker.js';
import { startWorker } from '../src/worker/system/worker.js';

// Review round 1, finding 5: `--role worker` boots with whatever is configured outside
// production; the purge runs only with both the platform pool and Redis.

// The purge cases keep the partition job off; its own cases below turn it on (PLAT-7).
const config = (env: EnvRecord) =>
  defineConfig({ APP_ENV: 'ci', AUDIT_PARTITION_JOB: 'off', ...env }, { role: 'worker' });
const ownerUrl = 'postgres://elx_owner:x@127.0.0.1:5432/elx';
const platformUrl = 'postgres://elx_platform:x@127.0.0.1:5432/elx';
const redisUrl = 'redis://127.0.0.1:6379';

function doubles(verify: () => Promise<void> = () => Promise.resolve()) {
  const closed = vi.fn(() => Promise.resolve());
  const execute = vi.fn(() => Promise.resolve([]));
  const set = vi.fn((..._args: unknown[]) => Promise.resolve('OK' as const));
  const warn = vi.fn();
  const log = vi.fn();
  const maintain = vi.fn((_cutoff: string) =>
    Promise.resolve({
      created: 1,
      dropped: [{ partition: 'core_audit_log_202409', upperBound: '2024-10-01T00:00:00Z' }],
    }),
  );
  const recordCommitted = vi.fn((..._args: unknown[]) => Promise.resolve());
  const deps: Partial<WorkerDependencies> = {
    maintainPartitions: () => maintain,
    audit: () => ({ recordCommitted }),
    platformPool: () => ({ db: { execute } as unknown as PlatformDatabase, close: closed }),
    redis: () =>
      ({
        set,
        status: 'ready',
        connect: () => Promise.resolve(),
        disconnect: () => undefined,
      }) as unknown as ReturnType<WorkerDependencies['redis']>,
    verifyRole: verify,
    logger: { warn, log },
  };
  return { deps, closed, execute, set, warn, log, maintain, recordCommitted };
}

describe('worker startup', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('boots with no Redis and no platform pool: the purge is disabled with one warning', async () => {
    const { deps, warn } = doubles();
    const worker = await startWorker(config({}), deps);
    expect(worker.jobs).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'idempotency purge disabled: REDIS_URL and DATABASE_URL_PLATFORM not configured',
    );
    await worker.stop();
  });

  it('boots without Redis: checks the platform role, then disables the purge', async () => {
    const verify = vi.fn(() => Promise.resolve());
    const { deps, warn, closed } = doubles(verify);
    const worker = await startWorker(config({ DATABASE_URL_PLATFORM: platformUrl }), deps);
    expect(worker.jobs).toEqual([]);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('idempotency purge disabled: REDIS_URL not configured');
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('refuses a platform pool that is not its plain role, whatever else is configured', async () => {
    const { deps, closed } = doubles(() => Promise.reject(new Error('not elx_platform')));
    await expect(startWorker(config({ DATABASE_URL_PLATFORM: platformUrl }), deps)).rejects.toThrow(
      'not elx_platform',
    );
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('with Redis and the platform pool: purges at once and every hour under the lock', async () => {
    vi.useFakeTimers();
    const { deps, set, execute, warn } = doubles();
    const worker = await startWorker(
      config({ DATABASE_URL_PLATFORM: platformUrl, REDIS_URL: redisUrl }),
      deps,
    );
    expect(worker.jobs).toEqual(['idempotency-purge']);
    expect(warn).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0]?.[0]).toBe(purgeLockKey);
    expect(execute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(purgeIntervalMs);
    expect(set).toHaveBeenCalledTimes(2);
    await worker.stop();
    await vi.advanceTimersByTimeAsync(purgeIntervalMs);
    expect(set).toHaveBeenCalledTimes(2);
  });

  it('logs the partition job off when AUDIT_PARTITION_JOB=off', async () => {
    const { deps, log } = doubles();
    const worker = await startWorker(config({}), deps);
    expect(log).toHaveBeenCalledWith('audit partition job off (AUDIT_PARTITION_JOB=off)');
    await worker.stop();
  });

  it('disables the partition job, naming what is missing, and keeps the purge (PLAT-7)', async () => {
    vi.useFakeTimers();
    const { deps, warn, maintain } = doubles();
    const worker = await startWorker(
      config({
        AUDIT_PARTITION_JOB: 'on',
        DATABASE_URL_PLATFORM: platformUrl,
        REDIS_URL: redisUrl,
      }),
      deps,
    );
    expect(worker.jobs).toEqual(['idempotency-purge']);
    expect(warn).toHaveBeenCalledWith(
      'audit partition job disabled: DATABASE_URL_OWNER not configured',
    );
    expect(maintain).not.toHaveBeenCalled();
    await worker.stop();
  });

  it('without Redis the partition job is disabled too (PLAT-6 rule)', async () => {
    const { deps, warn } = doubles();
    const worker = await startWorker(
      config({
        AUDIT_PARTITION_JOB: 'on',
        DATABASE_URL_PLATFORM: platformUrl,
        DATABASE_URL_OWNER: ownerUrl,
      }),
      deps,
    );
    expect(worker.jobs).toEqual([]);
    expect(warn).toHaveBeenCalledWith('audit partition job disabled: REDIS_URL not configured');
  });

  it('runs the partition job at once and daily under its lock, auditing each drop', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-15T08:00:00Z') });
    const { deps, set, maintain, recordCommitted } = doubles();
    const worker = await startWorker(
      config({
        AUDIT_PARTITION_JOB: 'on',
        AUDIT_RETENTION_MONTHS: '24',
        DATABASE_URL_PLATFORM: platformUrl,
        DATABASE_URL_OWNER: ownerUrl,
        REDIS_URL: redisUrl,
      }),
      deps,
    );
    expect(worker.jobs).toEqual(['idempotency-purge', 'audit-partitions']);
    expect(set.mock.calls.map((call) => call[0])).toEqual([purgeLockKey, partitionLockKey]);
    expect(maintain).toHaveBeenCalledWith('2024-11-01');
    expect(recordCommitted).toHaveBeenCalledTimes(1);
    expect(recordCommitted.mock.calls[0]?.[0]).toMatchObject({
      actorType: 'system',
      actorId: null,
      accountId: null,
      targetType: 'audit_partition',
      targetId: 'core_audit_log_202409',
      action: 'platform.audit_partition.dropped',
      after: { partition: 'core_audit_log_202409', upper_bound: '2024-10-01T00:00:00Z' },
    });
    await vi.advanceTimersByTimeAsync(partitionIntervalMs);
    expect(maintain).toHaveBeenCalledTimes(2);
    await worker.stop();
  });

  it('skips a run when another worker holds the lock', async () => {
    const { deps, set, maintain } = doubles();
    set.mockImplementation(() => Promise.resolve(null as unknown as 'OK'));
    const worker = await startWorker(
      config({
        AUDIT_PARTITION_JOB: 'on',
        DATABASE_URL_PLATFORM: platformUrl,
        DATABASE_URL_OWNER: ownerUrl,
        REDIS_URL: redisUrl,
      }),
      deps,
    );
    expect(maintain).not.toHaveBeenCalled();
    await worker.stop();
  });
});

describe('retentionCutoff', () => {
  it('is the first day of the month the retention reaches back to, in UTC', () => {
    expect(retentionCutoff(new Date('2026-11-01T00:30:00Z'), 24)).toBe('2024-11-01');
    expect(retentionCutoff(new Date('2026-01-31T23:59:59Z'), 24)).toBe('2024-01-01');
    expect(retentionCutoff(new Date('2026-03-10T12:00:00Z'), 36)).toBe('2023-03-01');
  });
});
