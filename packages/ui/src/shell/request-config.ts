import { messages, timeZone, type Locale } from '@eeasy-logistics/i18n';
import { IntlErrorCode } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import type { AppMessages } from '../intl';
import { requestLocale } from './locale';

/**
 * next-intl's request configuration, non-routing mode (web §5, plan 2.4): the locale comes from
 * `el_locale`, never from the URL. `appMessages` are the app's own namespaces per locale (apps/admin:
 * `platform`, ADR-0038), merged beside the shared catalogues; each app's `src/i18n/request.ts`
 * default-exports the result. A missing message throws instead of printing its key (web §5); keys
 * are typed, so that is a bug.
 */
export function shellRequestConfig(appMessages?: Record<Locale, AppMessages>) {
  return getRequestConfig(async () => {
    const locale = await requestLocale();
    return {
      locale,
      messages: { ...messages[locale], ...appMessages?.[locale] },
      timeZone,
      onError(error) {
        if (error.code === IntlErrorCode.MISSING_MESSAGE) throw error;
        console.error(error);
      },
    };
  });
}

/** The configuration of an app without namespaces of its own (apps/web). */
export default shellRequestConfig();
