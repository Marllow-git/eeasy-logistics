import * as Sentry from '@sentry/react-native';
import { PostHog } from 'posthog-react-native';
import { appVersion } from '../platform/device';
import { releaseName } from '../platform/direction';
import { scrubEvent, scrubText } from './scrub';

// Crash reports and product events (driver app §11, DRV-1 plan 2.10). Both start only when
// publicConfig() carries their key; absent keys disable them. Events carry ids and enums only,
// through the typed catalogue below: a name, phone, PIN or code has no field to go into.

/** Product events of this order, with their id-only properties. */
export interface DriverEvents {
  driver_signed_in: { driver_id: string; account_id: string | null; device_id: string };
  language_changed: { locale: 'ar' | 'en' };
  cash_pin_set: { driver_id: string };
  cash_pin_locked_locally: { driver_id: string };
  device_revoked: { device_id: string };
}

let analytics: PostHog | undefined;

export interface ObservabilityOptions {
  readonly sentryDsn: string | undefined;
  readonly posthogKey: string | undefined;
  readonly release: string;
  readonly environment: string;
}

// PostHog's EU ingestion host, as the web apps use (web §10.4); the driver's public config has no
// host variable (DRV-1 §8.2).
const posthogHost = 'https://eu.i.posthog.com';

export function startObservability(options: ObservabilityOptions): void {
  if (options.sentryDsn !== undefined) {
    Sentry.init({
      dsn: options.sentryDsn,
      release: options.release,
      environment: options.environment,
      sendDefaultPii: false,
      beforeSend: (event) => scrubEvent(event),
      beforeBreadcrumb: (crumb) =>
        crumb.category === 'xhr' || crumb.category === 'fetch'
          ? { ...crumb, data: undefined }
          : {
              ...crumb,
              message: crumb.message === undefined ? undefined : scrubText(crumb.message),
            },
    });
  }
  if (options.posthogKey !== undefined) {
    analytics = new PostHog(options.posthogKey, {
      host: posthogHost,
      captureAppLifecycleEvents: false,
      persistence: 'memory',
    });
  }
}

/** `<app version>+<EAS update id>` (driver app §11). */
export function appRelease(): string {
  return releaseName(appVersion());
}

export function track<E extends keyof DriverEvents>(event: E, properties: DriverEvents[E]): void {
  analytics?.capture(event, { ...properties });
}

export function reportError(error: unknown): void {
  Sentry.captureException(error);
}
