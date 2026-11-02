import '@eeasy-logistics/ui/styles.css';
import { AppShell } from '@eeasy-logistics/ui/components/app-shell';
import { UserMenu } from '@eeasy-logistics/ui/session/user-menu';
import { RootHtml, rootMetadata } from '@eeasy-logistics/ui/shell';
import { LocaleSwitch } from '@eeasy-logistics/ui/shell/locale-switch';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { getStaffSession } from '../../server/session';
import { StaffSession } from '../../session/staff-session';

export const generateMetadata = rootMetadata;

/**
 * Merchant staff area (web §1). Its own root layout: nothing leaks between groups (web §1.2). It
 * reads the session once per request (`getMe`, web §4) and gives it to the client through the
 * session provider; without a session the user goes to sign-in (WEB-2 plan 2.3).
 */
export default async function MerchantLayout({ children }: { children: ReactNode }) {
  const [t, nav, me] = await Promise.all([
    getTranslations('common'),
    getTranslations('nav'),
    getStaffSession(),
  ]);
  return (
    <RootHtml namespaces={['common', 'nav', 'auth', 'errors']}>
      <StaffSession me={me}>
        <AppShell
          brand={t('app.name')}
          account={
            me.account?.name === undefined ? undefined : (
              <p dir="auto" className="truncate text-sm font-semibold text-foreground">
                {me.account.name}
              </p>
            )
          }
          navigation={[{ items: [{ href: '/', label: nav('home') }] }]}
          topBar={
            <>
              <UserMenu />
              <LocaleSwitch />
            </>
          }
        >
          {children}
        </AppShell>
      </StaffSession>
    </RootHtml>
  );
}
