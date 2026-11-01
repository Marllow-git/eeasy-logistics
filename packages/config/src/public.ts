import { z } from 'zod';
import { ConfigError } from './errors.ts';
import type { EnvRecord } from './fields.ts';
import { deepFreeze, parseVariables } from './fields.ts';
import type { AppEnv } from './formats.ts';
import { appEnvs, httpUrl } from './formats.ts';

// Public configuration for the web app (`NEXT_PUBLIC_*`) and the driver app (`EXPO_PUBLIC_*`).
// These values are inlined into client bundles at build time and are readable by anyone: never put
// a secret here. The schemas are pure; `web.ts` and `driver.ts` hand over the values.

export const webPublicVariables = {
  NEXT_PUBLIC_APP_ENV: z.enum(appEnvs),
  NEXT_PUBLIC_SENTRY_DSN: httpUrl().optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
};

const webExpectations = {
  NEXT_PUBLIC_APP_ENV: `one of ${appEnvs.join(', ')}`,
  NEXT_PUBLIC_SENTRY_DSN: 'an http(s) URL',
  NEXT_PUBLIC_POSTHOG_KEY: 'a PostHog project API key',
} satisfies Record<keyof typeof webPublicVariables, string>;

export interface WebPublicConfig {
  readonly appEnv: AppEnv;
  readonly sentryDsn: string | undefined;
  readonly posthogKey: string | undefined;
}

export function parseWebPublicConfig(env: EnvRecord): WebPublicConfig {
  const { values, issues } = parseVariables(webPublicVariables, webExpectations, env);
  if (issues.length > 0) throw new ConfigError(issues);
  return deepFreeze({
    appEnv: values.NEXT_PUBLIC_APP_ENV,
    sentryDsn: values.NEXT_PUBLIC_SENTRY_DSN,
    posthogKey: values.NEXT_PUBLIC_POSTHOG_KEY,
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
