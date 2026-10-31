import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { dir, t, type CommonKey } from '@eeasy-logistics/i18n';
import { requestLocale } from './locale';

/**
 * The `<html>` shell each route group's own root layout renders (web §1.2: no shared root layout).
 * `lang` and `dir` come from the locale on the server (web §5).
 */
export async function RootHtml({ children }: { children: ReactNode }) {
  const locale = await requestLocale();
  return (
    <html lang={locale} dir={dir(locale)}>
      <body>{children}</body>
    </html>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await requestLocale(), 'app.name') };
}

/** Placeholder page body until the group's first real screen lands. */
export async function Placeholder({ message }: { message: CommonKey }) {
  const locale = await requestLocale();
  return (
    <main>
      <h1>{t(locale, 'app.name')}</h1>
      <p>{t(locale, message)}</p>
    </main>
  );
}
