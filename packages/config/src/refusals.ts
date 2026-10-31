import type { ConfigIssue } from './errors.ts';
import type { ServerVariable } from './server.ts';

/**
 * What production refuses to start without (plan 2.3, platform §3): the four database URLs, Redis,
 * object storage, the token signing key, and the credentials keys with their active key id.
 */
export const requiredInProduction: readonly ServerVariable[] = [
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

export function productionRefusals(input: RefusalInput): ConfigIssue[] {
  if (input.appEnv !== 'production') return [];
  const issues: ConfigIssue[] = [];
  for (const variable of requiredInProduction) {
    if (!input.present(variable)) {
      issues.push({ variable, problem: 'is required when APP_ENV=production' });
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
