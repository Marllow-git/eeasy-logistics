'use client';

import { client, type AuditLogEntry } from '@eeasy-logistics/contracts/platform';
import { formatNumber } from '@eeasy-logistics/i18n';
import { Button } from '@eeasy-logistics/ui/components/button';
import { DateTime } from '@eeasy-logistics/ui/components/date-time';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { DataTable, type DataTableColumn } from '@eeasy-logistics/ui/table';
import { useCursorList } from '@eeasy-logistics/ui/table/cursor-list';
import { DateFilter, SearchFilter, SelectFilter } from '@eeasy-logistics/ui/table/filters';
import { useListParams } from '@eeasy-logistics/ui/table/list-params';
import { useRouter } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import { LoadError, isolate, shortId } from '../accounts/parts';
import { AccountFilter, useAccountLabel } from '../lists/account-filter';
import { createdRange, definedParams, isUuid } from '../lists/list-dates';
import { AccountReasonDialog, useListReasons } from '../support/list-reasons';
import { actionKey, auditValue, changedFields } from './audit-values';

// The console's audit tables (WEB-4 plan 2.7, 2.11; WEB-3's audit table shape; design references:
// Customer.io's named facets, Google Ads' "user / date", Gumloop's notice of what is recorded):
// newest first by cursor with "load more", each row's action from the shared catalogue
// (`settings.audit.actions`, packages/i18n), the actor, the object, the reason (the support reason
// of a cross-tenant read, the body reason of a lifecycle, flag, mode, replay or staff change), and
// the before-and-after behind a disclosure. Two scopes: one account's log under its door (the
// account's Audit tab, the frame's reason), and the platform log with its filters in the URL (an
// account filter asks the reason for that account first).

export type AuditScope =
  | {
      readonly kind: 'account';
      readonly accountId: string;
      readonly headers: Record<string, string>;
    }
  | { readonly kind: 'platform' };

const accountKeys = ['created_from', 'created_to'] as const;
const platformKeys = ['account_id', 'actor_id', 'action', 'created_from', 'created_to'] as const;

/** The platform actions a filter offers (the API's `action` values, PLAT-7, PLAT-8, PLAT-13). */
export const platformActions = [
  'platform.cross_tenant.accessed',
  'platform.cross_tenant.refused',
  'core.account.provisioned',
  'core.account.activated',
  'core.account.updated',
  'core.account.suspended',
  'core.account.reactivated',
  'core.account.closed',
  'core.feature_flag.changed',
  'core.rollout_mode.changed',
  'platform.outbox_row.replayed',
  'platform.outbox_rows.replayed',
  'core.platform_staff.invited',
  'core.platform_staff.roles_changed',
  'core.platform_staff.totp_reset',
] as const;

const pageSize = 50;

