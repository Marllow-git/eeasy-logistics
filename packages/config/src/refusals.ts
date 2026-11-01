import type { ConfigIssue } from './errors.ts';
import type { AppRole, ServerVariable } from './server.ts';

/**
 * What production refuses to start without (plan 2.3, platform §3), per process role. Each role gets
 * only the database credential of its duty (data §4.4, ADR-0031; PLAT-5 review H-2, amending PLAT-4):
 * `api` and `worker` need the `elx_app` and `elx_platform` URLs plus the public web and admin URLs, Redis,
 * object storage, the token signing key, the credentials keys and SMTP (PLAT-9); the one-shot `migrate` job needs
 * only the `elx_owner` URL. No role needs `DATABASE_URL_MAINTENANCE` yet: the deletion tool is a
 * wave 1 order and will get its own role.
 */
const requiredForRuntime: readonly ServerVariable[] = [
  'PUBLIC_WEB_URL',
  'PUBLIC_ADMIN_URL',
  'DATABASE_URL_APP',
  'DATABASE_URL_PLATFORM',
  'REDIS_URL',
  'STORAGE_ENDPOINT',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'AUTH_SIGNING_KEY_ID',
  'AUTH_SIGNING_KEY',
  'CREDENTIALS_KEYS',
  'CREDENTIALS_ACTIVE_KEY_ID',
  // Invitations and password resets (PLAT-9 plan 2.2).
  'MAIL_SMTP_URL',
  'MAIL_FROM',
];

export function requiredInProduction(role: AppRole): readonly ServerVariable[] {
  if (role === 'migrate') return ['DATABASE_URL_OWNER'];
  // Only the api serves HTTP behind the edge (platform §8); see the depth check below.
  return role === 'api' ? [...requiredForRuntime, 'TRUST_PROXY_HOPS'] : requiredForRuntime;
}

/**
 * Credentials a role must not hold in staging and production (ADR-0031): the api and worker
 * processes never see the owner, maintenance or superuser URL, so a compromise of either cannot
 * alter tables, disable triggers or purge ledgers.
 */
export function refusedInDeployedEnvironments(role: AppRole): readonly ServerVariable[] {
  return role === 'migrate'
    ? localAndCiOnly
    : ['DATABASE_URL_OWNER', 'DATABASE_URL_MAINTENANCE', ...localAndCiOnly];
}

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
  /** The process role (`--role`); the requirements depend on it. */
  readonly role: AppRole;
}

/**
 * Tooling credentials that only `local` and `ci` may hold (PLAT-5): the superuser URL creates and
 * drops scratch databases and the `elx_seed` template. Staging and production refuse it.
 */
export const localAndCiOnly: readonly ServerVariable[] = [
  'DATABASE_URL_ADMIN',
  // The WhatsApp stub (PLAT-9 plan 2.1; integrations §9): never reachable from staging or production.
  'MESSAGING_STUB_URL',
];

export function productionRefusals(input: RefusalInput): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (input.appEnv === 'staging' || input.appEnv === 'production') {
    for (const variable of refusedInDeployedEnvironments(input.role)) {
      if (input.present(variable)) {
        const problem = localAndCiOnly.includes(variable)
          ? `is for local and ci tooling only; ${input.appEnv} refuses it`
          : `must not be given to the ${input.role} role in ${input.appEnv} (ADR-0031)`;
        issues.push({ variable, problem });
      }
    }
  }
  if (input.appEnv !== 'production') return issues;
  for (const variable of requiredInProduction(input.role)) {
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
  // The client address of rate limits and audit comes from `X-Forwarded-For` behind Cloudflare
  // (platform §8: one hop, and the origin accepts only Cloudflare ranges, so the header cannot be
  // forged around the edge). Production states the depth; 0 would key every caller by the edge.
  if (input.role === 'api' && input.present('TRUST_PROXY_HOPS')) {
    // The parsed depth, not the spelling (re-check N-1); a malformed value is refused by the schema.
    const hops = Number(input.raw('TRUST_PROXY_HOPS'));
    if (Number.isInteger(hops) && hops < 1) {
      issues.push({
        variable: 'TRUST_PROXY_HOPS',
        problem: 'must be at least 1 in production (Cloudflare is one hop)',
      });
    }
  }
  // The release names the image the api and worker run (`sha-<commit>`, the Dockerfile's build
  // argument): `dev` or nothing would tag every span and error report wrongly (adversary A-8).
  if (input.role !== 'migrate') {
    const release = input.raw('ELX_RELEASE');
    if (release === undefined || release === '' || release === 'dev') {
      issues.push({
        variable: 'ELX_RELEASE',
        problem: 'must name the image release (sha-<commit>) when APP_ENV=production',
      });
    }
  }
  // The migration job sends nothing; only the api and worker need a messaging decision.
  if (
    input.role !== 'migrate' &&
    !input.present('MESSAGING_PROVIDER') &&
    input.messagingDisabled !== true
  ) {
    issues.push({
      variable: 'MESSAGING_PROVIDER',
      problem:
        'is required when APP_ENV=production (a real provider), unless MESSAGING_DISABLED=true',
    });
  }
  return issues;
}
