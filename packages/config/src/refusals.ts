import type { ConfigIssue } from './errors.ts';
import type { AppRole, ServerVariable } from './server.ts';

/** The Expo push service (INT-4 plan 2.6); `server.ts` re-exports it as the default. */
export const expoPushServiceUrl = 'https://exp.host';

/**
 * The geocoder's sources (INT-2 plan 2.11): the official National Address API (short codes with
 * `NATIONAL_ADDRESS_API_KEY`; its POI API answers the reverse lookup without a key), the Sayyar
 * mirror (short codes and text, no key), Hudhud (every method, with `HUDHUD_API_KEY`) and the
 * fixture stub (local and ci only).
 */
export const geocoderSources = ['spl', 'sayyar', 'hudhud', 'stub'] as const;
export type GeocoderSource = (typeof geocoderSources)[number];

/** Each source's host; production refuses any other value (INT-2 plan 2.7). */
export const geocoderServiceUrls = {
  HUDHUD_API_URL: 'https://b.hudhud.sa',
  SPL_API_URL: 'https://apina.address.gov.sa',
  SPL_POI_URL: 'https://beta-api.address.gov.sa',
  SAYYAR_URL: 'https://sayyar.com',
} as const;

/** Unset `GEOCODER_SOURCES`: the stub in local and ci, else the chain of plan 2.11. */
export function defaultGeocoderSources(appEnv: string | undefined): readonly GeocoderSource[] {
  return appEnv === 'local' || appEnv === 'ci' ? ['stub'] : ['spl', 'sayyar', 'hudhud'];
}

/** The sources of a `GEOCODER_SOURCES` value, or undefined when it is not a list of distinct ones. */
export function splitGeocoderSources(text: string): GeocoderSource[] | undefined {
  const names = text.split(',').map((name) => name.trim());
  const known: readonly string[] = geocoderSources;
  if (names.some((name) => !known.includes(name))) return undefined;
  if (new Set(names).size !== names.length) return undefined;
  return names as GeocoderSource[];
}

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
  // The first super admin's invitation (PLAT-11 plan 2.12): the platform pool and the console URL.
  if (role === 'bootstrap') return ['DATABASE_URL_PLATFORM', 'PUBLIC_ADMIN_URL'];
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

export const adapterSelectors: readonly ServerVariable[] = [
  'MESSAGING_PROVIDER',
  'PUSH_PROVIDER',
  // GEOCODER_SOURCES is a list: its `stub` is refused by `geocoderRefusals`.
];

