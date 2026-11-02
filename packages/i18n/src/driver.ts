// The `driver` namespace (DRV-1 plan 2.2): the driver app's own strings, in a separate entry so the
// app loads only this catalogue (no next-intl, no web namespaces) and the web bundles never carry it.
// The Arabic catalogue is the reference shape: an English catalogue missing a key fails typecheck
// here, and test/parity.test.ts fails on a key present in one locale only.
import arDriver from '../ar/driver.json';
import enDriver from '../en/driver.json';
import type { Locale } from './locales.ts';

export { defaultLocale, dir, isLocale, locales, type Locale } from './locales.ts';

export type DriverMessages = typeof arDriver;

export const driverMessages: Record<Locale, DriverMessages> = { ar: arDriver, en: enDriver };

type KeyPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${KeyPaths<T[K]>}`;
}[keyof T & string];

/** A key of the driver catalogue, e.g. `'sign_in.title'`. */
export type DriverKey = KeyPaths<DriverMessages>;

/**
 * The message for a key with `{name}` arguments replaced, e.g.
 * `driverMessage('ar', 'verify.resend_in', { seconds: 42 })`. Throws on a missing key, which the
 * typed key makes a programming error.
 */
export function driverMessage(
  locale: Locale,
  key: DriverKey,
  values?: Readonly<Record<string, string | number>>,
): string {
  let node: unknown = driverMessages[locale];
  for (const part of key.split('.')) {
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined;
  }
  if (typeof node !== 'string') {
    throw new Error(`Missing driver message "${key}" for locale "${locale}"`);
  }
  if (values === undefined) return node;
  return node.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
