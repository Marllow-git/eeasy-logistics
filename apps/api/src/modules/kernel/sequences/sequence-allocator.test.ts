import { describe, expect, it } from 'vitest';
import { displayNumber, parseDisplayNumber } from './sequence-allocator.js';

// The display format of data §7 (DEL-2 plan 2.2): the prefix and six digits, wider when needed;
// the list filter reads a number with or without its prefix.

describe('displayNumber', () => {
  it('pads to six digits and widens past them', () => {
    expect(displayNumber('delivery_order', 1)).toBe('D-000001');
    expect(displayNumber('delivery_order', 123)).toBe('D-000123');
    expect(displayNumber('delivery_order', 999_999)).toBe('D-999999');
    expect(displayNumber('delivery_order', 1_234_567)).toBe('D-1234567');
    expect(displayNumber('purchase_order', 45)).toBe('PO-000045');
    expect(displayNumber('inbound_receipt', 310)).toBe('GR-000310');
    expect(displayNumber('fulfilment_order', 4512)).toBe('F-004512');
  });
});

describe('parseDisplayNumber', () => {
  it('reads a number with or without the prefix, any case', () => {
    expect(parseDisplayNumber('delivery_order', 'D-000123')).toBe(123);
    expect(parseDisplayNumber('delivery_order', 'd-000123')).toBe(123);
    expect(parseDisplayNumber('delivery_order', ' 000123 ')).toBe(123);
    expect(parseDisplayNumber('delivery_order', '123')).toBe(123);
    expect(parseDisplayNumber('delivery_order', 'D-1234567')).toBe(1_234_567);
  });

  it('refuses anything else', () => {
    for (const input of ['', 'D-', 'D-0', '0', '-1', '12a', 'PO-000123', 'D-1.5', '1e3']) {
      expect(parseDisplayNumber('delivery_order', input)).toBeUndefined();
    }
    expect(parseDisplayNumber('delivery_order', '9'.repeat(16))).toBeUndefined();
  });
});
