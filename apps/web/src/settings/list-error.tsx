'use client';

import { ApiError } from '@eeasy-logistics/contracts/http';
import { ErrorState } from '@eeasy-logistics/ui/components/error-state';
import { useTranslations } from '@eeasy-logistics/ui/intl';

/** A list or detail that failed to load: the error page's text, its reference and a retry. */
export function ListError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
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
