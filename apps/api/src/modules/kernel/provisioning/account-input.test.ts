import { describe, expect, it } from 'vitest';
import { accountNameProblem, moduleKeys } from './account-input.js';

describe('the account name bound (PLAT-13 plan 2.2, PLAT-9 L-7)', () => {
  const pointer = '/body/name';

  it('accepts one line of 1 to 80 characters, Arabic included', () => {
    expect(accountNameProblem(pointer, 'ش')).toBeUndefined();
    expect(accountNameProblem(pointer, 'متجر الورد')).toBeUndefined();
    expect(accountNameProblem(pointer, 'x'.repeat(80))).toBeUndefined();
    expect(accountNameProblem(pointer, 'ب'.repeat(80))).toBeUndefined();
  });

  it('refuses empty, over 80 characters, a line break and a link', () => {
    expect(accountNameProblem(pointer, '')).toEqual({ pointer, code: 'too_short' });
    expect(accountNameProblem(pointer, 'x'.repeat(81))).toEqual({ pointer, code: 'too_long' });
    expect(accountNameProblem(pointer, 'Shop\nBcc: a@b')).toEqual({ pointer, code: 'invalid' });
    expect(accountNameProblem(pointer, 'Shop two')).toEqual({ pointer, code: 'invalid' });
    expect(accountNameProblem(pointer, 'Visit https://evil.test')).toEqual({
      pointer,
      code: 'invalid',
    });
    expect(accountNameProblem(pointer, 42)).toEqual({ pointer, code: 'invalid' });
  });
});

describe('module keys (PLAT-13 plan 2.2)', () => {
  it('keeps registered keys once each', () => {
    expect(moduleKeys(undefined)).toEqual({ keys: [] });
    expect(moduleKeys(['delivery', 'wms', 'delivery'])).toEqual({ keys: ['delivery', 'wms'] });
  });

  it('points at the first unknown key', () => {
    expect(moduleKeys(['delivery', 'channels', 'nope'])).toEqual({
      problem: { pointer: '/body/modules/1', code: 'invalid' },
    });
  });
});
