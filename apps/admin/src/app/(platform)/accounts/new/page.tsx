import { client } from '@eeasy-logistics/contracts/platform';
import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { getTranslations } from 'next-intl/server';
import { ProvisionScreen } from '../../../../accounts/provision-screen';
import { platformServerFetcher } from '../../../../server/api';

/**
 * Provision an account (WEB-4 plan 2.3): the registered feature keys come from
 * `platformListRolloutModes` (every registered key, PLAT-13 2.6), read on the server once.
 */
export default async function ProvisionPage() {
  const [t, fetcher] = await Promise.all([getTranslations('platform'), platformServerFetcher()]);
  const answer = await client.platformListRolloutModes({ fetcher });
  const keys =
    answer.status === 200
      ? (answer.data.data ?? []).flatMap((row) => (row.feature_key ? [row.feature_key] : []))
      : [];
  return (
    <>
      <PageHeader title={t('provision.title')} description={t('provision.description')} />
      <ProvisionScreen featureKeys={keys} />
    </>
  );
}
