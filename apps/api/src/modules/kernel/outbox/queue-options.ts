import type { OutboxKind } from '../schema/outbox.js';

// The per-kind queue options of integrations §4.2 (ADR-0024, ADR-0036; PLAT-8 plan 2.4) as one
// typed table: concurrency per worker, the provider rate limit, the retry schedule (full jitter is
// added when a delay is drawn) and when a row is dead. Limits marked `toConfirm` are taken as
// written (plan §7 question 1); each INT order confirms its provider's figure here.

const second = 1_000;
const minute = 60 * second;
const hour = 60 * minute;

/** A provider rate limit; `per` says what one budget covers (only `queue` maps to BullMQ). */
export interface QueueLimit {
  readonly max: number;
  readonly durationMs: number;
  /**
   * `queue`: the whole queue (BullMQ `limiter`). Any other scope (per merchant host, per store) is
   * finer than a BullMQ queue limiter and is enforced by the kind's handler when it arrives.
   */
  readonly per: 'queue' | 'merchant_host' | 'store';
  readonly toConfirm: boolean;
}

/** Delays between attempts: doubling from `firstMs` up to `capMs`, or fixed steps. */
export type Backoff =
  | { readonly type: 'doubling'; readonly firstMs: number; readonly capMs: number }
  /** The n-th retry waits `delaysMs[n - 1]`; past the end the last step repeats. */
  | { readonly type: 'steps'; readonly delaysMs: readonly number[] };

/** When a failing row becomes `dead`. */
export type DeadAfter =
  /** At the n-th failure that consumed an attempt. */
  | { readonly failures: number }
  /** At the first failure this long after the row was written. */
  | { readonly afterMs: number };

export interface RetryPolicy {
  readonly backoff: Backoff;
  readonly deadAfter: DeadAfter;
}

export interface QueuePolicy extends RetryPolicy {
  /** Jobs one worker process runs at once. */
  readonly concurrency: number;
  readonly limiter: QueueLimit | null;
  /** What §4.2 adds that this table cannot enforce yet, for the kind's own order. */
  readonly note?: string;
  /** A second schedule for some rows of the kind (OTP messages), chosen by the kind's handler. */
  readonly variants?: Readonly<Record<string, RetryPolicy & { readonly priority?: number }>>;
}

/** Integrations §4.2, row by row. */
export const outboxQueuePolicies: Readonly<Record<OutboxKind, QueuePolicy>> = {
  internal_event: {
    concurrency: 20,
    limiter: null,
    backoff: { type: 'doubling', firstMs: second, capMs: 5 * minute },
    deadAfter: { failures: 10 },
    // §4.2 says a dead row parks later events (K-11); here a dead row is finished, so the relay
    // releases later events and staff replay the dead one (plan 2.6, leg 2 §8.2 #20).
    note: 'a dead row releases later events of the aggregate; staff replay it (plan 2.6)',
  },
  webhook: {
    concurrency: 50,
    limiter: null,
    // webhooks.md §3: 30 s, 2 min, 10 min, 30 min, 1 h, 2 h, 4 h, then every 4 h.
    backoff: {
      type: 'steps',
      delaysMs: [30 * second, 2 * minute, 10 * minute, 30 * minute, hour, 2 * hour, 4 * hour],
    },
    deadAfter: { afterMs: 24 * hour },
    note: 'at most 4 in flight per merchant host (INT-10)',
  },
  message: {
    concurrency: 10,
    limiter: { max: 40, durationMs: second, per: 'queue', toConfirm: true },
    backoff: { type: 'steps', delaysMs: [15 * second, minute, 5 * minute, 15 * minute] },
    deadAfter: { failures: 5 },
    variants: {
      // "3 attempts within 60 s": two retries whose jittered delays add up to at most 45 s.
      otp: {
        backoff: { type: 'steps', delaysMs: [15 * second, 30 * second] },
        deadAfter: { failures: 3 },
        priority: 1,
      },
    },
  },
  push: {
    concurrency: 4,
    limiter: { max: 500, durationMs: second, per: 'queue', toConfirm: true },
    backoff: { type: 'steps', delaysMs: [10 * second, 30 * second, 2 * minute] },
    deadAfter: { failures: 3 },
    note: 'batches of 100 (PushSender)',
  },
  channel_publish: {
    concurrency: 8,
    limiter: { max: 1, durationMs: second, per: 'store', toConfirm: true },
    backoff: {
      type: 'steps',
      delaysMs: [minute, 5 * minute, 15 * minute, hour, 3 * hour, 6 * hour],
    },
    deadAfter: { afterMs: 24 * hour },
    note: 'one in flight per connection; WMS emits wms.channel_publication.dead',
  },
  carrier_call: {
    concurrency: 5,
    limiter: { max: 5, durationMs: second, per: 'queue', toConfirm: true },
    backoff: {
      type: 'steps',
      delaysMs: [10 * second, 30 * second, 2 * minute, 5 * minute, 15 * minute],
    },
    deadAfter: { failures: 6 },
    note: '4xx validation errors are not retried (the handler returns dead)',
  },
  storage_lifecycle: {
    concurrency: 2,
    limiter: { max: 10, durationMs: second, per: 'queue', toConfirm: false },
    backoff: { type: 'doubling', firstMs: minute, capMs: hour },
    deadAfter: { failures: 10 },
  },
};

/** The un-jittered delay before retry number `retry` (1 = the first retry). */
export function baseDelayMs(backoff: Backoff, retry: number): number {
  const n = Math.max(1, Math.floor(retry));
  if (backoff.type === 'doubling') {
    // 2 ** 30 is far past any cap; the exponent is bounded so the product stays finite.
    return Math.min(backoff.capMs, backoff.firstMs * 2 ** Math.min(n - 1, 30));
  }
  const steps = backoff.delaysMs;
  return steps[Math.min(n, steps.length) - 1] ?? 0;
}

/**
 * The delay before retry number `retry` with full jitter (a uniform draw in `[0, base]`; the
 * "Exponential Backoff And Jitter" method), so retries of many rows failing together spread out.
 * `random` returns a value in `[0, 1)`.
 */
export function retryDelayMs(
  backoff: Backoff,
  retry: number,
  random: () => number = Math.random,
): number {
  return Math.floor(random() * baseDelayMs(backoff, retry));
}

/**
 * Whether a failure that consumes an attempt makes the row dead: `failures` is the row's failure
 * count including this one, `ageMs` the time since the row was written.
 */
export function isFinalFailure(policy: RetryPolicy, failures: number, ageMs: number): boolean {
  const dead = policy.deadAfter;
  return 'failures' in dead ? failures >= dead.failures : ageMs >= dead.afterMs;
}

/** The BullMQ `limiter` of a kind's worker: only a queue-wide limit maps onto it. */
export function bullLimiter(policy: QueuePolicy): { max: number; duration: number } | undefined {
  const limit = policy.limiter;
  return limit === null || limit.per !== 'queue'
    ? undefined
    : { max: limit.max, duration: limit.durationMs };
}

/**
 * BullMQ attempts of a job. They cover only a processor that could not finish at all (the row
 * could not be read or its outcome not written, e.g. the database is down); the handler's own
 * failures are counted on the row (`attempts`) and retried by moving the job to delayed.
 */
export const outboxJobAttempts = 10;

/** The name of the custom BullMQ backoff strategy every outbox worker registers. */
export const outboxBackoffType = 'outbox';
