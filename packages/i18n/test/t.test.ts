import { describe, expect, it } from 'vitest';
import { defaultLocale, dir, isLocale, t } from '../src/index';

describe('t()', () => {
  it('returns the message of the requested locale', () => {
    expect(t('en', 'placeholder.merchant')).toBe('The merchant dashboard is under construction.');
    expect(t('ar', 'placeholder.merchant')).toBe('لوحة التاجر قيد الإنشاء.');
  });
});

describe('locale helpers', () => {
  it('defaults to Arabic', () => {
    expect(defaultLocale).toBe('ar');
  });

  it('maps Arabic to rtl and English to ltr', () => {
    expect(dir('ar')).toBe('rtl');
    expect(dir('en')).toBe('ltr');
  });

  it('accepts only supported locales', () => {
    expect(isLocale('ar')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
