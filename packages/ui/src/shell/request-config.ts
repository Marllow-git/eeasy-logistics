import { messages, timeZone } from '@eeasy-logistics/i18n';
import { IntlErrorCode } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { requestLocale } from './locale';
import '../intl';

/**
 * next-intl's request configuration, non-routing mode (web §5, plan 2.4): the locale comes from
 * `el_locale`, never from the URL. Each app's `src/i18n/request.ts` re-exports this. A missing
 * message throws instead of printing its key (web §5); keys are typed, so that is a bug.
 */
export default getRequestConfig(async () => {
  const locale = await requestLocale();
  return {
    locale,
    messages: messages[locale],
    timeZone,
    onError(error) {
      if (error.code === IntlErrorCode.MISSING_MESSAGE) throw error;
      console.error(error);
    },
  };
});
