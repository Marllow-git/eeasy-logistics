'use client';

import { ErrorState, type ErrorStateLabels } from '@eeasy-logistics/ui/components/error-state';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import { useRouter } from 'next/navigation';
import { startTransition, useEffect, useState } from 'react';
import { track } from '../analytics';
import { reportClientError } from './report';

/** The route groups with their own error boundary (web §1.1, §10.4; the console has two). */
export type BoundaryGroup = 'platform' | 'auth';

/** The `common.error_page` strings an `ErrorState` needs, in the request's locale. */
export function useErrorLabels(
  description: 'description' | 'global_description',
): ErrorStateLabels {
  const t = useTranslations('common.error_page');
  return {
    title: t('title'),
    description: t(description),
    reference: t('reference'),
    copy: t('copy'),
    copied: t('copied'),
    retry: t('retry'),
    home: t('home'),
  };
}

/**
 * The body of a group's `error.tsx` (web §10.4, PLAT-14 item F): the shared `ErrorState` inside
 * the group's shell, whose navigation stays usable. The reference is the error's digest for a
 * server error (reported on the server under that `request_id`) or the Sentry event id of a
 * browser error, reported here. Retry refreshes the server data and re-renders the segment. The
 * page view is counted as `shell.error_page.shown` (ids and enums only).
 */
export function RouteError({
  error,
  reset,
  group,
  homeHref,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  group: BoundaryGroup;
  homeHref?: string;
}) {
  const labels = useErrorLabels('description');
  const router = useRouter();
  // Reported once per boundary mount (the initializer runs at the first render only).
  const [reference] = useState(
    () => error.digest ?? reportClientError(error, { boundary: 'segment', group }),
  );
  useEffect(() => track('shell.error_page.shown', { boundary: 'segment', group }), [group]);
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return <ErrorState labels={labels} reference={reference} onRetry={retry} homeHref={homeHref} />;
}
