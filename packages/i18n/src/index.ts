import arCommon from '../ar/common.json';
import enCommon from '../en/common.json';

export const locales = ['ar', 'en'] as const;
export type Locale = (typeof locales)[number];

/** Arabic is the primary language and the fallback everywhere (ADR-0016). */
export const defaultLocale: Locale = 'ar';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/** Text direction for the `dir` attribute or style of a locale. */
export function dir(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

// The Arabic catalogue is the reference shape: an English catalogue missing a key fails typecheck,
// and test/parity.test.ts fails on a key present in one locale only, in either direction.
type CommonCatalogue = typeof arCommon;
const common: Record<Locale, CommonCatalogue> = { ar: arCommon, en: enCommon };

type KeyPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${KeyPaths<T[K]>}`;
}[keyof T & string];

export type CommonKey = KeyPaths<CommonCatalogue>;

/** Looks up a `common` message, e.g. `t('ar', 'placeholder.merchant')`. */
export function t(locale: Locale, key: CommonKey): string {
  let node: unknown = common[locale];
  for (const part of key.split('.')) {
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined;
  }
  if (typeof node !== 'string') {
    throw new Error(`Missing message "${key}" for locale "${locale}"`);
  }
  return node;
}
