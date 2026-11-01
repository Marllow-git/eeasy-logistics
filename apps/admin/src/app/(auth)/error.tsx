'use client';

import { RouteError } from '../../observability/route-error';

/** A failed sign-in page renders inside the auth frame (web §10.4). */
export default function AuthError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} group="auth" homeHref="/sign-in" />;
}
