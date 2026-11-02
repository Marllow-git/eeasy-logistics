// The `push` namespace (INT-4 plan 2.7; driver app §8.2; ADR-0021): the title and body of every push
// notification the worker sends to a driver, in both locales, keyed by template key. Parameters are
// `{name}` placeholders the API's push template registry declares; values are ids, counts and order
// numbers only, never a name, phone or address. A separate entry from `.` (like `./templates`): the
// API loads it through Node's own module loader, which needs the JSON import attribute. Numbers are
// formatted with `formatNumber` (Western digits in both locales, ADR-0016).
import arPush from '../ar/push.json' with { type: 'json' };
import enPush from '../en/push.json' with { type: 'json' };
import type { Locale } from './locales.ts';

export { formatNumber } from './format.ts';
export { isLocale, locales, type Locale } from './locales.ts';

// The Arabic catalogue is the reference shape: an English catalogue missing a key fails typecheck,
// and test/parity.test.ts fails on a key present in one locale only.
export type PushTemplatesCatalogue = typeof arPush;
export type PushTemplateKey = keyof PushTemplatesCatalogue;

export const pushTemplateTexts: Readonly<Record<Locale, PushTemplatesCatalogue>> = {
  ar: arPush,
  en: enPush,
};

/** Every push template key that has a text, in catalogue order. */
export const pushTemplateKeys = Object.keys(arPush) as readonly PushTemplateKey[];
