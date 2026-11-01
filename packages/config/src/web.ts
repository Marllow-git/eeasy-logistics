// Entry point for apps/web: the only place the web app's `NEXT_PUBLIC_*` values are read.
// Next.js inlines a `NEXT_PUBLIC_*` value at build time only where the code says
// `process.env.NEXT_PUBLIC_<NAME>` literally (no destructuring, no computed key), so each variable
// is spelled out below. Add a variable here and in `webPublicVariables` together.
import type { WebPublicConfig } from './public.ts';
import { parseWebPublicConfig } from './public.ts';

export type { WebPublicConfig } from './public.ts';

let cached: WebPublicConfig | undefined;

/** The validated public configuration; throws `ConfigError` naming every invalid variable. */
export function publicConfig(): WebPublicConfig {
  cached ??= parseWebPublicConfig({
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_RELEASE: process.env.NEXT_PUBLIC_RELEASE,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  });
  return cached;
}

/**
 * The runtime Next.js evaluates `instrumentation.ts` in (`nodejs` or `edge`), so its `register()`
 * loads the server SDK only where Node.js runs (PLAT-14 plan 2.7). Next sets it per bundle.
 */
export function nextRuntime(): string | undefined {
  return process.env.NEXT_RUNTIME;
}
