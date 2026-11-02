import { client } from '@eeasy-logistics/contracts/staff';
import { Button } from '@eeasy-logistics/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@eeasy-logistics/ui/components/card';
import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { openModules, routeOf, routeOpen } from '../../routes';
import { staffServerFetcher } from '../../server/api';
import { getStaffSession } from '../../server/session';
import { UsageFacts } from '../../settings/usage';

/**
 * The merchant home (web §8 wave 0; WEB-3 plan 2.5): a greeting with the user and the account,
 * the modules the account sees (`Me.features`; none until the platform enables one), the settings
 * card for those who may open the settings, and the account's limits for those who may read the
 * account. Server-rendered from `getMe` (the layout's, cached) and `getAccount`.
 */
export default async function MerchantHomePage() {
  const [nav, t, me] = await Promise.all([
    getTranslations('nav'),
    getTranslations('settings.home'),
    getStaffSession(),
  ]);
  const settings = routeOf('/settings/account');
  const readsAccount = routeOpen(settings, me);
  const account = readsAccount
    ? await client.getAccount({ fetcher: await staffServerFetcher() })
    : undefined;
  const modules = openModules(me);
  const name = me.user?.name ?? '';
  const accountName = me.account?.name ?? '';

  return (
    <>
      <PageHeader
        title={nav('home')}
        description={
          <>
            <span className="block text-base font-semibold text-foreground" dir="auto">
              {t('greeting', { name })}
            </span>
            <span dir="auto">{t('account_line', { account: accountName })}</span>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card aria-labelledby="home-modules">
          <CardHeader>
            <CardTitle id="home-modules">{t('modules_title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {modules.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('modules_empty')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {modules.map((route) => (
                  <li key={route.path}>
                    <Link href={route.path} className="text-sm font-semibold underline">
                      {route.navigation ? nav(route.navigation.label) : route.path}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        {readsAccount ? (
          <Card aria-labelledby="home-settings">
            <CardHeader>
              <CardTitle id="home-settings">{t('settings_card_title')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">{t('settings_card_body')}</p>
              <Button asChild variant="secondary">
                <Link href={settings.path}>{t('settings_card_open')}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
        {account?.status === 200 ? (
          <Card aria-labelledby="home-facts" className="lg:col-span-2">
            <CardHeader>
              <CardTitle id="home-facts">{t('facts_title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <UsageFacts account={account.data} labelledBy="home-facts" />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
