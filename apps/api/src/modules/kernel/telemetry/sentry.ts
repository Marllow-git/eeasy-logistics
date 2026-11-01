import type { Config } from '@eeasy-logistics/config';
import type { ErrorEvent, NodeOptions } from '@sentry/node';
import * as Sentry from '@sentry/node';
import { redactText, redactValue } from './redact.js';
import type { TelemetryRole } from './sdk.js';
import { serviceNames } from './sdk.js';

// Sentry for the api and worker (PLAT-14 plan 2.5; platform §7): exceptions only, initialised
// when `SENTRY_DSN` is set, release = `ELX_RELEASE`, environment = `APP_ENV`. Tracing stays with
// OpenTelemetry (no Sentry performance, no Sentry OpenTelemetry setup, no loader hook of its own,
// no default integrations that patch modules). Every event passes `scrubEvent` before it leaves:
// no request body, cookie, header, query string or URL, no user, no breadcrumbs, no local
// variables, and every message through the telemetry redactor. The API reports `internal_error`
// (500) only; a 4xx is never reported. Worker job failures carry the row id and kind, never the
// payload. Reporting is fire-and-forget: it never blocks or fails a request.

/** Contexts kept on an event (runtime facts and the trace link); the rest are dropped. */
const keptContexts: ReadonlySet<string> = new Set(['runtime', 'os', 'trace']);

/** An event as it may leave the process (plan 2.5 `beforeSend`). */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const method = event.request?.method;
  const contexts = Object.fromEntries(
    Object.entries(event.contexts ?? {}).filter(([name]) => keptContexts.has(name)),
  );
  const scrubbed: ErrorEvent = {
    ...event,
    // The request: its method only. No URL (path values), query string, headers, cookies, body.
    ...(method === undefined ? {} : { request: { method } }),
    contexts,
    exception:
      event.exception === undefined
        ? undefined
        : {
            values: (event.exception.values ?? []).map((value) => ({
              ...value,
              ...(value.value === undefined ? {} : { value: redactText(value.value, 500) }),
              ...(value.stacktrace === undefined
                ? {}
                : {
                    stacktrace: {
                      ...value.stacktrace,
                      frames: (value.stacktrace.frames ?? []).map((frame) => {
                        // Local variables are data; source lines are code and stay.
                        const rest = { ...frame };
                        delete rest.vars;
                        return rest;
                      }),
                    },
                  }),
            })),
          },
  };
  if (method === undefined) delete scrubbed.request;
  delete scrubbed.user;
  delete scrubbed.breadcrumbs;
  delete scrubbed.transaction;
  if (event.message !== undefined) scrubbed.message = redactText(event.message, 500);
  if (event.extra !== undefined) {
    scrubbed.extra = redactValue(event.extra) as Record<string, unknown>;
  }
  if (event.tags !== undefined) {
    scrubbed.tags = Object.fromEntries(
      Object.entries(event.tags).map(([key, value]) => [
        key,
        typeof value === 'string' ? redactText(value, 200) : value,
      ]),
    );
  }
  return scrubbed;
}

let active = false;

export interface SentryOverrides {
  /** Tests: a transport that records envelopes instead of sending them. */
  readonly transport?: NodeOptions['transport'];
}

/** Initialises Sentry when `SENTRY_DSN` is set; returns whether it did. Never throws. */
export function initSentry(
  config: Config,
  role: TelemetryRole,
  overrides: SentryOverrides = {},
): boolean {
  const dsn = config.observability.sentryDsn;
  if (dsn === undefined) return false;
  try {
    Sentry.init({
      dsn,
      release: config.observability.release,
      environment: config.app.env,
      serverName: serviceNames[role],
      // OpenTelemetry owns tracing and the loader hook (plan 2.5: Sentry performance off).
      skipOpenTelemetrySetup: true,
      registerEsmLoaderHooks: false,
      defaultIntegrations: false,
      integrations: [
        Sentry.linkedErrorsIntegration(),
        Sentry.dedupeIntegration(),
        Sentry.onUncaughtExceptionIntegration(),
        Sentry.onUnhandledRejectionIntegration(),
      ],
      sendDefaultPii: false,
      includeLocalVariables: false,
      maxBreadcrumbs: 0,
      beforeBreadcrumb: () => null,
      beforeSend: (event) => scrubEvent(event),
      beforeSendTransaction: () => null,
      ...(overrides.transport === undefined ? {} : { transport: overrides.transport }),
    });
    active = true;
    return true;
  } catch (error) {
    process.stderr.write(
      `Sentry not started (${error instanceof Error ? error.name : 'unknown error'})\n`,
    );
    return false;
  }
}

/** Tags an error report may carry: ids, kinds and route facts only. */
export interface ReportTags {
  readonly request_id?: string;
  readonly surface?: string;
  readonly operation_id?: string;
  readonly 'outbox.kind'?: string;
  readonly 'outbox.row_id'?: string;
}

/** Reports `error` to Sentry when it is running; fire-and-forget, never throws. */
export function reportError(error: unknown, tags: ReportTags = {}): void {
  if (!active) return;
  try {
    const defined = Object.fromEntries(
      Object.entries(tags).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    Sentry.captureException(error, { tags: defined });
  } catch {
    // Reporting never fails the code that reports.
  }
}

/** Flushes and closes Sentry within `timeoutMs`; for the shutdown hooks. */
export async function closeSentry(timeoutMs = 2_000): Promise<void> {
  if (!active) return;
  active = false;
  await Sentry.close(timeoutMs).catch(() => false);
}
