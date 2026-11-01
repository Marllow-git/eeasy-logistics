import '@eeasy-logistics/ui/styles.css';
import { AppShell } from '@eeasy-logistics/ui/components/app-shell';
import { RootHtml, rootMetadata } from '@eeasy-logistics/ui/shell';
import { LocaleSwitch } from '@eeasy-logistics/ui/shell/locale-switch';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

export const generateMetadata = rootMetadata;

/**
 * Platform console at the admin hostname's root (web §1; no /platform segment, ADR-0038). Its own
 * root layout (web §1.2) in the shared shell. The navigation groups are placeholders for the
 * console's areas (web §1 tree: accounts, rollout, outbox, channel publications, staff, audit);
 * their pages arrive with the orders that build them. The account block names the console until
 * WEB-2 puts the signed-in staff member there.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const [common, t] = await Promise.all([getTranslations('common'), getTranslations('platform')]);
  return (
    <RootHtml namespaces={['common', 'nav', 'errors']}>
      <AppShell
        brand={common('app.name')}
        account={<p className="text-xs font-semibold text-muted-foreground">{t('console')}</p>}
        navigation={[
          { items: [{ href: '/', label: t('nav.home') }] },
          {
            label: t('nav.groups.accounts'),
            items: [
              { href: '/accounts', label: t('nav.accounts') },
              { href: '/rollout', label: t('nav.rollout') },
            ],
          },
          {
            label: t('nav.groups.operations'),
            items: [
              { href: '/outbox', label: t('nav.outbox') },
              { href: '/channel-publications', label: t('nav.channel_publications') },
            ],
          },
          {
            label: t('nav.groups.governance'),
            items: [
              { href: '/staff', label: t('nav.staff') },
              { href: '/audit', label: t('nav.audit') },
            ],
          },
        ]}
        topBar={<LocaleSwitch />}
      >
        {children}
      </AppShell>
    </RootHtml>
  );
}
