'use client';

import { client, hooks, type OutboxRow } from '@eeasy-logistics/contracts/platform';
import { formatNumber } from '@eeasy-logistics/i18n';
import { useCan } from '@eeasy-logistics/ui/authz';
import { Button } from '@eeasy-logistics/ui/components/button';
import { DateTime } from '@eeasy-logistics/ui/components/date-time';
import { ReasonDialog } from '@eeasy-logistics/ui/components/reason-dialog';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { DataTable, type DataTableColumn } from '@eeasy-logistics/ui/table';
import { useCursorList } from '@eeasy-logistics/ui/table/cursor-list';
import {
  ChipFilter,
  DateFilter,
  SearchFilter,
  SelectFilter,
} from '@eeasy-logistics/ui/table/filters';
import { useListParams } from '@eeasy-logistics/ui/table/list-params';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { LoadError, isolate, shortId } from '../accounts/parts';
import { AccountFilter, useAccountLabel } from '../lists/account-filter';
import { createdRange, definedParams, isUuid } from '../lists/list-dates';
import { AccountReasonDialog, useListReasons } from '../support/list-reasons';
import { bodyReasonMax } from '../support/reason-store';
import { OutboxDrawer } from './outbox-drawer';
import { OutboxKindChip, OutboxStatusChip, outboxKinds, outboxStatuses } from './outbox-parts';

// The outbox (web §8 wave 0; WEB-4 plan 2.8; design references: Buffer's status tabs and the
// failure on its row, Gumloop's drawer, AirOps' bulk action in the header with a count confirm):
// `platformListOutbox` by cursor, newest first, filtered in the URL by status (tabs without counts,
// ADR-0029), kind, type, aggregate, account and days. Without an account the rows are metadata
// only; choosing an account asks the support reason for it (2.4's dialog, the tab's memory) and
// the list then reads through its door. A row opens the drawer. "Replay dead rows…" needs the
// account filter (PLAT-8 M-1) and is never one click.

const listKeys = [
  'status',
  'kind',
  'type',
  'aggregate_id',
  'account_id',
  'created_from',
  'created_to',
] as const;

/** Rows per page: the contract's default. */
const pageSize = 50;

