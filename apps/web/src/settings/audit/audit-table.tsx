'use client';

import { client, type AuditLogEntry } from '@eeasy-logistics/contracts/staff';
import { formatDateTime, formatNumber } from '@eeasy-logistics/i18n';
import { Button } from '@eeasy-logistics/ui/components/button';
import { DateTime } from '@eeasy-logistics/ui/components/date-time';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { DataTable, type DataTableColumn } from '@eeasy-logistics/ui/table';
import { useCursorList } from '@eeasy-logistics/ui/table/cursor-list';
import { DateFilter, SearchFilter, SelectFilter } from '@eeasy-logistics/ui/table/filters';
import { useListParams } from '@eeasy-logistics/ui/table/list-params';
import { useMemo } from 'react';
import { ListError } from '../list-error';
import { listPageSize } from '../lists';
import { auditValue, changedFields, type AuditFormat } from './audit-diff';
import { auditListKey, auditListKeys, auditQuery, isUuid } from './audit-keys';

// The audit log (web §8 wave 0; WEB-3 plan 2.9; design references: Klaviyo's filter row, Gumloop's
// notice above the table, Google Ads' "user / date" column): a read-only list of the account's
// entries, newest first, by cursor with "load more", filtered by the dates, the object and the
// ids in the URL. Each row names the action from the catalogue (the raw action otherwise), the
// person, the object and the time, and opens a two-column before-and-after of what changed.

const targetTypes = ['account', 'membership', 'site', 'invitation', 'user', 'session_family'];

/** The labels and formats `auditValue` prints with, in the page's language. */
function useAuditFormat(): AuditFormat {
  const locale = useLocale();
  const t = useTranslations('settings');
  return useMemo(() => {
    const has = (key: string) => t.has(key as never);
    const label = (key: string) => (has(key) ? t(key as never) : undefined);
    const enumKeys: Record<string, string> = {
      roles: 'roles',
      kind: 'sites.kinds',
      intake_rule: 'account.intake',
      delivery: 'account.proof.kinds',
      cod: 'account.proof.kinds',
      allowed_cod_methods: 'account.cod.kinds',
      fields: 'audit.fields',
    };
    return {
      number: (value) => formatNumber(locale, value, { maximumFractionDigits: 5 }),
      dateTime: (iso) => formatDateTime(locale, iso),
      boolean: (value) => t(value ? 'audit.yes' : 'audit.no'),
      enumLabel: (key, value) => {
        const root = enumKeys[key];
        return root === undefined || /[.\s]/.test(value) ? undefined : label(`${root}.${value}`);
      },
      weekday: (day) => label(`sites.weekdays.${day}`) ?? String(day),
      none: t('audit.none'),
      separator: locale === 'ar' ? '، ' : ', ',
    };
  }, [locale, t]);
}

