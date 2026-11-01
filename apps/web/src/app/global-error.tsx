'use client';

import '@eeasy-logistics/ui/styles.css';
import { GlobalErrorDocument } from '@eeasy-logistics/ui/shell/global-error-document';
import { useState } from 'react';
import { reportClientError } from '../observability/report';

/**
 * The last boundary: a root layout failed, so this replaces the whole document (web §10.4). The
 * reference is the server error's digest or the browser error's Sentry event id; retry reloads
 * the page (the layout itself must run again), home goes to `/`.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const [reference] = useState(
    () => error.digest ?? reportClientError(error, { boundary: 'global' }),
  );
  return (
    <GlobalErrorDocument
      reference={reference}
      onRetry={() => window.location.reload()}
      homeHref="/"
    />
  );
}
