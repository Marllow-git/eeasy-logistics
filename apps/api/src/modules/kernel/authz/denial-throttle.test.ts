import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DenialAuditThrottle, denialWindowMs, maxDenialKeys } from './denial-throttle.js';

// PLAT-10 plan 2.8: one denial row per principal and operation per minute, in bounded memory; a
// full window never evicts its own keys (lead review round 1).

describe('DenialAuditThrottle', () => {
  afterEach(() => vi.restoreAllMocks());

  it('admits a key once per minute window', () => {
    let now = 5 * denialWindowMs;
    const throttle = new DenialAuditThrottle(() => now);
    expect(throttle.admit('a')).toBe(true);
    expect(throttle.admit('a')).toBe(false);
    expect(throttle.admit('b')).toBe(true);
    now += denialWindowMs - 1;
    expect(throttle.admit('a')).toBe(false);
    now += 1;
    expect(throttle.admit('a')).toBe(true);
  });

  it('under a flood keeps every key of the window: no repeat is admitted twice', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    let now = 7 * denialWindowMs;
    const throttle = new DenialAuditThrottle(() => now);
    for (let i = 0; i < maxDenialKeys; i += 1) expect(throttle.admit(`k${i}`)).toBe(true);
    expect(throttle.size).toBe(maxDenialKeys);
    // Beyond the cap a new key is refused, and logged once.
    expect(throttle.admit('late-1')).toBe(false);
    expect(throttle.admit('late-2')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    // Every admitted key is still held: a repeated denial writes no second row.
    for (const key of ['k0', 'k1', `k${maxDenialKeys - 1}`])
      expect(throttle.admit(key)).toBe(false);
    expect(throttle.size).toBe(maxDenialKeys);
    // The next window starts empty.
    now += denialWindowMs;
    expect(throttle.admit('k0')).toBe(true);
    expect(throttle.admit('late-1')).toBe(true);
    expect(throttle.size).toBe(2);
  });
});
