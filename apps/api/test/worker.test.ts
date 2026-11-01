import type { EnvRecord } from '@eeasy-logistics/config';
import { defineConfig } from '@eeasy-logistics/config';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { purgeIntervalMs, purgeLockKey } from '../src/worker/system/idempotency-purge.js';
import { pruneIntervalMs } from '../src/worker/system/outbox-prune.js';
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
  const queuesStopped = vi.fn(() => Promise.resolve());
  const outboxWorkers = vi.fn(() => Promise.resolve({ stop: queuesStopped }));
  const counts = { finished: 3, dead: 1, receipts: 2, deadLetters: 0 };
  const outboxPrune = vi.fn(() => Promise.resolve({ ran: true as const, counts }));
  const outboxGauges = vi.fn(() => Promise.resolve());
  const otpPurge = vi.fn(() =>
    Promise.resolve({ ran: true as const, counts: { messages: 1, challenges: 2, nonces: 3 } }),
  );
  const deps: Partial<WorkerDependencies> = {
    outboxGauges,
    otpPurge,
    platformPool: () => ({ db: { execute } as unknown as PlatformDatabase, close: closed }),
    redis: () =>
      ({
        set,
        status: 'ready',
        connect: () => Promise.resolve(),
        disconnect: () => undefined,
      }) as unknown as ReturnType<WorkerDependencies['redis']>,
    verifyRole: verify,
    kindHandlers: () => [],
    outboxRelay,
    outboxWorkers,
    outboxPrune,
    logger: { warn, log },
  };
  return {
    outboxPrune,
    outboxGauges,
    otpPurge,
    deps,
    closed,
    execute,
    set,
    warn,
    log,
    outboxRelay,
    relayStopped,
    outboxWorkers,
    queuesStopped,
  };
}

