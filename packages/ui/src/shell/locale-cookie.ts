import type { Locale } from '@eeasy-logistics/i18n';

/** The locale preference cookie (web §5). A preference, not a credential: readable by scripts. */
export const localeCookie = 'el_locale';

/** One year, so the choice survives until the user changes it. */
const maxAgeSeconds = 60 * 60 * 24 * 365;

/** The `document.cookie` assignment that stores `locale` for the whole site. */
export function localeCookieString(locale: Locale, secure: boolean): string {
  return `${localeCookie}=${locale}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure ? '; Secure' : ''}`;
}
