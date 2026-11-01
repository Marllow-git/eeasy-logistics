import { dir, pickMessages, t, timeZone, type Namespace } from '@eeasy-logistics/i18n';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { DirectionProvider } from '../components/direction-provider/direction-provider';
import { plex } from './font';
import { requestLocale } from './locale';
import '../intl';

/**
 * The `<html>` every route group's own root layout renders (web §1.2: separate root layouts, one
 * shell). `lang` and `dir` come from the request locale on the server (web §5); the font variable
 * sits on `<html>` so the `--font-sans` token resolves; Radix gets the direction; the client
 * receives only the shared namespaces the group renders (the `platform` namespace is apps/admin's and
 * stays on its server, ADR-0038). The app's layout imports `@eeasy-logistics/ui/styles.css`.
 */
export async function RootHtml({
  namespaces,
  children,
}: {
  namespaces: readonly Namespace[];
  children: ReactNode;
}) {
  const locale = await requestLocale();
  return (
    <html lang={locale} dir={dir(locale)} className={plex.variable}>
      <body className="font-sans antialiased">
        <NextIntlClientProvider
          locale={locale}
          messages={pickMessages(locale, namespaces)}
          timeZone={timeZone}
        >
          <DirectionProvider dir={dir(locale)}>{children}</DirectionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

/** The document title in the request locale; each root layout exports it as `generateMetadata`. */
export async function rootMetadata(): Promise<Metadata> {
  return { title: t(await requestLocale(), 'app.name') };
}
