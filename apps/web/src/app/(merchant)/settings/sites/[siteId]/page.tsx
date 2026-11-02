import { ApiError } from '@eeasy-logistics/contracts/http';
import { client, hooks } from '@eeasy-logistics/contracts/staff';
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { notFound } from 'next/navigation';
import { staffServerFetcher } from '../../../../../server/api';
import { getStaffSession } from '../../../../../server/session';
import { siteLimit } from '../../../../../server/settings';
import type { SearchParams } from '../../../../../settings/lists';
import { SiteDetail } from '../../../../../settings/sites/site-detail';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One site (WEB-3 plan 2.8): `getSite` on the server, hydrated for the client, and the account's
 * site limit for the activate refusal; a site the account does not have (or another site of a
 * site-scoped member) is the not-found page (web §7.4).
 */
export default async function SitePage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ siteId }, search, fetcher, me] = await Promise.all([
    params,
    searchParams,
    staffServerFetcher(),
    getStaffSession(),
  ]);
  if (!uuid.test(siteId)) notFound();
  const [answer, limit] = await Promise.all([
    client.getSite(siteId, { fetcher }).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === 'not_found') notFound();
      throw error;
    }),
    siteLimit(fetcher, me.permissions),
  ]);
  const queryClient = new QueryClient();
  queryClient.setQueryData(hooks.getGetSiteQueryKey(siteId), {
    data: answer.data,
    status: answer.status,
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SiteDetail siteId={siteId} siteLimit={limit} created={search.created === '1'} />
    </HydrationBoundary>
  );
}
