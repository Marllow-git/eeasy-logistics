'use client';

import type { AccountStatus } from '@eeasy-logistics/contracts/platform';
import { ApiError } from '@eeasy-logistics/contracts/http';
import { Badge } from '@eeasy-logistics/ui/components/badge';
import { ErrorState } from '@eeasy-logistics/ui/components/error-state';
import { useTranslations } from '@eeasy-logistics/ui/intl';

// Small pieces the console's account screens share (WEB-4 plan 2.3 to 2.6): the status chip, the
// short number of an account, the label of a feature key, and a failed load with retry.

const statusTone = {
  provisioned: 'neutral',
  active: 'success',
  suspended: 'warning',
  closed: 'danger',
} as const;

export function AccountStatusChip({ status }: { status: AccountStatus | undefined }) {
  const t = useTranslations('platform.account_status');
  if (status === undefined) return null;
  return <Badge tone={statusTone[status]}>{t(status)}</Badge>;
}

/**
 * The account's short number: the last eight characters of its id (a UUIDv7 begins with its
 * creation time, so accounts made together share their first characters), left to right.
 */
export function shortId(id: string): string {
  return id.slice(-8);
}

export function ShortId({ id }: { id: string }) {
  const t = useTranslations('platform.account');
  return (
    <span className="text-muted-foreground">{t('short_id', { id: isolate(shortId(id)) })}</span>
  );
}

/** `text` as a left-to-right isolate inside a sentence of either direction (LRI … PDI). */
export function isolate(text: string): string {
  return `\u2066${text}\u2069`;
}

/** A feature key's label (`platform.features.<key>`), or the key itself, left to right. */
export function useFeatureLabel(): (key: string) => string {
  const t = useTranslations('platform.features');
  return (key) => (t.has(key as 'delivery') ? t(key as 'delivery') : key);
}

/** A `409 invalid_transition`: the page was stale (another tab, another person). */
export function isStale(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === 'invalid_transition';
}

/** A list or detail that failed to load: the error page's text, its reference and a retry. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const page = useTranslations('common.error_page');
  return (
    <ErrorState
      variant="section"
      labels={{
        title: page('title'),
        description: page('description'),
        reference: page('reference'),
        copy: page('copy'),
        copied: page('copied'),
        retry: page('retry'),
        home: page('home'),
      }}
      reference={error instanceof ApiError ? error.requestId : undefined}
      onRetry={onRetry}
    />
  );
}
