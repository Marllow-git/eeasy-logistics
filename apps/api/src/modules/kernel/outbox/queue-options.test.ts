import { describe, expect, it } from 'vitest';
import { outboxKinds } from '../schema/outbox.js';
import {
  baseDelayMs,
  bullLimiter,
  isFinalFailure,
  outboxQueuePolicies,
  retryDelayMs,
} from './queue-options.js';

// PLAT-8 item D: the options table against integrations §4.2, written out by hand here so a change
// to either side shows.

const s = 1_000;
const min = 60 * s;
const h = 60 * min;

describe('outbox queue options (integrations §4.2)', () => {
  it('has one row per kind', () => {
    expect(Object.keys(outboxQueuePolicies).sort()).toEqual([...outboxKinds].sort());
  });

  it('matches §4.2 concurrency per worker', () => {
    const concurrency = Object.fromEntries(
      outboxKinds.map((kind) => [kind, outboxQueuePolicies[kind].concurrency]),
    );
    expect(concurrency).toEqual({
      internal_event: 20,
      webhook: 50,
      message: 10,
      push: 4,
      channel_publish: 8,
      carrier_call: 5,
      storage_lifecycle: 2,
    });
  });

  it('matches §4.2 rate limits, the provider figures flagged to confirm', () => {
    const p = outboxQueuePolicies;
    expect(p.internal_event.limiter).toBeNull();
    expect(p.webhook.limiter).toBeNull();
    expect(p.message.limiter).toEqual({ max: 40, durationMs: s, per: 'queue', toConfirm: true });
    expect(p.push.limiter).toEqual({ max: 500, durationMs: s, per: 'queue', toConfirm: true });
    expect(p.channel_publish.limiter).toEqual({
      max: 1,
      durationMs: s,
      per: 'store',
      toConfirm: true,
    });
    expect(p.carrier_call.limiter).toEqual({
      max: 5,
      durationMs: s,
      per: 'queue',
      toConfirm: true,
    });
    expect(p.storage_lifecycle.limiter).toEqual({
      max: 10,
      durationMs: s,
      per: 'queue',
      toConfirm: false,
    });
    // Only a queue-wide limit becomes a BullMQ limiter; per store is the handler's to enforce.
    expect(bullLimiter(p.storage_lifecycle)).toEqual({ max: 10, duration: s });
    expect(bullLimiter(p.channel_publish)).toBeUndefined();
    expect(bullLimiter(p.internal_event)).toBeUndefined();
  });

  it('matches §4.2 schedules and dead-after budgets', () => {
    const p = outboxQueuePolicies;
    expect(p.internal_event.backoff).toEqual({ type: 'doubling', firstMs: s, capMs: 5 * min });
    expect(p.internal_event.deadAfter).toEqual({ failures: 10 });
    expect(p.webhook.backoff).toEqual({
      type: 'steps',
      delaysMs: [30 * s, 2 * min, 10 * min, 30 * min, h, 2 * h, 4 * h],
    });
    expect(p.webhook.deadAfter).toEqual({ afterMs: 24 * h });
    expect(p.message.backoff).toEqual({
      type: 'steps',
      delaysMs: [15 * s, min, 5 * min, 15 * min],
    });
    expect(p.message.deadAfter).toEqual({ failures: 5 });
    expect(p.message.variants?.['otp']?.deadAfter).toEqual({ failures: 3 });
    expect(p.push.backoff).toEqual({ type: 'steps', delaysMs: [10 * s, 30 * s, 2 * min] });
    expect(p.push.deadAfter).toEqual({ failures: 3 });
    expect(p.channel_publish.backoff).toEqual({
      type: 'steps',
      delaysMs: [min, 5 * min, 15 * min, h, 3 * h, 6 * h],
    });
    expect(p.channel_publish.deadAfter).toEqual({ afterMs: 24 * h });
    expect(p.carrier_call.backoff).toEqual({
      type: 'steps',
      delaysMs: [10 * s, 30 * s, 2 * min, 5 * min, 15 * min],
    });
    expect(p.carrier_call.deadAfter).toEqual({ failures: 6 });
    expect(p.storage_lifecycle.backoff).toEqual({ type: 'doubling', firstMs: min, capMs: h });
    expect(p.storage_lifecycle.deadAfter).toEqual({ failures: 10 });
  });

  it('keeps the OTP schedule within 60 s even at the top of the jitter', () => {
    const otp = outboxQueuePolicies.message.variants?.['otp'];
    expect(otp).toBeDefined();
    const backoff = otp?.backoff ?? { type: 'steps', delaysMs: [] };
    expect(baseDelayMs(backoff, 1) + baseDelayMs(backoff, 2)).toBeLessThanOrEqual(60 * s);
  });
});

describe('retry delays', () => {
  const doubling = outboxQueuePolicies.internal_event.backoff;
  const steps = outboxQueuePolicies.carrier_call.backoff;

  it('doubles up to the cap', () => {
    expect([1, 2, 3, 9, 10, 40].map((n) => baseDelayMs(doubling, n))).toEqual([
      s,
      2 * s,
      4 * s,
      256 * s,
      5 * min,
      5 * min,
    ]);
  });

  it('walks the steps and repeats the last one', () => {
    expect([1, 2, 5, 6, 9].map((n) => baseDelayMs(steps, n))).toEqual([
      10 * s,
      30 * s,
      15 * min,
      15 * min,
      15 * min,
    ]);
  });

  it('adds full jitter: a uniform draw between 0 and the base delay', () => {
    expect(retryDelayMs(doubling, 3, () => 0)).toBe(0);
    expect(retryDelayMs(doubling, 3, () => 0.5)).toBe(2 * s);
    expect(retryDelayMs(doubling, 3, () => 0.999_999)).toBe(4 * s - 1);
  });

  it('declares a row dead at the budget, by failures or by age', () => {
    const p = outboxQueuePolicies;
    expect(isFinalFailure(p.internal_event, 9, 0)).toBe(false);
    expect(isFinalFailure(p.internal_event, 10, 0)).toBe(true);
    expect(isFinalFailure(p.webhook, 50, 23 * h)).toBe(false);
    expect(isFinalFailure(p.webhook, 1, 24 * h)).toBe(true);
  });
});
