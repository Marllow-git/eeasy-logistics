'use client';

import { hooks, type Account } from '@eeasy-logistics/contracts/platform';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { SearchFilter, SelectFilter } from '@eeasy-logistics/ui/table/filters';
import { useState } from 'react';
import { shortId } from '../accounts/parts';

// The account filter of the outbox and the platform audit log (WEB-4 plan 2.8, 2.11): a search
// by name over `platformListAccounts` (20 at a time, no total) and a select of the matches; the
// chosen account stays in the URL. `platformGetAccount` (no reason needed, PLAT-13 8.2 #8) names
// the chosen account when it is not among the matches, and names it in the reason dialog.

/** The name of an account for a dialog or a select; its short number until the name is read. */
export function useAccountLabel(accountId: string | undefined): string {
  const fetcher = useSessionFetcher();
  const account = hooks.usePlatformGetAccount(accountId ?? '', {
    request: { fetcher },
    query: { enabled: accountId !== undefined },
  });
  if (accountId === undefined) return '';
  return account.data?.status === 200 && account.data.data.name
    ? account.data.data.name
    : shortId(accountId);
}

export function AccountFilter({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (accountId: string | undefined) => void;
}) {
  const t = useTranslations('platform.account_filter');
  const fetcher = useSessionFetcher();
  const [q, setQ] = useState<string | undefined>(undefined);
  const matches = hooks.usePlatformListAccounts(
    { q, limit: 20, sort: 'name' },
    { request: { fetcher } },
  );
  const chosenLabel = useAccountLabel(value);
  const accounts =
    matches.data?.status === 200 ? ((matches.data.data.data ?? []) as Account[]) : [];
  const options = accounts.map((account) => ({
    value: account.id,
    label: `${account.name ?? ''} · ${shortId(account.id)}`,
  }));
  if (value !== undefined && !options.some((option) => option.value === value)) {
    options.unshift({ value, label: chosenLabel });
  }
  return (
    <>
      <SearchFilter label={t('search')} value={q} onChange={setQ} />
      <SelectFilter
        label={t('label')}
        allLabel={t('all')}
        options={options}
        value={value}
        onChange={onChange}
      />
    </>
  );
}
