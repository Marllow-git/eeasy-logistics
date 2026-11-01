import { describe, expect, it } from 'vitest';
import { normalisePhone, phoneTail } from './phone.js';

// Identity and tenancy §3.2: E.164 before anything else; two spellings of one Saudi number are one
// phone (and so share one budget and one cooldown).
describe('normalisePhone', () => {
  it.each([
    '0551234567',
    '055 123 4567',
    '+966551234567',
    '+966 55 123 4567',
    '00966551234567',
    '(055) 123-4567',
    '٠٥٥١٢٣٤٥٦٧',
  ])('reads %j as +966551234567', (input) => {
    expect(normalisePhone(input)).toBe('+966551234567');
  });

  it.each([
    ['+971501234567', '+971501234567'],
    ['+44 7911 123456', '+447911123456'],
  ])('keeps an international number %j', (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it.each([
    '',
    'abc',
    '12',
    '+966',
    '05512345678901234',
    'call 0551234567 now',
    '+9665512345',
    '0'.repeat(41),
  ])('refuses %j', (input) => {
    expect(normalisePhone(input)).toBeUndefined();
  });
});

describe('phoneTail', () => {
  it('shows the last two digits only (plan 2.10)', () => {
    expect(phoneTail('+966551234567')).toBe('…67');
  });
});
