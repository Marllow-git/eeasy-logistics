import { client, type Membership } from '@eeasy-logistics/contracts/staff';
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { getTranslations } from 'next-intl/server';
import { staffServerFetcher } from '../../../../server/api';
import { getStaffSession } from '../../../../server/session';
import { auditListKey, auditListKeys, auditQuery } from '../../../../settings/audit/audit-keys';
import { AuditScreen } from '../../../../settings/audit/audit-screen';
import { listPageSize, listParamsOf, type SearchParams } from '../../../../settings/lists';

/**
 * The audit log (web §8 wave 0; WEB-3 plan 2.9): a read-only page rendered from the server's first
 * page of `listAuditLog` for the URL's filters (web §2.3), hydrated so "load more" continues in the
 * browser. The account's members name the actors (`listMembers`, when the session may read them;
 * every role holding `core.audit.read` does).
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [nav, fetcher, me, search] = await Promise.all([
    getTranslations('nav'),
    staffServerFetcher(),
    getStaffSession(),
    searchParams,
  ]);
  const params = listParamsOf(search, auditListKeys);
  const readsMembers = (me.permissions ?? []).includes('core.members.read');
  const [first, members] = await Promise.all([
    client.listAuditLog({ ...auditQuery(params), limit: listPageSize }, { fetcher }),
    readsMembers ? client.listMembers({ limit: 200 }, { fetcher }) : undefined,
  ]);
  const actors: Record<string, string> = {};
  for (const member of (members?.data as { data?: Membership[] } | undefined)?.data ?? []) {
    if (member.user?.id !== undefined && member.user.name)
      actors[member.user.id] = member.user.name;
  }
  const queryClient = new QueryClient();
  queryClient.setQueryData([...auditListKey(params), 'cursor-pages'], {
    pages: [first.data],
    pageParams: [undefined],
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AuditScreen title={nav('settings_audit')} actors={actors} />
    </HydrationBoundary>
  );
}
