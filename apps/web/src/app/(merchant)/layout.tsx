import '@eeasy-logistics/ui/styles.css';
import { AppShell } from '@eeasy-logistics/ui/components/app-shell';
import { RootHtml, rootMetadata } from '@eeasy-logistics/ui/shell';
import { LocaleSwitch } from '@eeasy-logistics/ui/shell/locale-switch';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

export const generateMetadata = rootMetadata;

/** Merchant staff area (web §1). Its own root layout: nothing leaks between groups (web §1.2). */
export default async function MerchantLayout({ children }: { children: ReactNode }) {
  const [t, nav] = await Promise.all([getTranslations('common'), getTranslations('nav')]);
  return (
    <RootHtml namespaces={['common', 'nav', 'errors']}>
      <AppShell
        brand={t('app.name')}
        navigation={[{ items: [{ href: '/', label: nav('home') }] }]}
        topBar={<LocaleSwitch />}
      >
        {children}
      </AppShell>
    </RootHtml>
  );
}