export interface RefusalInput {
  /** The parsed `APP_ENV`, or undefined when it was itself invalid (then no rule applies). */
  readonly appEnv: string | undefined;
  /** Whether the variable has a non-empty value in the record. */
  readonly present: (variable: ServerVariable) => boolean;
  /** The raw value of a variable, for selector checks (selectors are not secrets). */
  readonly raw: (variable: ServerVariable) => string | undefined;
  readonly messagingDisabled: boolean | undefined;
  /** `PUSH_DISABLED=true`: the explicit decision to send no push (INT-4 plan 2.6). */
  readonly pushDisabled: boolean | undefined;
  /** `GEOCODER_DISABLED=true`: the explicit decision to geocode nothing (INT-2 plan 2.7). */
  readonly geocoderDisabled: boolean | undefined;
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

/**
 * The engine credentials that must not keep a local value in staging or production (PLAT-9
 * adversary L-5): `.env.example`'s placeholders, or anything marked `not-for-production`.
 */
export const engineCredentialVariables: readonly ServerVariable[] = [
  'WHATSAPP_ENGINE_KEY_ID',
  'WHATSAPP_ENGINE_COMMAND_SECRET',
  'WHATSAPP_ENGINE_CALLBACK_KEY_ID',
  'WHATSAPP_ENGINE_CALLBACK_SECRET',
];
const localPlaceholders: ReadonlySet<string> = new Set(['local-command', 'local-callback']);

export function productionRefusals(input: RefusalInput): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (input.appEnv === 'staging' || input.appEnv === 'production') {
    for (const variable of engineCredentialVariables) {
      const value = input.raw(variable);
      // Only the verdict is reported, never the value.
      if (
        value !== undefined &&
        (localPlaceholders.has(value) || value.includes('not-for-production'))
      ) {
        issues.push({
          variable,
          problem: `holds the local placeholder of .env.example; ${input.appEnv} refuses it`,
        });
      }
    }
    for (const variable of refusedInDeployedEnvironments(input.role)) {
      if (input.present(variable)) {
        const problem = localAndCiOnly.includes(variable)
          ? `is for local and ci tooling only; ${input.appEnv} refuses it`
          : `must not be given to the ${input.role} role in ${input.appEnv} (ADR-0031)`;
        issues.push({ variable, problem });
      }
    }
    issues.push(...pushRefusals(input, input.appEnv));
    issues.push(...geocoderRefusals(input, input.appEnv));
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
  if (input.role !== 'migrate' && input.role !== 'bootstrap') {
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
    input.role !== 'bootstrap' &&
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

/**
 * The push decision of a deployed worker (INT-4 plan 2.6; integrations §2.5, §9): staging and
 * production send through Expo with an access token (enhanced push security, plan §7 question 1),
 * or say `PUSH_DISABLED=true`; production talks to the Expo push service only. Only the worker
 * sends a push, so only the worker is refused; the api never builds a push sender.
 */
function pushRefusals(input: RefusalInput, appEnv: 'staging' | 'production'): ConfigIssue[] {
  if (input.role !== 'worker') return [];
  const issues: ConfigIssue[] = [];
  if (input.pushDisabled !== true) {
    const provider = input.raw('PUSH_PROVIDER');
    if (provider !== 'expo') {
      // Production's selector rule already reports `stub`; staging refuses it here.
      if (provider !== 'stub' || appEnv === 'staging') {
        issues.push({
          variable: 'PUSH_PROVIDER',
          problem: `must be expo when APP_ENV=${appEnv}, unless PUSH_DISABLED=true`,
        });
      }
    } else if (!input.present('EXPO_ACCESS_TOKEN')) {
      issues.push({
        variable: 'EXPO_ACCESS_TOKEN',
        problem: `is required with PUSH_PROVIDER=expo when APP_ENV=${appEnv} (enhanced push security)`,
      });
    }
  }
  if (
    appEnv === 'production' &&
    input.present('EXPO_PUSH_URL') &&
    input.raw('EXPO_PUSH_URL') !== expoPushServiceUrl
  ) {
    issues.push({
      variable: 'EXPO_PUSH_URL',
      problem: `must be ${expoPushServiceUrl} in production`,
    });
  }
  return issues;
}

/**
 * The geocoder decision of a deployed api or worker (INT-2 plan 2.7, 2.11; integrations §2.2, §9):
 * staging and production never run the stub, and every method (short code, text, reverse) needs
 * at least one source that can answer it, unless `GEOCODER_DISABLED=true` (every call then answers
 * `unavailable`). Production talks to each source's own host only, so a key never leaves for
 * another one.
 */
function geocoderRefusals(input: RefusalInput, appEnv: 'staging' | 'production'): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const raw = input.raw('GEOCODER_SOURCES');
  const sources =
    raw === undefined || raw === '' ? defaultGeocoderSources(appEnv) : splitGeocoderSources(raw);
  // A malformed list is reported by the schema.
  if (sources?.includes('stub')) {
    issues.push({
      variable: 'GEOCODER_SOURCES',
      problem: `lists stub, which only local and ci run; ${appEnv} refuses it`,
    });
  } else if (
    sources !== undefined &&
    input.geocoderDisabled !== true &&
    (input.role === 'api' || input.role === 'worker')
  ) {
    const spl = sources.includes('spl');
    const sayyar = sources.includes('sayyar');
    const hudhud = sources.includes('hudhud') && input.present('HUDHUD_API_KEY');
    const missing = [
      ...((spl && input.present('NATIONAL_ADDRESS_API_KEY')) || sayyar || hudhud
        ? []
        : ['short code']),
      ...(sayyar || hudhud ? [] : ['text']),
      ...(spl || hudhud ? [] : ['reverse']),
    ];
    if (missing.length > 0) {
      issues.push({
        variable: 'GEOCODER_SOURCES',
        problem: `leaves no source for ${missing.join(', ')} when APP_ENV=${appEnv} (spl short codes need NATIONAL_ADDRESS_API_KEY, hudhud needs HUDHUD_API_KEY), unless GEOCODER_DISABLED=true`,
      });
    }
  }
  if (appEnv === 'production') {
    for (const [variable, url] of Object.entries(geocoderServiceUrls) as [
      ServerVariable,
      string,
    ][]) {
      if (input.present(variable) && input.raw(variable) !== url) {
        issues.push({ variable, problem: `must be ${url} in production` });
      }
    }
  }
  return issues;
}
