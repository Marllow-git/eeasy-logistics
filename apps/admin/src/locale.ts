import { cookies } from 'next/headers';
import { defaultLocale, isLocale, type Locale } from '@eeasy-logistics/i18n';

/**
 * The request's locale: the `el_locale` preference cookie, else Arabic (web §5). The user's saved
 * preference and the account default join the chain once sessions exist. A copy of
 * apps/web/src/locale.ts (WEB-19 decision 2.2); WEB-1 moves both into packages/ui.
 */
export async function requestLocale(): Promise<Locale> {
  const value = (await cookies()).get('el_locale')?.value;
  return isLocale(value) ? value : defaultLocale;
}
