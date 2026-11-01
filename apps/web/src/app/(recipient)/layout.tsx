import '@eeasy-logistics/ui/styles.css';
import { AppShell } from '@eeasy-logistics/ui/components/app-shell';
import { RootHtml, rootMetadata } from '@eeasy-logistics/ui/shell';
import { LocaleSwitch } from '@eeasy-logistics/ui/shell/locale-switch';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

export const generateMetadata = rootMetadata;

/**
 * Recipient pages, no account (web §1). Its own root layout (web §1.2): the i18n provider and the
 * frame only, no navigation and no session.
 */
export default async function RecipientLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('common');
  return (
    <RootHtml namespaces={['common', 'nav', 'recipient', 'errors']}>
      <AppShell brand={t('app.name')} navigation={[]} topBar={<LocaleSwitch />}>
        {children}
      </AppShell>
    </RootHtml>
  );
}
