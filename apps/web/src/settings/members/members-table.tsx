'use client';

import { client, type Me, type Membership } from '@eeasy-logistics/contracts/staff';
import { roleBundles, type RoleKey } from '@eeasy-logistics/contracts/unions';
import { formatDateTime, formatNumber } from '@eeasy-logistics/i18n';
import { Badge } from '@eeasy-logistics/ui/components/badge';
import { Button } from '@eeasy-logistics/ui/components/button';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { useSession, useSessionFetcher } from '@eeasy-logistics/ui/session';
import { MemberStatusChip, RoleChip } from '@eeasy-logistics/ui/settings/status-chips';
import { DataTable, type DataTableColumn } from '@eeasy-logistics/ui/table';
import { useCursorList } from '@eeasy-logistics/ui/table/cursor-list';
import { ChipFilter, SearchFilter, SelectFilter } from '@eeasy-logistics/ui/table/filters';
import { useListParams } from '@eeasy-logistics/ui/table/list-params';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { ListError } from '../list-error';
import { definedParams, listPageSize } from '../lists';
import { siteName, type SiteOption } from '../site-options';
import { memberListKeys, membersListKey } from './member-keys';

// The members list (web §8 wave 0; WEB-3 plan 2.7): memberships by cursor with "load more", the
// status, site and search filters in the URL, sorted by the API's `sort`; a row opens the member.
// The first page comes hydrated from the server (members/page.tsx) under the same query key.

const statuses = ['active', 'invited', 'revoked'] as const;

/** Site-scoped roles work at their `site_ids` only; the others see every site (roles.yaml). */
function siteScoped(roles: readonly string[] | undefined): boolean {
  return (roles ?? []).some((role) => roleBundles[role as RoleKey]?.siteScoped === true);
}

export function MembersTable({ sites }: { sites: readonly SiteOption[] }) {
  const t = useTranslations('settings.members');
  const locale = useLocale();
  const fetcher = useSessionFetcher();
  const router = useRouter();
  const me = useSession<Me>();
  const { params, set } = useListParams(memberListKeys);
  const list = useCursorList<Membership>({
    queryKey: membersListKey(params),
    fetchPage: async (cursor, signal) => {
      const answer = await client.listMembers(
        { ...definedParams(params), cursor, limit: listPageSize },
        { fetcher, signal },
      );
      return answer.data as { data: Membership[]; next_cursor: string | null };
    },
  });
  const filtered =
    params.status !== undefined || params.site_id !== undefined || params.q !== undefined;

  const columns = useMemo<DataTableColumn<Membership>[]>(
    () => [
      {
        id: 'name',
        header: t('columns.name'),
        sortField: 'name',
        cell: (member) => (
          <div className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2 font-semibold text-foreground">
              <span dir="auto">{member.user?.name}</span>
              {member.id === me.membership?.id ? <Badge>{t('you')}</Badge> : null}
            </span>
            <span dir="ltr" className="self-start text-muted-foreground">
              {member.user?.email}
            </span>
          </div>
        ),
      },
      {
        id: 'roles',
        header: t('columns.roles'),
        cell: (member) => (
          <div className="flex flex-wrap gap-1">
            {(member.roles ?? []).map((role) => (
              <RoleChip key={role} role={role} />
            ))}
          </div>
        ),
      },
      {
        id: 'sites',
        header: t('columns.sites'),
        cell: (member) => {
          if (!siteScoped(member.roles)) return t('sites_all');
          const count = member.site_ids?.length ?? 0;
          return count === 0
            ? t('sites_none')
            : t('sites_count', { count, value: formatNumber(locale, count) });
        },
      },
      {
        id: 'status',
        header: t('columns.status'),
        sortField: 'status',
        cell: (member) => <MemberStatusChip status={member.status} />,
      },
      {
        id: 'joined',
        header: t('columns.joined'),
        sortField: 'created_at',
        cell: (member) =>
          member.created_at ? (
            <time dateTime={member.created_at}>
              {formatDateTime(locale, member.created_at, { dateStyle: 'medium' })}
            </time>
          ) : null,
        className: 'whitespace-nowrap',
      },
    ],
    [t, locale, me.membership?.id],
  );

  const toolbar = (
    <>
      <ChipFilter
        label={t('filters.status')}
        allLabel={t('filters.all')}
        options={statuses.map((status) => ({ value: status, label: t(`status.${status}`) }))}
        value={params.status}
        onChange={(status) => set({ status })}
      />
      {sites.length > 0 ? (
        <SelectFilter
          label={t('filters.site')}
          allLabel={t('filters.all_sites')}
          options={sites.map((site) => ({ value: site.id, label: siteName(site, locale) }))}
          value={params.site_id}
          onChange={(site_id) => set({ site_id })}
        />
      ) : null}
      <SearchFilter label={t('filters.search')} value={params.q} onChange={(q) => set({ q })} />
    </>
  );

  return (
    <DataTable
      id="settings-members"
      label={t('table_label')}
      columns={columns}
      rows={list.rows}
      rowKey={(member) => member.id}
      state={list.state}
      sort={params.sort ?? '-created_at'}
      onSortChange={(sort) => set({ sort })}
      hasMore={list.hasMore}
      loadingMore={list.loadingMore}
      onLoadMore={list.loadMore}
      onRowOpen={(member) => router.push(`/settings/members/${member.id}`)}
      toolbar={toolbar}
      empty={
        filtered ? (
          <>
            <p className="text-sm text-foreground">{t('empty_filtered')}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => set({ status: undefined, site_id: undefined, q: undefined })}
            >
              {t('clear_filters')}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-foreground">{t('empty')}</p>
            <p className="text-sm text-muted-foreground">{t('empty_hint')}</p>
          </>
        )
      }
      error={<ListError error={list.error} onRetry={list.retry} />}
    />
  );
}
