'use client';

import { client, type ListSitesParams, type Site } from '@eeasy-logistics/contracts/staff';
import { dir, formatDateTime } from '@eeasy-logistics/i18n';
import { Button } from '@eeasy-logistics/ui/components/button';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { SiteKindChip, SiteStatusChip } from '@eeasy-logistics/ui/settings/status-chips';
import { DataTable, type DataTableColumn } from '@eeasy-logistics/ui/table';
import { useCursorList } from '@eeasy-logistics/ui/table/cursor-list';
import { ChipFilter, SelectFilter } from '@eeasy-logistics/ui/table/filters';
import { useListParams } from '@eeasy-logistics/ui/table/list-params';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { ListError } from '../list-error';
import { definedParams, listPageSize } from '../lists';
import { defaultSiteSort, siteListKeys, sitesListKey } from './site-keys';

// The sites list (web §8 wave 0; WEB-3 plan 2.8): sites by cursor with "load more", the status and
// kind filters in the URL, sorted by the name in the reader's language unless the URL says
// otherwise; a row opens the site. The first page comes hydrated from the server (sites/page.tsx).

const statuses = ['active', 'inactive'] as const;
const kinds = ['branch', 'warehouse', 'both'] as const;

export function SitesTable() {
  const t = useTranslations('settings.sites');
  const locale = useLocale();
  const other = locale === 'ar' ? 'en' : 'ar';
  const fetcher = useSessionFetcher();
  const router = useRouter();
  const { params, set } = useListParams(siteListKeys);
  const sort = params.sort ?? defaultSiteSort(locale);
  const list = useCursorList<Site>({
    queryKey: sitesListKey(params, locale),
    fetchPage: async (cursor, signal) => {
      const query = { ...definedParams(params), sort, cursor, limit: listPageSize };
      const answer = await client.listSites(query as ListSitesParams, { fetcher, signal });
      return answer.data as { data: Site[]; next_cursor: string | null };
    },
  });
  const filtered = params.status !== undefined || params.kind !== undefined;

  const columns = useMemo<DataTableColumn<Site>[]>(
    () => [
      {
        id: 'name',
        header: t('columns.name'),
        sortField: `name_${locale}`,
        cell: (site) => (
          <div className="flex min-w-0 flex-col">
            <span dir="auto" className="font-semibold text-foreground">
              {locale === 'ar' ? site.name_ar : site.name_en}
            </span>
            <span lang={other} dir={dir(other)} className="self-start text-muted-foreground">
              {other === 'ar' ? site.name_ar : site.name_en}
            </span>
          </div>
        ),
      },
      {
        id: 'kind',
        header: t('columns.kind'),
        cell: (site) => <SiteKindChip kind={site.kind} />,
      },
      {
        id: 'address',
        header: t('columns.address'),
        cell: (site) => (
          <div className="flex max-w-80 min-w-0 flex-col">
            {site.national_address_short_code ? (
              <span dir="ltr" lang="en" className="self-start font-mono text-foreground">
                {site.national_address_short_code}
              </span>
            ) : null}
            {site.address_text ? (
              <span dir="auto" className="truncate text-muted-foreground">
                {site.address_text}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        sortField: 'status',
        cell: (site) => <SiteStatusChip status={site.status} />,
      },
      {
        id: 'created',
        header: t('columns.created'),
        sortField: 'created_at',
        className: 'whitespace-nowrap',
        cell: (site) =>
          site.created_at ? (
            <time dateTime={site.created_at}>
              {formatDateTime(locale, site.created_at, { dateStyle: 'medium' })}
            </time>
          ) : null,
      },
    ],
    [t, locale, other],
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
      <SelectFilter
        label={t('filters.kind')}
        allLabel={t('filters.all_kinds')}
        options={kinds.map((kind) => ({ value: kind, label: t(`kinds.${kind}`) }))}
        value={params.kind}
        onChange={(kind) => set({ kind })}
      />
    </>
  );

  return (
    <DataTable
      id="settings-sites"
      label={t('table_label')}
      columns={columns}
      rows={list.rows}
      rowKey={(site) => site.id}
      state={list.state}
      sort={sort}
      onSortChange={(next) => set({ sort: next })}
      hasMore={list.hasMore}
      loadingMore={list.loadingMore}
      onLoadMore={list.loadMore}
      onRowOpen={(site) => router.push(`/settings/sites/${site.id}`)}
      toolbar={toolbar}
      empty={
        filtered ? (
          <>
            <p className="text-sm text-foreground">{t('empty_filtered')}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => set({ status: undefined, kind: undefined })}
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