function Changes({ entry }: { entry: AuditLogEntry }) {
  const t = useTranslations('settings.audit');
  const settings = useTranslations('settings');
  const format = useAuditFormat();
  const fields = changedFields(entry.before, entry.after);
  if (fields.length === 0) return <span className="text-muted-foreground">{t('no_changes')}</span>;
  const fieldLabel = (key: string) =>
    settings.has(`audit.fields.${key}` as never) ? settings(`audit.fields.${key}` as never) : key;
  return (
    <details className="group max-w-xl">
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
                {fieldLabel(field.key)}
              </th>
              <td dir="auto" className="py-1 pe-3">
                {auditValue(field.key, field.before, format)}
              </td>
              <td dir="auto" className="py-1">
                {auditValue(field.key, field.after, format)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function AuditTable({ actors }: { actors: Readonly<Record<string, string>> }) {
  const t = useTranslations('settings.audit');
  const fetcher = useSessionFetcher();
  const { params, set } = useListParams(auditListKeys);
  const list = useCursorList<AuditLogEntry>({
    queryKey: auditListKey(params),
    fetchPage: async (cursor, signal) => {
      const answer = await client.listAuditLog(
        { ...auditQuery(params), cursor, limit: listPageSize },
        { fetcher, signal },
      );
      return answer.data as { data: AuditLogEntry[]; next_cursor: string | null };
    },
  });
  const filtered = auditListKeys.some((key) => params[key] !== undefined);

  const columns = useMemo<DataTableColumn<AuditLogEntry>[]>(() => {
    const action = (entry: AuditLogEntry) => {
      const key = `actions.${(entry.action ?? '').replaceAll('.', '_')}`;
      return t.has(key as never) ? t(key as never) : (entry.action ?? '');
    };
    const actor = (entry: AuditLogEntry) => {
      if (entry.actor_type === 'system' || entry.actor_id === undefined) return t('system');
      // Members are named from the account's member list; the platform team and keys are not.
      const member = (entry.actor_type ?? 'user') === 'user';
      const name = actors[entry.actor_id] ?? (member ? t('unknown_person') : undefined);
      const type = `actor_types.${entry.actor_type ?? 'user'}`;
      return (
        <div className="flex flex-col">
          {name === undefined ? null : (
            <span dir="auto" className="text-foreground">
              {name}
            </span>
          )}
          <span className="text-muted-foreground">
            {t.has(type as never) ? t(type as never) : entry.actor_type}
          </span>
        </div>
      );
    };
    const target = (entry: AuditLogEntry) => {
      const type = `target_types.${entry.target_type ?? ''}`;
      return (
        <div className="flex flex-col">
          <span className="text-foreground">
            {t.has(type as never) ? t(type as never) : entry.target_type}
          </span>
          {entry.target_id ? (
            <span dir="ltr" className="self-start font-mono text-xs text-muted-foreground">
              {entry.target_id.slice(0, 8)}
            </span>
          ) : null}
        </div>
      );
    };
    return [
      {
        id: 'time',
        header: t('columns.time'),
        className: 'whitespace-nowrap',
        cell: (entry) => (entry.occurred_at ? <DateTime value={entry.occurred_at} /> : null),
      },
      {
        id: 'action',
        header: t('columns.action'),
        cell: (entry) => <span className="font-semibold text-foreground">{action(entry)}</span>,
      },
      { id: 'actor', header: t('columns.actor'), cell: actor },
      { id: 'target', header: t('columns.target'), cell: target },
      { id: 'changes', header: t('columns.changes'), cell: (entry) => <Changes entry={entry} /> },
    ];
  }, [t, actors]);

  const toolbar = (
    <>
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
      <SelectFilter
        label={t('filters.target_type')}
        allLabel={t('filters.all_targets')}
        options={targetTypes.map((type) => ({
          value: type,
          label: t(`target_types.${type}` as 'target_types.site'),
        }))}
        value={params.target_type}
        onChange={(target_type) => set({ target_type })}
      />
      <SearchFilter
        label={t('filters.target_id')}
        value={params.target_id}
        onChange={(target_id) => set({ target_id })}
        dir="ltr"
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
  );

  return (
    <DataTable
      id="settings-audit"
      label={t('table_label')}
      columns={columns}
      rows={list.rows}
      rowKey={(entry) => entry.id ?? `${entry.occurred_at}-${entry.action}`}
      state={list.state}
      hasMore={list.hasMore}
      loadingMore={list.loadingMore}
      onLoadMore={list.loadMore}
      toolbar={toolbar}
      empty={
        filtered ? (
          <>
            <p className="text-sm text-foreground">{t('empty_filtered')}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                set({
                  created_from: undefined,
                  created_to: undefined,
                  target_type: undefined,
                  target_id: undefined,
                  actor_id: undefined,
                })
              }
            >
              {t('clear_filters')}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        )
      }
      error={<ListError error={list.error} onRetry={list.retry} />}
    />
  );
}
