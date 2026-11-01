import type { EnvRecord } from '@eeasy-logistics/config';
import { defineConfig } from '@eeasy-logistics/config';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { purgeIntervalMs, purgeLockKey } from '../src/worker/system/idempotency-purge.js';
import type { WorkerDependencies } from '../src/worker/system/worker.js';
import { startWorker } from '../src/worker/system/worker.js';

// Review round 1, finding 5: `--role worker` boots with whatever is configured outside
// production; the purge runs only with both the platform pool and Redis.

const config = (env: EnvRecord) => defineConfig({ APP_ENV: 'ci', ...env }, { role: 'worker' });
const platformUrl = 'postgres://elx_platform:x@127.0.0.1:5432/elx';
const redisUrl = 'redis://127.0.0.1:6379';

function doubles(verify: () => Promise<void> = () => Promise.resolve()) {
  const closed = vi.fn(() => Promise.resolve());
  const execute = vi.fn(() => Promise.resolve([]));
  const set = vi.fn((..._args: unknown[]) => Promise.resolve('OK' as const));
  const warn = vi.fn();
  const log = vi.fn();
  const relayStopped = vi.fn(() => Promise.resolve());
  const outboxRelay = vi.fn(() => Promise.resolve({ stop: relayStopped }));
  const deps: Partial<WorkerDependencies> = {
    platformPool: () => ({ db: { execute } as unknown as PlatformDatabase, close: closed }),
    redis: () =>
      ({
        set,
        status: 'ready',
        connect: () => Promise.resolve(),
        disconnect: () => undefined,
      }) as unknown as ReturnType<WorkerDependencies['redis']>,
    verifyRole: verify,
    outboxRelay,
    logger: { warn, log },
  };
  return { deps, closed, execute, set, warn, log, outboxRelay, relayStopped };
}

describe('worker startup', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('boots with no Redis and no platform pool: purge and relay disabled with one warning', async () => {
    const { deps, warn, outboxRelay } = doubles();
    const worker = await startWorker(config({}), deps);
    expect(worker.jobs).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'idempotency purge and outbox relay disabled: REDIS_URL and DATABASE_URL_PLATFORM not configured',
    );
    expect(outboxRelay).not.toHaveBeenCalled();
    await worker.stop();
  });

  it('boots without Redis: checks the platform role, then disables the purge', async () => {
    const verify = vi.fn(() => Promise.resolve());
    const { deps, warn, closed } = doubles(verify);
    const worker = await startWorker(config({ DATABASE_URL_PLATFORM: platformUrl }), deps);
    expect(worker.jobs).toEqual([]);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'idempotency purge and outbox relay disabled: REDIS_URL not configured',
    );
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
    const { deps, set, execute, warn, outboxRelay, relayStopped } = doubles();
    const worker = await startWorker(
      config({ DATABASE_URL_PLATFORM: platformUrl, REDIS_URL: redisUrl }),
      deps,
    );
    expect(worker.jobs).toEqual(['idempotency-purge', 'outbox-relay']);
    expect(outboxRelay).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0]?.[0]).toBe(purgeLockKey);
    expect(execute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(purgeIntervalMs);
    expect(set).toHaveBeenCalledTimes(2);
    await worker.stop();
    expect(relayStopped).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(purgeIntervalMs);
    expect(set).toHaveBeenCalledTimes(2);
  });

  it('with OUTBOX_RELAY=off runs no relay (PLAT-8 plan 2.11)', async () => {
    const { deps, outboxRelay } = doubles();
    const worker = await startWorker(
      config({ DATABASE_URL_PLATFORM: platformUrl, REDIS_URL: redisUrl, OUTBOX_RELAY: 'off' }),
      deps,
    );
    expect(worker.jobs).toEqual(['idempotency-purge']);
    expect(outboxRelay).not.toHaveBeenCalled();
    await worker.stop();
  });

  it('warns without naming the relay when OUTBOX_RELAY=off and Redis is missing', async () => {
    const { deps, warn } = doubles();
    const worker = await startWorker(config({ OUTBOX_RELAY: 'off' }), deps);
    expect(warn).toHaveBeenCalledWith(
      'idempotency purge disabled: REDIS_URL and DATABASE_URL_PLATFORM not configured',
    );
    await worker.stop();
  });
});
