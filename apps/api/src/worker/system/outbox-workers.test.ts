import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { outboxQueuePolicies } from '../../modules/kernel/outbox/queue-options.js';
import { workerOptions } from './outbox-workers.js';

// PLAT-8 item D: each kind's BullMQ Worker gets the §4.2 row of its kind.

const connection = {} as Redis;

describe('outbox worker options', () => {
  it('takes concurrency and the queue-wide limiter from the kind', () => {
    const storage = workerOptions(
      outboxQueuePolicies.storage_lifecycle,
      connection,
      'elx',
      () => 1,
    );
    expect(storage).toMatchObject({
      connection,
      prefix: 'elx',
      concurrency: 2,
      limiter: { max: 10, duration: 1_000 },
    });
    const internal = workerOptions(outboxQueuePolicies.internal_event, connection, 'elx', () => 1);
    expect(internal.concurrency).toBe(20);
    expect('limiter' in internal).toBe(false);
    // Per store is finer than a queue limiter: none on the BullMQ worker.
    const channel = workerOptions(outboxQueuePolicies.channel_publish, connection, 'elx', () => 1);
    expect('limiter' in channel).toBe(false);
  });

  it('retries an unfinished processor on the kind schedule with full jitter', () => {
    const half = workerOptions(outboxQueuePolicies.internal_event, connection, 'elx', () => 0.5);
    expect(half.settings.backoffStrategy(1, 'outbox')).toBe(500);
    expect(half.settings.backoffStrategy(4, 'outbox')).toBe(4_000);
    expect(half.settings.backoffStrategy(4, 'fixed')).toBe(0);
  });
});