describe('worker startup', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('boots with no Redis and no platform pool: purge, relay and queues disabled with one warning', async () => {
    const { deps, warn, outboxRelay, outboxWorkers } = doubles();
    const worker = await startWorker(config({}), deps);
    expect(worker.jobs).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'idempotency purge, outbox relay, outbox prune and outbox queues disabled: REDIS_URL and DATABASE_URL_PLATFORM not configured',
    );
    expect(outboxRelay).not.toHaveBeenCalled();
    expect(outboxWorkers).not.toHaveBeenCalled();
    await worker.stop();
  });

  it('boots without Redis: checks the platform role, then disables the purge', async () => {
    const verify = vi.fn(() => Promise.resolve());
    const { deps, warn, closed } = doubles(verify);
    const worker = await startWorker(config({ DATABASE_URL_PLATFORM: platformUrl }), deps);
    expect(worker.jobs).toEqual([]);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'idempotency purge, outbox relay, outbox prune and outbox queues disabled: REDIS_URL not configured',
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
    const {
      deps,
      set,
      execute,
      warn,
      outboxRelay,
      relayStopped,
      outboxWorkers,
      queuesStopped,
      outboxGauges,
      otpPurge,
    } = doubles();
    const worker = await startWorker(
      config({ DATABASE_URL_PLATFORM: platformUrl, REDIS_URL: redisUrl }),
      deps,
    );
    expect(worker.jobs).toEqual([
      'idempotency-purge',
      'otp-purge',
      'outbox-prune',
      'outbox-relay',
      'outbox-queues',
      'outbox-gauges',
    ]);
    // PLAT-9 plan 2.6: the OTP purge at once and every hour.
    expect(otpPurge).toHaveBeenCalledTimes(1);
    // PLAT-14 plan 2.3: the outbox gauges at once and every 30 s, until stopped.
    expect(outboxGauges).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(outboxGauges).toHaveBeenCalledTimes(2);
    expect(outboxRelay).toHaveBeenCalledTimes(1);
    expect(outboxWorkers).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0]?.[0]).toBe(purgeLockKey);
    expect(execute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(purgeIntervalMs);
    expect(set).toHaveBeenCalledTimes(2);
    expect(otpPurge).toHaveBeenCalledTimes(2);
    await worker.stop();
    expect(relayStopped).toHaveBeenCalledTimes(1);
    expect(queuesStopped).toHaveBeenCalledTimes(1);
    // The relay stops before the queues drain (no new job is added while they drain).
    expect(relayStopped.mock.invocationCallOrder[0]).toBeLessThan(
      queuesStopped.mock.invocationCallOrder[0] ?? 0,
    );
    await vi.advanceTimersByTimeAsync(purgeIntervalMs);
    expect(set).toHaveBeenCalledTimes(2);
  });

  it('with OUTBOX_RELAY=off runs no relay but the queues (PLAT-8 plan 2.11)', async () => {
    const { deps, outboxRelay, outboxWorkers } = doubles();
    const worker = await startWorker(
      config({ DATABASE_URL_PLATFORM: platformUrl, REDIS_URL: redisUrl, OUTBOX_RELAY: 'off' }),
      deps,
    );
    expect(worker.jobs).toEqual([
      'idempotency-purge',
      'otp-purge',
      'outbox-prune',
      'outbox-queues',
      'outbox-gauges',
    ]);
    expect(outboxRelay).not.toHaveBeenCalled();
    expect(outboxWorkers).toHaveBeenCalledTimes(1);
    await worker.stop();
  });

  it('warns without naming the relay when OUTBOX_RELAY=off and Redis is missing', async () => {
    const { deps, warn } = doubles();
    const worker = await startWorker(config({ OUTBOX_RELAY: 'off' }), deps);
    expect(warn).toHaveBeenCalledWith(
      'idempotency purge, outbox prune and outbox queues disabled: REDIS_URL and DATABASE_URL_PLATFORM not configured',
    );
    await worker.stop();
  });

  it('prunes the outbox at once and every day, logging the counts (PLAT-8 plan 2.8)', async () => {
    vi.useFakeTimers();
    const { deps, outboxPrune, log } = doubles();
    const worker = await startWorker(
      config({ DATABASE_URL_PLATFORM: platformUrl, REDIS_URL: redisUrl }),
      deps,
    );
    expect(outboxPrune).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'Outbox prune: 3 done or superseded rows, 1 dead rows, 2 receipts, 0 dead letters deleted',
    );
    await vi.advanceTimersByTimeAsync(pruneIntervalMs - 1);
    expect(outboxPrune).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(outboxPrune).toHaveBeenCalledTimes(2);
    await worker.stop();
    await vi.advanceTimersByTimeAsync(pruneIntervalMs);
    expect(outboxPrune).toHaveBeenCalledTimes(2);
  });

  it('skips a failed prune run with a warning and keeps the worker up', async () => {
    const { deps, outboxPrune, warn } = doubles();
    outboxPrune.mockRejectedValueOnce(new TypeError('boom'));
    const worker = await startWorker(
      config({ DATABASE_URL_PLATFORM: platformUrl, REDIS_URL: redisUrl }),
      deps,
    );
    expect(warn).toHaveBeenCalledWith('Outbox prune skipped: TypeError');
    expect(worker.jobs).toContain('outbox-queues');
    await worker.stop();
  });

  it('with OUTBOX_PRUNE=off runs no prune', async () => {
    const { deps, outboxPrune } = doubles();
    const worker = await startWorker(
      config({ DATABASE_URL_PLATFORM: platformUrl, REDIS_URL: redisUrl, OUTBOX_PRUNE: 'off' }),
      deps,
    );
    expect(outboxPrune).not.toHaveBeenCalled();
    expect(worker.jobs).toEqual([
      'idempotency-purge',
      'otp-purge',
      'outbox-relay',
      'outbox-queues',
      'outbox-gauges',
    ]);
    await worker.stop();
  });
});
