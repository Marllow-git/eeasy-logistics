'use client';

import { RouteError } from '../../observability/route-error';

/**
 * A failed recipient page renders inside the recipient frame (web §9, §10.4). No home action: a
 * recipient has no account to return to; retry is the way back.
 */
export default function RecipientError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} group="recipient" />;
}
