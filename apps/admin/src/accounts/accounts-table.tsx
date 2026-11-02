'use client';

import { client, hooks, type Account } from '@eeasy-logistics/contracts/platform';
import { formatDateTime } from '@eeasy-logistics/i18n';
import { Button } from '@eeasy-logistics/ui/components/button';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { DataTable, type DataTableColumn } from '@eeasy-logistics/ui/table';
import { useCursorList } from '@eeasy-logistics/ui/table/cursor-list';
import { ChipFilter, SearchFilter } from '@eeasy-logistics/ui/table/filters';
import { useListParams } from '@eeasy-logistics/ui/table/list-params';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { AccountStatusChip, LoadError, ShortId } from './parts';

// The accounts list (WEB-4 plan 2.3; design references: Snowflake and Plain for the status tabs and
// one search, Square for the empty state after filters): `platformListAccounts` by cursor with
// "load more", the status and the search in the URL, newest first by default; no usage column
// (PLAT-13 2.4) and no total (ADR-0029). A row opens the account.

const statuses = ['provisioned', 'active', 'suspended', 'closed'] as const;
const listKeys = ['status', 'q', 'sort'] as const;

function defined(params: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
}

export function AccountsTable() {
  const t = useTranslations('platform');
  const locale = useLocale();
  const fetcher = useSessionFetcher();
  const router = useRouter();
  const { params, set } = useListParams(listKeys);
  const list = useCursorList<Account>({
    queryKey: hooks.getPlatformListAccountsQueryKey(defined(params)),
    fetchPage: async (cursor, signal) => {
      const answer = await client.platformListAccounts(
        { ...defined(params), cursor, limit: 50 },
        { fetcher, signal },
      );
      return answer.data as { data: Account[]; next_cursor: string | null };
    },
  });
  const filtered = params.status !== undefined || params.q !== undefined;

  const columns = useMemo<DataTableColumn<Account>[]>(
    () => [
      {
        id: 'name',
        header: t('accounts.columns.name'),
        sortField: 'name',
        cell: (account) => (
          <div className="flex min-w-0 flex-col">
            <span dir="auto" className="font-semibold text-foreground">
              {account.name}
            </span>
            <ShortId id={account.id} />
          </div>
        ),
      },
      {
        id: 'status',
        header: t('accounts.columns.status'),
        sortField: 'status',
        cell: (account) => <AccountStatusChip status={account.status} />,
      },
      {
        id: 'locale',
        header: t('accounts.columns.locale'),
        cell: (account) =>
          account.default_locale === undefined ? null : t(`locales.${account.default_locale}`),
      },
      {
        id: 'created',
        header: t('accounts.columns.created'),
        sortField: 'created_at',
        className: 'whitespace-nowrap',
        cell: (account) => (
          <time dateTime={account.created_at}>
            {formatDateTime(locale, account.created_at, { dateStyle: 'medium' })}
          </time>
        ),
      },
    ],
    [t, locale],
  );

  return (
    <DataTable
      id="platform-accounts"
      label={t('accounts.table_label')}
      columns={columns}
      rows={list.rows}
      rowKey={(account) => account.id}
      state={list.state}
      sort={params.sort ?? '-created_at'}
      onSortChange={(sort) => set({ sort })}
      hasMore={list.hasMore}
      loadingMore={list.loadingMore}
      onLoadMore={list.loadMore}
      onRowOpen={(account) => router.push(`/accounts/${account.id}`)}
      toolbar={
        <>
          <ChipFilter
            label={t('accounts.filters.status')}
            allLabel={t('accounts.filters.all')}
            options={statuses.map((status) => ({
              value: status,
              label: t(`account_status.${status}`),
            }))}
            value={params.status}
            onChange={(status) => set({ status })}
          />
          <SearchFilter
            label={t('accounts.filters.search')}
            value={params.q}
            onChange={(q) => set({ q })}
          />
        </>
      }
      empty={
        filtered ? (
          <>
            <p className="text-sm font-semibold text-foreground">{t('accounts.empty_filtered')}</p>
            <p className="text-sm text-muted-foreground">{t('accounts.empty_filtered_hint')}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => set({ status: undefined, q: undefined })}
            >
              {t('accounts.clear_filters')}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-foreground">{t('accounts.empty')}</p>
            <p className="text-sm text-muted-foreground">{t('accounts.empty_hint')}</p>
          </>
        )
      }
      error={<LoadError error={list.error} onRetry={list.retry} />}
    />
  );
}
