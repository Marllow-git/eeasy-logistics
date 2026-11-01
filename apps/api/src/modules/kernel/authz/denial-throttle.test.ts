import { describe, expect, it } from 'vitest';
import { DenialAuditThrottle, denialWindowMs } from './denial-throttle.js';

// PLAT-10 plan 2.8: one denial row per principal and operation per minute, in bounded memory.

describe('DenialAuditThrottle', () => {
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

  it('stays bounded under many keys', () => {
    let now = 0;
    const throttle = new DenialAuditThrottle(() => now);
    for (let i = 0; i < 12_000; i += 1) throttle.admit(`k${i}`);
    expect(throttle.size).toBeLessThanOrEqual(10_000);
    now += denialWindowMs;
    expect(throttle.admit('k0')).toBe(true);
    expect(throttle.size).toBeLessThanOrEqual(10_000);
  });
});
