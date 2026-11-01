'use client';

import { RouteError } from '../../observability/route-error';

/** A failed console page renders inside the shell; the navigation stays usable (web §10.4). */
export default function PlatformError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} group="platform" homeHref="/" />;
}
