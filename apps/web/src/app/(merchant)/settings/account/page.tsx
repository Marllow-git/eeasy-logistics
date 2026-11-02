import { client, hooks } from '@eeasy-logistics/contracts/staff';
import { Card, CardContent, CardHeader, CardTitle } from '@eeasy-logistics/ui/components/card';
import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { getTranslations } from 'next-intl/server';
import { staffServerFetcher } from '../../../../server/api';
import { AccountSettingsScreen } from '../../../../settings/account-settings-screen';
import { UsageFacts } from '../../../../settings/usage';

/**
 * Account settings (web §8 wave 0; WEB-3 plan 2.6): the limits and usage read-only, then one form
 * per section. The settings are read on the server into a per-request query client and handed to
 * the client cache through `HydrationBoundary` (web §2.3), so the forms render filled and keep
 * the cache current after each save.
 */
export default async function AccountSettingsPage() {
  const [nav, t, fetcher] = await Promise.all([
    getTranslations('nav'),
    getTranslations('settings.account'),
    staffServerFetcher(),
  ]);
  const [settings, account] = await Promise.all([
    client.getAccountSettings({ fetcher }),
    client.getAccount({ fetcher }),
  ]);
  const queryClient = new QueryClient();
  // The response's `Headers` cannot cross to the client; nothing there reads them.
  queryClient.setQueryData(hooks.getGetAccountSettingsQueryKey(), {
    data: settings.data,
    status: settings.status,
  });

  return (
    <>
      <PageHeader title={nav('settings_account')} description={t('description')} />
      {account.status === 200 ? (
        <Card aria-labelledby="account-limits" className="mb-6">
          <CardHeader>
            <CardTitle id="account-limits">{t('limits_title')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('limits_description')}</p>
          </CardHeader>
          <CardContent>
            <UsageFacts account={account.data} labelledBy="account-limits" />
          </CardContent>
        </Card>
      ) : null}
      <HydrationBoundary state={dehydrate(queryClient)}>
        <AccountSettingsScreen />
      </HydrationBoundary>
    </>
  );
}
