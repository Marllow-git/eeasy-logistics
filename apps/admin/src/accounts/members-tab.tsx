'use client';

import { client, hooks, type Membership } from '@eeasy-logistics/contracts/platform';
import { formatNumber } from '@eeasy-logistics/i18n';
import { Badge } from '@eeasy-logistics/ui/components/badge';
import { DateTime } from '@eeasy-logistics/ui/components/date-time';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { DataTable, type DataTableColumn } from '@eeasy-logistics/ui/table';
import { useCursorList } from '@eeasy-logistics/ui/table/cursor-list';
import { useListParams } from '@eeasy-logistics/ui/table/list-params';
import { useMemo } from 'react';
import { useSupportReason } from '../support/support-reason';
import { LoadError } from './parts';

// The account's Members tab (WEB-4 plan 2.7; WEB-3's members table shape): who works on the
// account, read through the door with the tab's support reason (`platformListAccountMembers`,
// `platform.tenants.read`), by cursor with "load more", sorted in the URL. Read only: support reads,
// the merchant's owner acts. The operation takes no filter (only cursor, limit and sort), so the
// status and site filters of WEB-3's list are not offered here.

const statusTone = { active: 'success', invited: 'warning', revoked: 'neutral' } as const;
const listKeys = ['sort'] as const;

export function MembersTab({ accountId }: { accountId: string }) {
  const t = useTranslations('settings');
  const p = useTranslations('platform.members');
  const locale = useLocale();
  const fetcher = useSessionFetcher();
  const { headers } = useSupportReason();
  const { params, set } = useListParams(listKeys);
  const sort = params.sort ?? '-created_at';
  const list = useCursorList<Membership>({
    queryKey: [...hooks.getPlatformListAccountMembersQueryKey(accountId, { sort }), headers],
    fetchPage: async (cursor, signal) => {
      const answer = await client.platformListAccountMembers(
        accountId,
        { cursor, limit: 50, sort },
        { fetcher, signal, headers },
      );
      return answer.data as { data: Membership[]; next_cursor: string | null };
    },
  });

  const columns = useMemo<DataTableColumn<Membership>[]>(
    () => [
      {
        id: 'name',
        header: t('members.columns.name'),
        cell: (member) => (
          <div className="flex min-w-0 flex-col">
            <span dir="auto" className="font-semibold text-foreground">
              {member.user?.name}
            </span>
            {member.user?.email ? (
              <bdi dir="ltr" className="self-start text-xs text-muted-foreground">
                {member.user.email}
              </bdi>
            ) : null}
          </div>
        ),
      },
      {
        id: 'roles',
        header: t('members.columns.roles'),
        cell: (member) => (
          <div className="flex flex-wrap gap-1">
            {(member.roles ?? []).map((role) => (
              <Badge key={role} tone="neutral">
                {t.has(`roles.${role}` as never) ? t(`roles.${role}` as never) : role}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        id: 'sites',
        header: t('members.columns.sites'),
        cell: (member) => {
          const count = member.site_ids?.length ?? 0;
          return count === 0
            ? t('members.sites_all')
            : t('members.sites_count', { count, value: formatNumber(locale, count) });
        },
      },
      {
        id: 'status',
        header: t('members.columns.status'),
        cell: (member) =>
          member.status === undefined ? null : (
            <Badge tone={statusTone[member.status]}>{t(`members.status.${member.status}`)}</Badge>
          ),
      },
      {
        id: 'joined',
        header: t('members.columns.joined'),
        sortField: 'created_at',
        className: 'whitespace-nowrap',
        cell: (member) => <DateTime value={member.created_at} dateStyle="medium" />,
      },
    ],
    [t, locale],
  );

  return (
    <section aria-labelledby="members-title" className="flex flex-col gap-3">
      <div>
        <h2 id="members-title" className="text-lg font-semibold text-foreground">
          {p('title')}
        </h2>
        <p className="text-sm text-muted-foreground">{p('description')}</p>
      </div>
      <DataTable
        id="platform-account-members"
        label={p('table_label')}
        columns={columns}
        rows={list.rows}
        rowKey={(member) => member.id}
        state={list.state}
        sort={sort}
        onSortChange={(next) => set({ sort: next })}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        onLoadMore={list.loadMore}
        empty={<p className="text-sm text-muted-foreground">{p('empty')}</p>}
        error={<LoadError error={list.error} onRetry={list.retry} />}
      />
    </section>
  );
}
