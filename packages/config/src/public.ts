import { z } from 'zod';
import { ConfigError } from './errors.ts';
import type { EnvRecord } from './fields.ts';
import { deepFreeze, parseVariables } from './fields.ts';
import type { AppEnv } from './formats.ts';
import { appEnvs, httpUrl, release, releaseExpectation } from './formats.ts';

// Public configuration for the web app (`NEXT_PUBLIC_*`) and the driver app (`EXPO_PUBLIC_*`).
// These values are inlined into client bundles at build time and are readable by anyone: never put
// a secret here. The schemas are pure; `web.ts` and `driver.ts` hand over the values.

export const webPublicVariables = {
  NEXT_PUBLIC_APP_ENV: z.enum(appEnvs),
  NEXT_PUBLIC_SENTRY_DSN: httpUrl().optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
  // The image tag the build carries (`sha-<commit>`, PLAT-14 plan 2.7): the Sentry release of the
  // browser and the server. `dev` outside an image.
  NEXT_PUBLIC_RELEASE: release().default('dev'),
  // PostHog ingestion host the /ingest route forwards to (web §10.4); the browser never calls it.
  NEXT_PUBLIC_POSTHOG_HOST: httpUrl().default('https://eu.i.posthog.com'),
};

const webExpectations = {
  NEXT_PUBLIC_APP_ENV: `one of ${appEnvs.join(', ')}`,
  NEXT_PUBLIC_SENTRY_DSN: 'an http(s) URL',
  NEXT_PUBLIC_POSTHOG_KEY: 'a PostHog project API key',
  NEXT_PUBLIC_RELEASE: releaseExpectation,
  NEXT_PUBLIC_POSTHOG_HOST: 'an http(s) URL without credentials',
} satisfies Record<keyof typeof webPublicVariables, string>;

export interface WebPublicConfig {
  readonly appEnv: AppEnv;
  readonly sentryDsn: string | undefined;
  readonly posthogKey: string | undefined;
  /** The release Sentry tags browser and server events with (`NEXT_PUBLIC_RELEASE`). */
  readonly release: string;
  /** Where /ingest forwards PostHog requests (`NEXT_PUBLIC_POSTHOG_HOST`). */
  readonly posthogHost: string;
}

export function parseWebPublicConfig(env: EnvRecord): WebPublicConfig {
  const { values, issues } = parseVariables(webPublicVariables, webExpectations, env);
  if (issues.length > 0) throw new ConfigError(issues);
  return deepFreeze({
    appEnv: values.NEXT_PUBLIC_APP_ENV,
    sentryDsn: values.NEXT_PUBLIC_SENTRY_DSN,
    posthogKey: values.NEXT_PUBLIC_POSTHOG_KEY,
    release: values.NEXT_PUBLIC_RELEASE,
    posthogHost: values.NEXT_PUBLIC_POSTHOG_HOST,
  });
}

export const driverPublicVariables = {
  EXPO_PUBLIC_APP_ENV: z.enum(appEnvs),
  EXPO_PUBLIC_API_URL: httpUrl(),
  EXPO_PUBLIC_SENTRY_DSN: httpUrl().optional(),
  EXPO_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
};

const driverExpectations = {
  EXPO_PUBLIC_APP_ENV: `one of ${appEnvs.join(', ')}`,
  EXPO_PUBLIC_API_URL: 'an http(s) URL',
  EXPO_PUBLIC_SENTRY_DSN: 'an http(s) URL',
  EXPO_PUBLIC_POSTHOG_KEY: 'a PostHog project API key',
} satisfies Record<keyof typeof driverPublicVariables, string>;

export interface DriverPublicConfig {
  readonly appEnv: AppEnv;
  /** The API base URL baked into the build (driver app §12). */
  readonly apiUrl: string;
  readonly sentryDsn: string | undefined;
  readonly posthogKey: string | undefined;
}

export function parseDriverPublicConfig(env: EnvRecord): DriverPublicConfig {
  const { values, issues } = parseVariables(driverPublicVariables, driverExpectations, env);
  if (
    values.EXPO_PUBLIC_APP_ENV === 'production' &&
    values.EXPO_PUBLIC_API_URL !== undefined &&
    !values.EXPO_PUBLIC_API_URL.startsWith('https://')
  ) {
    issues.push({ variable: 'EXPO_PUBLIC_API_URL', problem: 'must be https in production' });
  }
  if (issues.length > 0) throw new ConfigError(issues);
  return deepFreeze({
    appEnv: values.EXPO_PUBLIC_APP_ENV,
    apiUrl: values.EXPO_PUBLIC_API_URL,
    sentryDsn: values.EXPO_PUBLIC_SENTRY_DSN,
    posthogKey: values.EXPO_PUBLIC_POSTHOG_KEY,
  });
}
