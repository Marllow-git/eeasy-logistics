import { describe, expect, it } from 'vitest';
import { capKeys, isStaleOtp, quietHoursWaitS, riyadhDay } from './message-policies.js';

// PLAT-9 item H (plan 2.5; integrations §4.3, §5.4): the clock rules of the message policies.

const at = (iso: string) => new Date(iso);

describe('quiet hours, 22:00 to 08:00 Asia/Riyadh (UTC+3)', () => {
  it.each([
    ['2026-11-01T05:00:00Z', 0], // 08:00 Riyadh: open
    ['2026-11-01T18:59:59Z', 0], // 21:59:59 Riyadh: open
    ['2026-11-01T19:00:00Z', 10 * 3600], // 22:00 Riyadh: wait until 08:00 next day
    ['2026-11-01T20:30:00Z', 8.5 * 3600], // 23:30 Riyadh
    ['2026-11-01T21:00:00Z', 8 * 3600], // 00:00 Riyadh
    ['2026-11-02T04:59:00Z', 60], // 07:59 Riyadh
  ])('at %s waits %d s', (iso, seconds) => {
    expect(quietHoursWaitS(at(iso))).toBe(seconds);
  });
});

describe('the Riyadh day of the caps', () => {
  it('turns at 21:00 UTC (midnight in Riyadh)', () => {
    expect(riyadhDay(at('2026-11-01T20:59:59Z'))).toBe('20261101');
    expect(riyadhDay(at('2026-11-01T21:00:00Z'))).toBe('20261102');
  });
});

describe('OTP staleness (integrations §4.3)', () => {
  const created = at('2026-11-01T10:00:00Z');

  it('sends an OTP up to 4 minutes old and supersedes an older one', () => {
    expect(isStaleOtp(created, at('2026-11-01T10:04:00Z'))).toBe(false);
    expect(isStaleOtp(created, at('2026-11-01T10:04:01Z'))).toBe(true);
  });
});

describe('cap keys', () => {
  const key = Buffer.alloc(32, 9);
  const now = at('2026-11-01T10:00:00Z');
  const account = '019a3f00-0000-7000-8000-0000000000a1';

  it('hold no phone number, one key per account, phone and Riyadh day, and the order', () => {
    const keys = capKeys(key, account, '+966500000123', 'order-1', now);
    expect(keys.phone).toMatch(new RegExp(`^phone:${account}:[0-9a-f]{32}:20261101$`));
    expect(keys.phone).not.toContain('500000123');
    expect(keys.order).toBe('order:order-1');
    expect(capKeys(key, account, '+966500000124', undefined, now).phone).not.toBe(keys.phone);
    expect(capKeys(key, account, '+966500000123', undefined, now).order).toBeUndefined();
  });
});
