'use client';

import { defaultLocale, dir, isLocale, messages, type Locale } from '@eeasy-logistics/i18n';
import { useSyncExternalStore } from 'react';
import { ErrorState } from '../components/error-state/error-state';
import { plex } from './font';
import { localeCookie } from './locale-cookie';

const subscribe = () => () => {};

/** The `el_locale` preference from `document.cookie`; Arabic on the server and by default. */
function cookieLocale(): Locale {
  const prefix = `${localeCookie}=`;
  const value = document.cookie
    .split('; ')
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  return isLocale(value) ? value : defaultLocale;
}

/**
 * The whole document `global-error.tsx` renders when a root layout fails (web §10.4; design
 * references docs/references/design/PLAT-14.md, "full-page error"): its own `<html lang dir>` in
 * the preferred locale, the shell font, and the shared `ErrorState` filling the viewport. There is
 * no request and no translation provider here, so the locale comes from the preference cookie and
 * the strings from the `common` catalogue directly.
 */
export function GlobalErrorDocument({
  reference,
  onRetry,
  homeHref,
}: {
  reference?: string | undefined;
  onRetry: () => void;
  homeHref: string;
}) {
  const locale = useSyncExternalStore(subscribe, cookieLocale, () => defaultLocale);
  const strings = messages[locale].common.error_page;
  return (
    <html lang={locale} dir={dir(locale)} className={plex.variable}>
      <body className="font-sans antialiased">
        <title>{messages[locale].common.app.name}</title>
        <main>
          <ErrorState
            variant="page"
            labels={{ ...strings, description: strings.global_description }}
            reference={reference}
            onRetry={onRetry}
            homeHref={homeHref}
          />
        </main>
      </body>
    </html>
  );
}
