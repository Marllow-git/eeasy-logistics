// Entry point for apps/driver: the only place the driver app's `EXPO_PUBLIC_*` values are read.
// Expo inlines an `EXPO_PUBLIC_*` value at build time only where the code says
// `process.env.EXPO_PUBLIC_<NAME>` with static dot notation (no destructuring, no bracket access),
// so each variable is spelled out below. Add a variable here and in `driverPublicVariables` together.
import type { DriverPublicConfig } from './public.ts';
import { parseDriverPublicConfig } from './public.ts';

export type { DriverPublicConfig } from './public.ts';

let cached: DriverPublicConfig | undefined;

/** The validated public configuration; throws `ConfigError` naming every invalid variable. */
export function publicConfig(): DriverPublicConfig {
  cached ??= parseDriverPublicConfig({
    EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
    EXPO_PUBLIC_POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY,
  });
  return cached;
}
