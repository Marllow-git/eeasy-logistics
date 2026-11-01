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
