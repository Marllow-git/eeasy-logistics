import { describe, expect, it } from 'vitest';
import { afterFailure, cashPinRules } from './cash-pin.js';

describe('the cash PIN rules (DEL-4 plan 2.9)', () => {
  it('takes four to six digits only', () => {
    for (const pin of ['1234', '12345', '123456'])
      expect(cashPinRules.pattern.test(pin)).toBe(true);
    for (const pin of ['123', '1234567', '12a4', ' 1234', '١٢٣٤']) {
      expect(cashPinRules.pattern.test(pin)).toBe(false);
    }
  });

  it('locks on the fifth failure, not before', () => {
    expect([0, 1, 2, 3].map((failures) => afterFailure(failures))).toEqual([
      { failures: 1, locks: false },
      { failures: 2, locks: false },
      { failures: 3, locks: false },
      { failures: 4, locks: false },
    ]);
    expect(afterFailure(4)).toEqual({ failures: 5, locks: true });
    expect(afterFailure(5)).toEqual({ failures: 5, locks: true });
  });
});
