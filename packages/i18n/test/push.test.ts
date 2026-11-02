import { describe, expect, it } from 'vitest';
import { formatNumber, locales, pushTemplateKeys, pushTemplateTexts } from '../src/push';

// INT-4 plan 2.7: every push template has a title and a body in both locales, short enough for a
// notification, with Western digits only (ADR-0016); the parity test covers the key sets.
const arabicIndicDigits = /[٠-٩۰-۹]/;

describe('push namespace', () => {
  it('ships the wave 1 templates', () => {
    expect([...pushTemplateKeys].sort()).toEqual([
      'cash_block_notice',
      'offer_received',
      'order_assigned',
      'order_cancelled',
      // DEL-5 plan 2.8.
      'stale_tracking',
      'sync_needed',
    ]);
  });

  it.each(locales)('has exactly a title and a body per template in %s', (locale) => {
    for (const key of pushTemplateKeys) {
      const text = pushTemplateTexts[locale][key];
      expect(Object.keys(text).sort(), `${locale} ${key}`).toEqual(['body', 'title']);
      expect(Array.from(text.title).length, `${locale} ${key} title`).toBeLessThanOrEqual(65);
      expect(Array.from(text.body).length, `${locale} ${key} body`).toBeLessThanOrEqual(178);
      expect(`${text.title}${text.body}`).not.toMatch(arabicIndicDigits);
      expect(`${text.title}${text.body}`).not.toMatch(/[\r\n]/);
    }
  });

  it.each(locales)('formats counts with Western digits in %s', (locale) => {
    expect(formatNumber(locale, 15)).toBe('15');
  });
});
