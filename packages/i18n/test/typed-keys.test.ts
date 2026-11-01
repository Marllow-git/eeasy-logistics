import { createTranslator } from 'use-intl/core';
import { describe, expect, it } from 'vitest';
import { messages, t } from '../src/index';

// Web §5: keys are typed from the Arabic catalogue, so a missing key fails typecheck. The
// `@ts-expect-error` lines below are the proof: `tsc --noEmit` fails if any of them typechecks.
describe('typed keys', () => {
  it('types next-intl keys from the Arabic catalogue', () => {
    const nav = createTranslator({ locale: 'en', messages: messages.en, namespace: 'nav' });
    expect(nav('home')).toBe('Home');
    // @ts-expect-error -- not a key of the nav namespace
    expect(() => nav('no_such_key')).toBeDefined();
  });

  it('interprets ICU plurals in both locales', () => {
    const en = createTranslator({ locale: 'en', messages: messages.en, namespace: 'common' });
    const ar = createTranslator({ locale: 'ar', messages: messages.ar, namespace: 'common' });
    // `value` is pre-formatted by formatNumber: ICU `#` would use the bare locale's digits.
    expect(en('updated_ago.seconds', { count: 5, value: '5' })).toBe('Updated 5 seconds ago');
    expect(ar('updated_ago.seconds', { count: 5, value: '5' })).toBe('حُدّث قبل 5 ثوانٍ');
    expect(ar('updated_ago.seconds', { count: 2, value: '2' })).toBe('حُدّث قبل ثانيتين');
  });

  it('types the t() helper', () => {
    expect(t('en', 'app.name')).toBe('Eeasy Logistics');
    // @ts-expect-error -- not a key of the common namespace
    expect(() => t('en', 'app.no_such_key')).toThrow('Missing message');
  });
});
