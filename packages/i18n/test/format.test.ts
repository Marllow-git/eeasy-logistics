import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyAmount,
  formatNumber,
  formatPhone,
  intlLocale,
  locales,
} from '../src/index';

// Web §5, ADR-0016: Gregorian calendar, Western digits, Asia/Riyadh, in both locales.
const arabicIndicDigits = /[٠-٩۰-۹]/;
const marks = /[\u200e\u200f\u061c]/g;

describe.each(locales)('formatting in %s', (locale) => {
  it('resolves the Gregorian calendar and Latin digits', () => {
    const options = new Intl.DateTimeFormat(intlLocale[locale]).resolvedOptions();
    expect(options.calendar).toBe('gregory');
    expect(options.numberingSystem).toBe('latn');
  });

  it('writes Gregorian dates with Western digits', () => {
    const text = formatDateTime(locale, '2026-03-01T09:30:00Z', { dateStyle: 'long' });
    expect(text).toContain('2026');
    expect(text).not.toMatch(arabicIndicDigits);
    // Umm al-Qura would put this instant in 1447.
    expect(text).not.toContain('1447');
  });

  it('shows instants in Riyadh time (UTC+3)', () => {
    // 21:30 UTC on 1 March is 00:30 on 2 March in Riyadh.
    const text = formatDateTime(locale, '2026-03-01T21:30:00Z', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).replace(marks, '');
    expect(text).toMatch(/\b2\b|\b02\b/);
    expect(text).toContain('12:30');
    expect(text).not.toMatch(arabicIndicDigits);
  });

  it('keeps business dates on their calendar day in any zone', () => {
    const text = formatDate(locale, '2026-03-01', { dateStyle: 'long' });
    expect(text).toMatch(/\b1\b/);
    expect(text).toContain('2026');
    expect(text).not.toMatch(arabicIndicDigits);
  });

  it('refuses a malformed business date', () => {
    expect(() => formatDate(locale, '2026-02-30')).toThrow(RangeError);
    expect(() => formatDate(locale, '01/03/2026')).toThrow(RangeError);
  });

  it('formats numbers with Western digits', () => {
    expect(formatNumber(locale, 1234567.5)).toBe('1,234,567.5');
  });

  it('formats 15000 halalas as SAR 150.00', () => {
    const text = formatMoney(locale, 15000)
      .replace(marks, '')
      .replace(/\u00a0/g, ' ');
    expect(text).toContain('SAR');
    expect(text).toContain('150.00');
    expect(text).not.toMatch(arabicIndicDigits);
    expect(formatMoneyAmount(locale, 15000)).toBe('150.00');
  });

  it('refuses fractional halalas', () => {
    expect(() => formatMoney(locale, 150.5)).toThrow(RangeError);
  });
});

describe('formatMoney', () => {
  it('is exactly "SAR 150.00" in English', () => {
    expect(formatMoney('en', 15000).replace(/\u00a0/g, ' ')).toBe('SAR 150.00');
  });
});

describe('formatPhone', () => {
  it('groups a Saudi number and wraps it in left-to-right marks', () => {
    expect(formatPhone('+966501234567')).toBe('\u200e+966 50 123 4567\u200e');
  });

  it('keeps other E.164 numbers as they are', () => {
    expect(formatPhone('+971501234567')).toBe('\u200e+971501234567\u200e');
  });

  it('refuses a number that is not E.164', () => {
    expect(() => formatPhone('0501234567')).toThrow(RangeError);
  });
});
