import '@eeasy-logistics/ui/styles.css';
import { AppShell } from '@eeasy-logistics/ui/components/app-shell';
import { RootHtml, rootMetadata } from '@eeasy-logistics/ui/shell';
import { LocaleSwitch } from '@eeasy-logistics/ui/shell/locale-switch';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

export const generateMetadata = rootMetadata;

/**
 * Platform staff sign-in before a session (web §1). Its own root layout (web §1.2); the frame has
 * no navigation, only the brand and the locale switch.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('common');
  return (
    <RootHtml namespaces={['common', 'nav', 'auth', 'errors']}>
      <AppShell brand={t('app.name')} navigation={[]} topBar={<LocaleSwitch />}>
        {children}
      </AppShell>
    </RootHtml>
  );
}
