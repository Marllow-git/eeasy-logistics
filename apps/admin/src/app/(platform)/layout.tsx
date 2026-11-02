import '@eeasy-logistics/ui/styles.css';
import { AppShell } from '@eeasy-logistics/ui/components/app-shell';
import { QueryProvider } from '@eeasy-logistics/ui/query';
import { RootHtml, rootMetadata } from '@eeasy-logistics/ui/shell';
import { UserMenu } from '@eeasy-logistics/ui/session/user-menu';
import { LocaleSwitch } from '@eeasy-logistics/ui/shell/locale-switch';
import { pickMessages, timeZone, type Locale } from '@eeasy-logistics/i18n';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { appMessages } from '../../i18n/messages';
import { navigationFor } from '../../routes';
import { getPlatformSession } from '../../server/session';
import { PlatformSession } from '../../session/platform-session';
import { SupportReasonJanitor } from '../../support/support-reason';

export const generateMetadata = rootMetadata;

/**
 * Platform console at the admin hostname's root (web §1; no /platform segment, ADR-0038). Its own
 * root layout (web §1.2) in the shared shell. It reads the session once per request
 * (`platformGetMe`, web §4) and gives it to the client through the session provider on the
 * platform surface (its cookies, the `el-platform-refresh` lock, the TOTP re-sign-in); without a
 * session the user goes to sign-in (WEB-2 plan 2.3, 2.9). The navigation renders from the route
 * manifest filtered by the session's permissions, and client components share one query cache
 * under the session (WEB-4 plan 2.1, WEB-3's provider). The account block names the console
 * (staff belong to no account); the user slot names the staff member.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const [common, t, me, requested] = await Promise.all([
    getTranslations('common'),
    getTranslations('platform'),
    getPlatformSession(),
    getLocale(),
  ]);
  const locale: Locale = requested === 'en' ? 'en' : 'ar';
  // The console's screens are client components that read `platform` too: this app's namespace
  // joins the shared ones on the client here, never in apps/web (ADR-0038).
  // The shared member-role, member and audit labels of `settings` (packages/i18n) serve the
  // account's Members and Audit tabs and the platform audit log (WEB-4 plan 2.7, 2.11); the rest
  // of the merchant settings catalogue stays out of the console's client.
  const { roles, members, audit } = pickMessages(locale, ['settings']).settings;
  const clientMessages = {
    ...pickMessages(locale, ['common', 'nav', 'auth', 'errors']),
    settings: { roles, members, audit },
    ...appMessages[locale],
  };
  return (
    <RootHtml namespaces={['common', 'nav', 'auth', 'errors']}>
      <NextIntlClientProvider locale={locale} messages={clientMessages} timeZone={timeZone}>
        <PlatformSession me={me}>
          <SupportReasonJanitor />
          <QueryProvider>
            <AppShell
              brand={common('app.name')}
              account={
                <p className="text-xs font-semibold text-muted-foreground">{t('console')}</p>
              }
              navigation={navigationFor(me).map(({ group, items }) => ({
                label: group === 'main' ? undefined : t(`nav.groups.${group}`),
                items: items.map((item) => ({
                  href: item.href,
                  label: t(`nav.${item.label}`),
                  match: item.prefix ? ('prefix' as const) : ('exact' as const),
                })),
              }))}
              topBar={
                <>
                  <UserMenu />
                  <LocaleSwitch />
                </>
              }
            >
              {children}
            </AppShell>
          </QueryProvider>
        </PlatformSession>
      </NextIntlClientProvider>
    </RootHtml>
  );
}
