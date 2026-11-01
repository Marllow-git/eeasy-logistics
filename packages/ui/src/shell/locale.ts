import { defaultLocale, isLocale, type Locale } from '@eeasy-logistics/i18n';
import { cookies } from 'next/headers';
import { localeCookie } from './locale-cookie';

/**
 * The request's locale: the `el_locale` preference cookie, else Arabic (web §5, plan 2.4). The
 * user's saved preference and the account default join the chain with sessions (WEB-2).
 */
export async function requestLocale(): Promise<Locale> {
  const value = (await cookies()).get(localeCookie)?.value;
  return isLocale(value) ? value : defaultLocale;
}
