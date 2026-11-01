import { scrubSentryEvent } from '@eeasy-logistics/ui/observability';
import type * as SentryNext from '@sentry/nextjs';
import { observabilityConfig } from './settings';

// Sentry in the browser (PLAT-14 plan 2.7, web §10.4): errors only, through the first-party
// /monitoring tunnel (the CSP stays 'self'), without cookies on the tunnel request, without
// default PII, replay, tracing, breadcrumbs or session tracking; every event passes the shared
// scrubber before it leaves.
//
// This module is never imported up front: instrumentation-client.ts and report.ts load it after
// the page has loaded, as its own chunk. Imported eagerly, the SDK and the configuration schema
// grew the shared framework chunk every route loads from 128 KB to 232 KB (the cap is 135 KB,
// web §10.2).

type SentryModule = typeof SentryNext;

let loading: Promise<SentryModule | undefined> | undefined;

function loadSentry(): Promise<SentryModule | undefined> {
  loading ??= (async () => {
    const config = observabilityConfig();
    if (config?.sentryDsn === undefined) return undefined;
    const Sentry = await import('@sentry/nextjs');
    Sentry.init({
      dsn: config.sentryDsn,
      tunnel: '/monitoring',
      transportOptions: { fetchOptions: { credentials: 'omit' } },
      release: config.release,
      environment: config.appEnv,
      sendDefaultPii: false,
      defaultIntegrations: false,
      integrations: [
        Sentry.eventFiltersIntegration(),
        Sentry.globalHandlersIntegration(),
        Sentry.linkedErrorsIntegration(),
        Sentry.dedupeIntegration(),
      ],
      maxBreadcrumbs: 0,
      sendClientReports: false,
      beforeSend: (event) => scrubSentryEvent(event),
      beforeSendTransaction: () => null,
    });
    return Sentry;
  })().catch(() => undefined);
  return loading;
}

/** Starts the browser SDK when a DSN is configured (instrumentation-client.ts, after `load`). */
export function startSentryClient(): void {
  void loadSentry();
}

/** Sends an error a boundary caught under the event id the page already shows (report.ts). */
export function captureClientError(
  error: unknown,
  eventId: string,
  tags: Record<string, string>,
): void {
  void loadSentry().then((Sentry) =>
    Sentry?.withScope((scope) => {
      scope.setTags(tags);
      scope.captureException(error, { event_id: eventId });
    }),
  );
}
