import '@eeasy-logistics/ui/styles.css';
import { AppShell } from '@eeasy-logistics/ui/components/app-shell';
import { RootHtml, rootMetadata } from '@eeasy-logistics/ui/shell';
import { UserMenu } from '@eeasy-logistics/ui/session/user-menu';
import { LocaleSwitch } from '@eeasy-logistics/ui/shell/locale-switch';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { getPlatformSession } from '../../server/session';
import { PlatformSession } from '../../session/platform-session';

export const generateMetadata = rootMetadata;

/**
 * Platform console at the admin hostname's root (web §1; no /platform segment, ADR-0038). Its own
 * root layout (web §1.2) in the shared shell. It reads the session once per request
 * (`platformGetMe`, web §4) and gives it to the client through the session provider on the
 * platform surface (its cookies, the `el-platform-refresh` lock, the TOTP re-sign-in); without a
 * session the user goes to sign-in (WEB-2 plan 2.3, 2.9). The navigation groups are placeholders
 * for the console's areas (web §1 tree: accounts, rollout, outbox, channel publications, staff,
 * audit); until their orders build the pages they link to `/` and are never marked current. The
 * account block names the console (staff belong to no account); the user slot names the staff
 * member.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const [common, t, me] = await Promise.all([
    getTranslations('common'),
    getTranslations('platform'),
    getPlatformSession(),
  ]);
  return (
    <RootHtml namespaces={['common', 'nav', 'auth', 'errors']}>
      <PlatformSession me={me}>
        <AppShell
          brand={common('app.name')}
          account={<p className="text-xs font-semibold text-muted-foreground">{t('console')}</p>}
          navigation={[
            { items: [{ href: '/', label: t('nav.home') }] },
            {
              label: t('nav.groups.accounts'),
              items: [
                { href: '/', active: false, label: t('nav.accounts') },
                { href: '/', active: false, label: t('nav.rollout') },
              ],
            },
            {
              label: t('nav.groups.operations'),
              items: [
                { href: '/', active: false, label: t('nav.outbox') },
                { href: '/', active: false, label: t('nav.channel_publications') },
              ],
            },
            {
              label: t('nav.groups.governance'),
              items: [
                { href: '/', active: false, label: t('nav.staff') },
                { href: '/', active: false, label: t('nav.audit') },
              ],
            },
          ]}
          topBar={
            <>
              <UserMenu />
              <LocaleSwitch />
            </>
          }
        >
          {children}
        </AppShell>
      </PlatformSession>
    </RootHtml>
  );
}
