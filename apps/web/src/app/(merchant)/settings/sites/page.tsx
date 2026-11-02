import { client, type ListSitesParams } from '@eeasy-logistics/contracts/staff';
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { getLocale, getTranslations } from 'next-intl/server';
import { staffServerFetcher } from '../../../../server/api';
import { listPageSize, listParamsOf, type SearchParams } from '../../../../settings/lists';
import { defaultSiteSort, siteListKeys, sitesListKey } from '../../../../settings/sites/site-keys';
import { SitesScreen } from '../../../../settings/sites/sites-screen';

/**
 * Sites (web §8 wave 0; WEB-3 plan 2.8): the first page of `listSites` for the URL's filters,
 * sorted by the name in the reader's language unless the URL says otherwise, read on the server
 * and hydrated under the key the list reads (web §2.3).
 */
export default async function SitesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [nav, fetcher, locale, search] = await Promise.all([
    getTranslations('nav'),
    staffServerFetcher(),
    getLocale(),
    searchParams,
  ]);
  const params = listParamsOf(search, siteListKeys);
  const query = { ...params, sort: params.sort ?? defaultSiteSort(locale), limit: listPageSize };
  const first = await client.listSites(query as ListSitesParams, { fetcher });
  const queryClient = new QueryClient();
  queryClient.setQueryData([...sitesListKey(params, locale), 'cursor-pages'], {
    pages: [first.data],
    pageParams: [undefined],
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SitesScreen title={nav('settings_sites')} />
    </HydrationBoundary>
  );
}
