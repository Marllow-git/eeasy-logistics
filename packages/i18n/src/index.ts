import arCommon from '../ar/common.json';
import enCommon from '../en/common.json';

export { defaultLocale, dir, isLocale, locales, type Locale } from './locales.ts';
import type { Locale } from './locales.ts';

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
