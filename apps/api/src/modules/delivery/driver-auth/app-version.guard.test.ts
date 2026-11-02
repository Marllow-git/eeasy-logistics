import { describe, expect, it } from 'vitest';
import { compareAppVersions, parseAppVersion, versionShortfall } from './app-version.guard.js';

describe('the driver app version check (DEL-4 plan 2.10)', () => {
  it('parses major.minor.patch only', () => {
    expect(parseAppVersion('1.4.0')).toEqual([1, 4, 0]);
    for (const value of ['1.4', '1.4.0-beta', 'v1.4.0', '1.4.0.1', '', '1234567890.0.0']) {
      expect(parseAppVersion(value)).toBeUndefined();
    }
  });

  it('compares numerically, part by part', () => {
    const order = ['1.9.9', '1.10.0', '1.10.1', '2.0.0'].map((value) => parseAppVersion(value));
    for (let index = 1; index < order.length; index += 1) {
      const older = order[index - 1];
      const newer = order[index];
      if (older === undefined || newer === undefined) throw new Error('unparsed');
      expect(compareAppVersions(older, newer)).toBeLessThan(0);
      expect(compareAppVersions(newer, older)).toBeGreaterThan(0);
      expect(compareAppVersions(newer, newer)).toBe(0);
    }
  });

  it('names the minimum only below it, on a platform that has one, with both headers', () => {
    const minimums = { ios: '1.4.0' };
    expect(versionShortfall(minimums, 'ios', '1.3.9')).toBe('1.4.0');
    expect(versionShortfall(minimums, 'ios', '1.4.0')).toBeUndefined();
    expect(versionShortfall(minimums, 'ios', '1.10.0')).toBeUndefined();
    expect(versionShortfall(minimums, 'android', '0.0.1')).toBeUndefined();
    expect(versionShortfall(minimums, undefined, '0.0.1')).toBeUndefined();
    expect(versionShortfall(minimums, 'ios', undefined)).toBeUndefined();
    expect(versionShortfall(minimums, 'ios', 'garbage')).toBeUndefined();
    expect(versionShortfall(minimums, 'web', '0.0.1')).toBeUndefined();
  });
});
