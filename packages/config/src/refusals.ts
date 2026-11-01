import type { ConfigIssue } from './errors.ts';
import type { ServerVariable } from './server.ts';

/**
 * What production refuses to start without (plan 2.3, platform §3): the public web URL, the four
 * database URLs, Redis, object storage, the token signing key, and the credentials keys with their
 * active key id.
 */
export const requiredInProduction: readonly ServerVariable[] = [
  'PUBLIC_WEB_URL',
  'DATABASE_URL_OWNER',
  'DATABASE_URL_APP',
  'DATABASE_URL_PLATFORM',
  'DATABASE_URL_MAINTENANCE',
  'REDIS_URL',
  'STORAGE_ENDPOINT',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'AUTH_SIGNING_KEY_ID',
  'AUTH_SIGNING_KEY',
  'CREDENTIALS_KEYS',
  'CREDENTIALS_ACTIVE_KEY_ID',
];

/**
 * Variables that select an adapter. Production refuses the value `stub` for any of them
 * (integrations §9); an INT order that adds a selector adds it here.
 */
/**
 * Transport security in production: TLS for Redis, https for the storage and OTLP endpoints. Local,
 * ci and staging may use plain `redis://` and `http://` (Compose services on a private network).
 */
export const secureSchemeInProduction: readonly (readonly [ServerVariable, string])[] = [
  ['REDIS_URL', 'rediss://'],
  ['STORAGE_ENDPOINT', 'https://'],
  ['OTEL_EXPORTER_OTLP_ENDPOINT', 'https://'],
];

export const adapterSelectors: readonly ServerVariable[] = ['MESSAGING_PROVIDER'];

export interface RefusalInput {
  /** The parsed `APP_ENV`, or undefined when it was itself invalid (then no rule applies). */
  readonly appEnv: string | undefined;
  /** Whether the variable has a non-empty value in the record. */
  readonly present: (variable: ServerVariable) => boolean;
  /** The raw value of a variable, for selector checks (selectors are not secrets). */
  readonly raw: (variable: ServerVariable) => string | undefined;
  readonly messagingDisabled: boolean | undefined;
}

/**
 * Tooling credentials that only `local` and `ci` may hold (PLAT-5): the superuser URL creates and
 * drops scratch databases and the `elx_seed` template. Staging and production refuse it.
 */
export const localAndCiOnly: readonly ServerVariable[] = ['DATABASE_URL_ADMIN'];

export function productionRefusals(input: RefusalInput): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (input.appEnv === 'staging' || input.appEnv === 'production') {
    for (const variable of localAndCiOnly) {
      if (input.present(variable)) {
        issues.push({
          variable,
          problem: `is for local and ci tooling only; ${input.appEnv} refuses it`,
        });
      }
    }
  }
  if (input.appEnv !== 'production') return issues;
  for (const variable of requiredInProduction) {
    if (!input.present(variable)) {
      issues.push({ variable, problem: 'is required when APP_ENV=production' });
    }
  }
  for (const [variable, scheme] of secureSchemeInProduction) {
    const value = input.raw(variable);
    // Only the scheme is inspected; the value (a secret for REDIS_URL) is never echoed.
    if (input.present(variable) && !value?.startsWith(scheme)) {
      issues.push({ variable, problem: `must use ${scheme} in production` });
    }
  }
  for (const variable of adapterSelectors) {
    if (input.raw(variable) === 'stub') {
      issues.push({ variable, problem: 'selects a stub adapter, which production refuses' });
    }
  }
  if (!input.present('MESSAGING_PROVIDER') && input.messagingDisabled !== true) {
    issues.push({
      variable: 'MESSAGING_PROVIDER',
      problem:
        'is required when APP_ENV=production (a real provider), unless MESSAGING_DISABLED=true',
    });
  }
  return issues;
}
