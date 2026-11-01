import type { Locale } from './locales.ts';
import { messages, type Messages } from './messages.ts';

export { defaultLocale, dir, isLocale, locales, type Locale } from './locales.ts';
export { messages, pickMessages, type Messages, type Namespace } from './messages.ts';
export {
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyAmount,
  formatNumber,
  formatPhone,
  intlLocale,
  timeZone,
} from './format.ts';

type KeyPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${KeyPaths<T[K]>}`;
}[keyof T & string];

export type CommonKey = KeyPaths<Messages['common']>;

/**
 * Looks up a plain `common` message, e.g. `t('ar', 'placeholder.merchant')`, for the driver app and
 * server code outside a next-intl request (metadata). It reads the same catalogues as next-intl
 * and does not interpret ICU arguments; components use next-intl's `useTranslations`.
 */
export function t(locale: Locale, key: CommonKey): string {
  let node: unknown = messages[locale].common;
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
