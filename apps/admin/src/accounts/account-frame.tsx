'use client';

import { hooks, type Account, type AuditLogEntry } from '@eeasy-logistics/contracts/platform';
import { formatDateTime } from '@eeasy-logistics/i18n';
import { useCan } from '@eeasy-logistics/ui/authz';
import { Banner } from '@eeasy-logistics/ui/components/banner';
import { Button } from '@eeasy-logistics/ui/components/button';
import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { ReasonDialog } from '@eeasy-logistics/ui/components/reason-dialog';
import { Skeleton } from '@eeasy-logistics/ui/components/skeleton';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { cn } from '@eeasy-logistics/ui/cn';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useRef, type ReactNode } from 'react';
import { headerReasonLength, headerReasonMax } from '../support/reason-store';
import { SupportReasonProvider, useSupportReason } from '../support/support-reason';
import { AccountStatusChip, LoadError, ShortId } from './parts';

// Every page under /accounts/[accountId] (web §3.5; WEB-4 plan 2.4, 2.5): the account is read
// first (`platformGetAccount` needs no reason), so the support-reason dialog can name it; until the
// tab holds a reason for this account the dialog stays open, cancel goes back to the list, and no
// page under it renders (so no cross-tenant read is issued). Then the "Acting on account" banner
// stays at the top of every page with the reason and "Exit account", the header names the account,
// a suspended or closed account shows the state with its last lifecycle reason, and the tabs lead
// to the account's sections.

/** The account's query: one key for the frame and every tab, the tab's reason when it has one. */
export function useAccount(accountId: string) {
  const fetcher = useSessionFetcher();
  const { headers } = useSupportReason();
  return hooks.usePlatformGetAccount(accountId, { request: { fetcher, headers } });
}

/** The account the frame read (only rendered once it has). */
export function accountOf(query: ReturnType<typeof useAccount>): Account | undefined {
  return query.data?.status === 200 ? query.data.data : undefined;
}

const lifecycleActions = {
  suspended: 'core.account.suspended',
  closed: 'core.account.closed',
} as const;

/** The reason of the last suspension or closure, from the account's audit log. */
function useLifecycleReason(accountId: string, status: Account['status']): string | undefined {
  const fetcher = useSessionFetcher();
  const { reason, headers } = useSupportReason();
  const readsTenants = useCan('platform.tenants.read');
  const watched = status === 'suspended' || status === 'closed';
  const audit = hooks.usePlatformListAccountAudit(
    accountId,
    { limit: 50 },
    {
      request: { fetcher, headers },
      query: { enabled: watched && readsTenants && reason !== undefined },
    },
  );
  if (!watched || audit.data?.status !== 200) return undefined;
  const entries = (audit.data.data.data ?? []) as AuditLogEntry[];
  const last = entries.find((entry) => entry.action === lifecycleActions[status]);
  return last?.reason ?? undefined;
}

function SupportGate({ account }: { account: Account }) {
  const t = useTranslations('platform.account.gate');
  const router = useRouter();
  const { setReason } = useSupportReason();
  // The dialog also closes after a confirm; only a cancel (or Escape) leaves the account.
  const confirmed = useRef(false);
  return (
    <ReasonDialog
      open
      onOpenChange={(open) => {
        if (!open && !confirmed.current) router.push('/accounts');
      }}
      title={t('title', { name: account.name ?? '' })}
      description={t('description')}
      label={t('label')}
      tone="primary"
      confirmLabel={t('confirm')}
      max={headerReasonMax}
      measure={headerReasonLength}
      onConfirm={(reason) => {
        confirmed.current = true;
        setReason(reason);
        return Promise.resolve();
      }}
    />
  );
}

function AccountTabs({ accountId }: { accountId: string }) {
  const t = useTranslations('platform.account.tabs');
  const pathname = usePathname();
  const readsTenants = useCan('platform.tenants.read');
  const tabs = [
    { href: `/accounts/${accountId}`, label: t('details') },
    { href: `/accounts/${accountId}/flags`, label: t('flags') },
    // The account's people and log are cross-tenant reads of their own (WEB-4 plan 2.7).
    ...(readsTenants
      ? [
          { href: `/accounts/${accountId}/members`, label: t('members') },
          { href: `/accounts/${accountId}/audit`, label: t('audit') },
        ]
      : []),
  ];
  return (
    <nav aria-label={t('label')} className="flex gap-1 border-b border-border">
      {tabs.map((tab) => {
        const current = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground',
              current ? 'border-primary font-semibold text-foreground' : 'border-transparent',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

function AccountShell({ accountId, children }: { accountId: string; children: ReactNode }) {
  const t = useTranslations('platform');
  const locale = useLocale();
  const router = useRouter();
  const support = useSupportReason();
  const query = useAccount(accountId);
  const account = accountOf(query);
  const lifecycleReason = useLifecycleReason(accountId, account?.status);

  if (query.isError) return <LoadError error={query.error} onRetry={() => void query.refetch()} />;
  if (account === undefined || !support.loaded) {
    return (
      <div role="status" aria-label={t('account.loading')} className="flex flex-col gap-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (support.reason === undefined) return <SupportGate account={account} />;

  const name = account.name ?? '';
  const state =
    account.status === 'suspended' || account.status === 'closed' ? account.status : null;
  return (
    <div className="flex flex-col gap-4">
      <Banner
        tone="support"
        label={t('account.banner.label')}
        title={<span dir="auto">{t('account.banner.title', { name })}</span>}
        className="sticky top-0 z-10"
        actions={
          <Button variant="secondary" size="sm" onClick={() => router.push('/accounts')}>
            {t('account.banner.exit')}
          </Button>
        }
      >
        <span>
          {t('account.banner.reason')} <bdi>{support.reason}</bdi>
        </span>
      </Banner>
      {state === null ? null : (
        <Banner
          tone={state === 'closed' ? 'danger' : 'warning'}
          label={t(`account.notice.${state}`)}
          title={t(`account.notice.${state}`)}
        >
          <p>{t(`account.notice.${state}_hint`)}</p>
          {lifecycleReason === undefined ? null : (
            <p>
              {t('account.notice.reason')} <bdi>{lifecycleReason}</bdi>
            </p>
          )}
        </Banner>
      )}
      <PageHeader
        className="mb-0"
        title={<span dir="auto">{name}</span>}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <AccountStatusChip status={account.status} />
            <ShortId id={account.id} />
            {account.default_locale === undefined ? null : (
              <span>
                {t('account.header.locale', { locale: t(`locales.${account.default_locale}`) })}
              </span>
            )}
            {/* Changes every run in the census: `data-census-mask`. */}
            <span data-census-mask="">
              {t('account.header.created', {
                date: formatDateTime(locale, account.created_at, { dateStyle: 'medium' }),
              })}
            </span>
          </span>
        }
        tabs={<AccountTabs accountId={accountId} />}
      />
      {children}
    </div>
  );
}

export function AccountFrame({ accountId, children }: { accountId: string; children: ReactNode }) {
  return (
    <SupportReasonProvider accountId={accountId}>
      <AccountShell accountId={accountId}>{children}</AccountShell>
    </SupportReasonProvider>
  );
}