export function OutboxTable() {
  const t = useTranslations('platform.outbox');
  const locale = useLocale();
  const fetcher = useSessionFetcher();
  const queryClient = useQueryClient();
  const router = useRouter();
  const canReplay = useCan('platform.outbox.replay');
  const { params, set } = useListParams(listKeys);
  const reasons = useListReasons();
  const [open, setOpen] = useState<OutboxRow | null>(null);
  const [bulk, setBulk] = useState(false);
  const [bulkDone, setBulkDone] = useState<string | null>(null);

  const accountId = isUuid(params.account_id) ? params.account_id.toLowerCase() : undefined;
  const accountLabel = useAccountLabel(accountId);
  const reason = reasons.reasonOf(accountId);
  // Every list read carries a reason: the account's, or the platform-wide one (8.2).
  const waiting = reason === undefined;
  const query = {
    ...definedParams({
      status: params.status,
      kind: params.kind as OutboxRow['kind'] | undefined,
      type: params.type,
      aggregate_id: isUuid(params.aggregate_id) ? params.aggregate_id : undefined,
      account_id: accountId,
    }),
    ...createdRange(params),
  };
  const list = useCursorList<OutboxRow>({
    // The reason is part of the key: a list read without the door is never shown as one with it.
    queryKey: [...hooks.getPlatformListOutboxQueryKey(query), reason ?? ''],
    enabled: !waiting,
    fetchPage: async (cursor, signal) => {
      const answer = await client.platformListOutbox(
        { ...query, cursor, limit: pageSize },
        { fetcher, signal, headers: reasons.headersOf(accountId) },
      );
      return answer.data as { data: OutboxRow[]; next_cursor: string | null };
    },
  });
  const filtered = listKeys.some((key) => params[key] !== undefined);

  const columns = useMemo<DataTableColumn<OutboxRow>[]>(
    () => [
      {
        id: 'created',
        header: t('columns.created'),
        className: 'whitespace-nowrap',
        cell: (row) => <DateTime value={row.created_at} />,
      },
      {
        id: 'kind',
        header: t('columns.kind'),
        cell: (row) => <OutboxKindChip kind={row.kind} />,
      },
      {
        id: 'type',
        header: t('columns.type'),
        cell: (row) => (
          <div className="flex min-w-0 flex-col gap-1">
            <bdi dir="ltr" className="self-start font-mono text-xs text-foreground">
              {row.type}
            </bdi>
            {/* The failure on its row (Buffer), in the stable form the worker wrote. */}
            {row.last_error ? (
              <p className="flex flex-wrap gap-1 text-xs text-danger">
                <span>{t('last_error')}</span>
                <bdi dir="ltr" className="font-mono break-all">
                  {row.last_error}
                </bdi>
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        cell: (row) => <OutboxStatusChip status={row.status} />,
      },
      {
        id: 'attempts',
        header: t('columns.attempts'),
        cell: (row) => formatNumber(locale, row.attempts),
      },
      {
        id: 'next',
        header: t('columns.next_attempt'),
        className: 'whitespace-nowrap',
        cell: (row) =>
          row.next_attempt_at && (row.status === 'pending' || row.status === 'enqueued') ? (
            <DateTime value={row.next_attempt_at} />
          ) : (
            <span className="text-muted-foreground">{t('none')}</span>
          ),
      },
      {
        id: 'account',
        header: t('columns.account'),
        cell: (row) =>
          row.account_id === null ? (
            <span className="text-muted-foreground">{t('platform_only')}</span>
          ) : (
            <span className="text-muted-foreground">{isolate(shortId(row.account_id))}</span>
          ),
      },
    ],
    [t, locale],
  );

  const kindLabel = (kind: string) => t(`kinds.${kind as 'webhook'}`);
  const bulkKind = params.kind as OutboxRow['kind'] | undefined;

  const toolbar = (
    <>
      <ChipFilter
        label={t('filters.status')}
        allLabel={t('filters.all')}
        options={outboxStatuses.map((status) => ({
          value: status,
          label: t(`statuses.${status}`),
        }))}
        value={params.status}
        onChange={(status) => set({ status })}
      />
      <SelectFilter
        label={t('filters.kind')}
        allLabel={t('filters.all_kinds')}
        options={outboxKinds.map((kind) => ({ value: kind, label: kindLabel(kind) }))}
        value={params.kind}
        onChange={(kind) => set({ kind })}
      />
      <AccountFilter value={accountId} onChange={(account_id) => set({ account_id })} />
      <SearchFilter
        label={t('filters.type')}
        value={params.type}
        onChange={(type) => set({ type })}
        dir="ltr"
      />
      <SearchFilter
        label={t('filters.aggregate_id')}
        value={params.aggregate_id}
        onChange={(aggregate_id) => set({ aggregate_id })}
        valid={isUuid}
        invalidMessage={t('filters.invalid_id')}
        dir="ltr"
      />
      <DateFilter
        label={t('filters.from')}
        value={params.created_from}
        onChange={(created_from) => set({ created_from })}
      />
      <DateFilter
        label={t('filters.to')}
        value={params.created_to}
        min={params.created_from}
        onChange={(created_to) => set({ created_to })}
      />
      {canReplay ? (
        <div className="flex flex-col gap-1">
          <Button
            variant="secondary"
            disabled={accountId === undefined || bulkKind === undefined || waiting}
            aria-describedby="outbox-bulk-why"
            onClick={() => setBulk(true)}
          >
            {t('bulk.button')}
          </Button>
          <p id="outbox-bulk-why" className="max-w-56 text-xs text-muted-foreground">
            {accountId === undefined || bulkKind === undefined ? t('bulk.needs_filter') : null}
          </p>
        </div>
      ) : null}
    </>
  );

  return (
    <>
      <p role="status" className="mb-3 text-sm text-foreground empty:hidden">
        {bulkDone}
      </p>
      <DataTable
        id="platform-outbox"
        label={t('table_label')}
        columns={columns}
        rows={list.rows}
        rowKey={(row) => row.id}
        state={waiting ? 'ready' : list.state}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        onLoadMore={list.loadMore}
        onRowOpen={setOpen}
        toolbar={toolbar}
        empty={
          waiting ? (
            <p className="text-sm text-muted-foreground">{t('needs_reason')}</p>
          ) : filtered ? (
            <>
              <p className="text-sm text-foreground">{t('empty_filtered')}</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => set(Object.fromEntries(listKeys.map((key) => [key, undefined])))}
              >
                {t('clear_filters')}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          )
        }
        error={<LoadError error={list.error} onRetry={list.retry} />}
      />
      {waiting ? (
        <AccountReasonDialog
          accountId={accountId}
          accountLabel={accountLabel}
          onCancel={() =>
            accountId === undefined ? router.push('/') : set({ account_id: undefined })
          }
        />
      ) : null}
      {open === null ? null : <OutboxDrawer row={open} onClose={() => setOpen(null)} />}
      {bulk && accountId !== undefined && bulkKind !== undefined ? (
        <ReasonDialog
          open
          onOpenChange={setBulk}
          title={t('bulk.title', { name: accountLabel, kind: kindLabel(bulkKind) })}
          description={t('bulk.description')}
          consequences={[t('bulk.limit'), t('bulk.rules')]}
          confirmLabel={t('bulk.confirm')}
          tone="danger"
          max={bodyReasonMax}
          initialReason={reason}
          onConfirm={async (text, idempotencyKey) => {
            const range = createdRange(params);
            const answer = await client.platformReplayDeadOutbox(
              {
                account_id: accountId,
                kind: bulkKind,
                ...(params.type === undefined ? {} : { type: params.type }),
                ...range,
                reason: text,
              },
              { fetcher, headers: { 'Idempotency-Key': idempotencyKey } },
            );
            const counts = answer.data as { matched?: number; replayed?: number };
            setBulkDone(
              t('bulk.done', {
                matched: formatNumber(locale, counts.matched ?? 0),
                replayed: formatNumber(locale, counts.replayed ?? 0),
              }),
            );
            await queryClient.invalidateQueries({ queryKey: ['/v1/platform/outbox'] });
          }}
        />
      ) : null}
    </>
  );
}
