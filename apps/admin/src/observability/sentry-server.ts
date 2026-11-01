import { scrubSentryEvent } from '@eeasy-logistics/ui/observability';
import * as Sentry from '@sentry/nextjs';
import { observabilityConfig } from './settings';

// Sentry on the Next.js server of the console (PLAT-14 plan 2.7): loaded by instrumentation.ts in the Node.js
// runtime. Errors only: no OpenTelemetry setup (tracing stays off), no module patching, no default
// PII; the request a server error happened in is reduced by the shared scrubber to its method and
// scrubbed URL. The release is the image tag (NEXT_PUBLIC_RELEASE), the environment APP_ENV's.

const config = observabilityConfig();
if (config?.sentryDsn !== undefined) {
  Sentry.init({
    dsn: config.sentryDsn,
    release: config.release,
    environment: config.appEnv,
    serverName: 'elx-admin',
    sendDefaultPii: false,
    skipOpenTelemetrySetup: true,
    registerEsmLoaderHooks: false,
    defaultIntegrations: false,
    // Request errors arrive through onRequestError. No process handlers: Next.js logs uncaught
    // errors and keeps serving, and Next also compiles this file for the edge runtime, whose SDK
    // has none.
    integrations: [Sentry.linkedErrorsIntegration(), Sentry.dedupeIntegration()],
    maxBreadcrumbs: 0,
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: () => null,
  });
}

/** Where a server error happened, as Next.js describes it to `onRequestError`. */
export interface ServerErrorContext {
  routerKind: string;
  /** The route template (`/track/[token]`), never the path with its values. */
  routePath: string;
  routeType: string;
}

/**
 * Reports an error Next.js caught while rendering or handling a request. The tag `request_id` is
 * the error's digest: the reference the error page shows (web §10.4), so support finds the report
 * from what the user reads out. The request itself (headers, cookies, path values) is not passed.
 */
export function reportServerError(error: unknown, context: ServerErrorContext): void {
  if (Sentry.getClient() === undefined) return;
  const digest =
    typeof error === 'object' && error !== null && 'digest' in error ? String(error.digest) : '';
  Sentry.captureException(error, {
    tags: {
      request_id: digest,
      route: context.routePath,
      route_type: context.routeType,
      router: context.routerKind,
    },
  });
}