function Changes({ entry }: { entry: AuditLogEntry }) {
  const t = useTranslations('settings.audit');
  const locale = useLocale();
  const fields = changedFields(entry.before, entry.after);
  if (fields.length === 0) return <span className="text-muted-foreground">{t('no_changes')}</span>;
  const format = {
    number: (value: number) => formatNumber(locale, value),
    boolean: (value: boolean) => t(value ? 'yes' : 'no'),
    none: t('none'),
    separator: locale === 'ar' ? '، ' : ', ',
  };
  const label = (key: string) =>
    t.has(`fields.${key}` as never) ? t(`fields.${key}` as never) : key;
  return (
    <details className="max-w-xl">
      <summary className="cursor-pointer text-sm font-semibold text-primary">
        {t('show_changes')}
      </summary>
      <table className="mt-2 w-full border-collapse text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th scope="col" className="py-1 pe-3 text-start font-semibold">
              {t('field')}
            </th>
            <th scope="col" className="py-1 pe-3 text-start font-semibold">
              {t('before')}
            </th>
            <th scope="col" className="py-1 text-start font-semibold">
              {t('after')}
            </th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.key} className="border-t border-border align-top">
              <th scope="row" className="py-1 pe-3 text-start font-normal text-muted-foreground">
                {label(field.key)}
              </th>
              <td dir="auto" className="py-1 pe-3 break-all">
                {auditValue(field.before, format)}
              </td>
              <td dir="auto" className="py-1 break-all">
                {auditValue(field.after, format)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function AuditTable({ scope }: { scope: AuditScope }) {
  const t = useTranslations('settings.audit');
  const p = useTranslations('platform.audit');
  const fetcher = useSessionFetcher();
  const router = useRouter();
  const platform = scope.kind === 'platform';
  const { params, set } = useListParams(platform ? platformKeys : accountKeys);
  const reasons = useListReasons();
  const filterAccount =
    platform && isUuid(params.account_id) ? params.account_id.toLowerCase() : undefined;
  const filterLabel = useAccountLabel(filterAccount);
  // The platform log carries a reason on every read: the account's, or the platform-wide one (8.2).
  const waiting = platform && reasons.reasonOf(filterAccount) === undefined;
  const headers = platform ? reasons.headersOf(filterAccount) : scope.headers;

  const query = {
    ...definedParams({
      account_id: filterAccount,
      actor_id: platform && isUuid(params.actor_id) ? params.actor_id : undefined,
      action: platform ? params.action : undefined,
    }),
    ...createdRange(params),
  };
  const list = useCursorList<AuditLogEntry>({
    queryKey: [
      platform ? '/v1/platform/audit-log' : `/v1/platform/accounts/${scope.accountId}/audit-log`,
      query,
      headers['X-Support-Reason'] ?? '',
    ],
    enabled: !waiting,
    fetchPage: async (cursor, signal) => {
      const page = { ...query, cursor, limit: pageSize };
      const answer = platform
        ? await client.platformListAudit(page, { fetcher, signal, headers })
        : await client.platformListAccountAudit(scope.accountId, page, {
            fetcher,
            signal,
            headers,
          });
      return answer.data as { data: AuditLogEntry[]; next_cursor: string | null };
    },
  });
  const keys: readonly string[] = platform ? platformKeys : accountKeys;
  const filtered = keys.some(
    (key) => (params as Record<string, string | undefined>)[key] !== undefined,
  );

  const columns = useMemo<DataTableColumn<AuditLogEntry>[]>(() => {
    const label = (key: string, fallback: string | undefined): ReactNode =>
      t.has(key as never) ? t(key as never) : (fallback ?? '');
    const all: (DataTableColumn<AuditLogEntry> | false)[] = [
      {
        id: 'time',
        header: t('columns.time'),
        className: 'whitespace-nowrap',
        cell: (entry) => (entry.occurred_at ? <DateTime value={entry.occurred_at} /> : null),
      },
      {
        id: 'action',
        header: t('columns.action'),
        cell: (entry) => (
          <span className="font-semibold text-foreground">
            {label(`actions.${actionKey(entry.action)}`, entry.action)}
          </span>
        ),
      },
      {
        id: 'actor',
        header: t('columns.actor'),
        cell: (entry) => (
          <div className="flex flex-col">
            <span className="text-foreground">
              {label(`actor_types.${entry.actor_type ?? 'system'}`, entry.actor_type)}
            </span>
            {entry.actor_id && entry.actor_type !== 'system' ? (
              <span className="text-xs text-muted-foreground">
                {isolate(shortId(entry.actor_id))}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: 'target',
        header: t('columns.target'),
        cell: (entry) => (
          <div className="flex flex-col">
            <span className="text-foreground">
              {label(`target_types.${entry.target_type ?? ''}`, entry.target_type)}
            </span>
            {entry.target_id ? (
              <bdi dir="ltr" className="self-start font-mono text-xs text-muted-foreground">
                {entry.target_id.slice(-8)}
              </bdi>
            ) : null}
          </div>
        ),
      },
      platform && {
        id: 'account',
        header: p('columns.account'),
        cell: (entry) =>
          entry.account_id ? (
            <span className="text-muted-foreground">
              {entry.account_id === filterAccount
                ? filterLabel
                : isolate(shortId(entry.account_id))}
            </span>
          ) : (
            <span className="text-muted-foreground">{p('no_account')}</span>
          ),
      },
      {
        id: 'reason',
        header: p('columns.reason'),
        cell: (entry) =>
          entry.reason ? (
            <bdi dir="auto" className="block max-w-xs break-words text-foreground">
              {entry.reason}
            </bdi>
          ) : (
            <span className="text-muted-foreground">{t('none')}</span>
          ),
      },
      { id: 'changes', header: t('columns.changes'), cell: (entry) => <Changes entry={entry} /> },
    ];
    return all.filter((column): column is DataTableColumn<AuditLogEntry> => column !== false);
  }, [t, p, platform, filterAccount, filterLabel]);

  const actionLabel = (action: string) => {
    const key = `actions.${actionKey(action)}`;
    return t.has(key as never) ? t(key as never) : action;
  };
  const toolbar = (
    <>
      {platform ? (
        <>
          <AccountFilter value={filterAccount} onChange={(account_id) => set({ account_id })} />
          <SelectFilter
            label={p('filters.action')}
            allLabel={p('filters.all_actions')}
            options={platformActions.map((action) => ({
              value: action,
              label: actionLabel(action),
            }))}
            value={params.action}
            onChange={(action) => set({ action })}
          />
          <SearchFilter
            label={t('filters.actor_id')}
            value={params.actor_id}
            onChange={(actor_id) => set({ actor_id })}
            valid={isUuid}
            invalidMessage={t('filters.invalid_id')}
            dir="ltr"
          />
        </>
      ) : null}
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
    </>
  );

  return (
    <>
      <DataTable
        id={platform ? 'platform-audit' : 'platform-account-audit'}
        label={platform ? p('table_label') : p('account_table_label')}
        columns={columns}
        rows={list.rows}
        rowKey={(entry) => entry.id ?? `${entry.occurred_at}-${entry.action}`}
        state={waiting ? 'ready' : list.state}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        onLoadMore={list.loadMore}
        toolbar={toolbar}
        empty={
          waiting ? (
            <p className="text-sm text-muted-foreground">{p('needs_reason')}</p>
          ) : filtered ? (
            <>
              <p className="text-sm text-foreground">{t('empty_filtered')}</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => set(Object.fromEntries(keys.map((key) => [key, undefined])))}
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
          accountId={filterAccount}
          accountLabel={filterLabel}
          onCancel={() =>
            filterAccount === undefined ? router.push('/') : set({ account_id: undefined })
          }
        />
      ) : null}
    </>
  );
}
