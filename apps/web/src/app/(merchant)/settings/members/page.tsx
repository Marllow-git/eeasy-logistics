import { client } from '@eeasy-logistics/contracts/staff';
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { getLocale, getTranslations } from 'next-intl/server';
import { staffServerFetcher } from '../../../../server/api';
import { siteOptions } from '../../../../server/settings';
import { listPageSize, listParamsOf, type SearchParams } from '../../../../settings/lists';
import { memberListKeys, membersListKey } from '../../../../settings/members/member-keys';
import { MembersScreen } from '../../../../settings/members/members-screen';

/**
 * Members (web §8 wave 0; WEB-3 plan 2.7): the first page of `listMembers` for the URL's filters
 * and the account's sites (the site filter and the invite's choices), read on the server and
 * hydrated into the client cache under the keys the list reads (web §2.3).
 */
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [nav, fetcher, locale, search] = await Promise.all([
    getTranslations('nav'),
    staffServerFetcher(),
    getLocale(),
    searchParams,
  ]);
  const params = listParamsOf(search, memberListKeys);
  const [first, sites] = await Promise.all([
    client.listMembers({ ...params, limit: listPageSize }, { fetcher }),
    siteOptions(fetcher, locale === 'en' ? 'en' : 'ar'),
  ]);
  const queryClient = new QueryClient();
  queryClient.setQueryData([...membersListKey(params), 'cursor-pages'], {
    pages: [first.data],
    pageParams: [undefined],
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MembersScreen title={nav('settings_members')} sites={sites} />
    </HydrationBoundary>
  );
}
