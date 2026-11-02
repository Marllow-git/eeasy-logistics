import { ApiError } from '@eeasy-logistics/contracts/http';
import { client, hooks, type Membership } from '@eeasy-logistics/contracts/staff';
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { getLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { staffServerFetcher } from '../../../../../server/api';
import { siteOptions } from '../../../../../server/settings';
import { MemberDetail } from '../../../../../settings/members/member-detail';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One member (WEB-3 plan 2.7): `getMember` on the server, hydrated for the client; a membership
 * the account does not have (or a malformed id) is the not-found page (web §7.4). For an active
 * owner the page also counts the account's active owners, so the last one's owner role shows
 * locked (PLAT-12 2.8).
 */
export default async function MemberPage({
  params,
}: {
  params: Promise<{ membershipId: string }>;
}) {
  const [{ membershipId }, fetcher, locale] = await Promise.all([
    params,
    staffServerFetcher(),
    getLocale(),
  ]);
  if (!uuid.test(membershipId)) notFound();
  const [answer, sites] = await Promise.all([
    client.getMember(membershipId, { fetcher }).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === 'not_found') notFound();
      throw error;
    }),
    siteOptions(fetcher, locale === 'en' ? 'en' : 'ar'),
  ]);
  const member = answer.data as Membership;
  let onlyActiveOwner = false;
  if (member.status === 'active' && (member.roles ?? []).includes('owner')) {
    const owners = await client.listMembers({ status: 'active', limit: 200 }, { fetcher });
    const active = (owners.data as { data?: Membership[] }).data ?? [];
    onlyActiveOwner = active.filter((other) => (other.roles ?? []).includes('owner')).length <= 1;
  }
  const queryClient = new QueryClient();
  queryClient.setQueryData(hooks.getGetMemberQueryKey(membershipId), {
    data: member,
    status: answer.status,
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MemberDetail membershipId={membershipId} sites={sites} onlyActiveOwner={onlyActiveOwner} />
    </HydrationBoundary>
  );
}
