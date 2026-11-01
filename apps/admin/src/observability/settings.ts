import { publicConfig, type WebPublicConfig } from '@eeasy-logistics/config/web';

// The observability switches of this app (PLAT-14 plan 2.7, 2.8), read once from the public
// configuration. Telemetry is never a reason for a page to fail: an invalid configuration (a build
// without NEXT_PUBLIC_APP_ENV, say) turns Sentry, PostHog and the census routes off with one
// warning instead of throwing.

let warned = false;

/** The public configuration, or undefined when it is invalid (telemetry off). */
export function observabilityConfig(): WebPublicConfig | undefined {
  try {
    return publicConfig();
  } catch (error) {
    if (!warned) {
      warned = true;
      console.warn(`Error reports and analytics are off: ${String(error)}`);
    }
    return undefined;
  }
}

/**
 * The census fault routes (`census-fault`) exist only in local and ci builds: they throw on purpose
 * so the census can prove the error pages (plan 2.9). Staging and production answer 404.
 */
export function censusFaultsEnabled(): boolean {
  const appEnv = observabilityConfig()?.appEnv;
  return appEnv === 'local' || appEnv === 'ci';
}
