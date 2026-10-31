import { z } from 'zod';
import type { ConfigIssue } from './errors.ts';
import { ConfigError } from './errors.ts';
import type { EnvRecord } from './fields.ts';
import { deepFreeze, parseVariables } from './fields.ts';
import type { AppEnv } from './formats.ts';
import {
  appEnvs,
  boolean,
  count,
  httpUrl,
  keyId,
  keyIdExpectation,
  keyIdPattern,
  port,
  postgresUrl,
  redisUrl,
  seconds,
  secret,
} from './formats.ts';
import { productionRefusals } from './refusals.ts';
import { Secret } from './secret.ts';

export const appRoles = ['api', 'worker', 'migrate'] as const;
export type AppRole = (typeof appRoles)[number];

export const messagingProviders = ['stub', 'meta', 'bsp'] as const;
export type MessagingProvider = (typeof messagingProviders)[number];

/** `CREDENTIALS_KEYS`: comma-separated `<key id>:<base64 of exactly 32 bytes>` entries. */
const credentialsKeys = () =>
  z.string().transform((text, ctx) => {
    const keys: Record<string, Secret> = {};
    text.split(',').forEach((rawEntry, index) => {
      // Problems name the entry by position only: an entry with a misplaced colon could put key
      // material where the id belongs, so not even the id is echoed.
      const entry = rawEntry.trim();
      const separator = entry.indexOf(':');
      const id = separator === -1 ? '' : entry.slice(0, separator);
      const material = separator === -1 ? '' : entry.slice(separator + 1);
      if (!keyIdPattern.test(id)) {
        ctx.addIssue({ code: 'custom', message: `entry ${index + 1} has no valid key id` });
      } else if (Object.hasOwn(keys, id)) {
        ctx.addIssue({ code: 'custom', message: `entry ${index + 1} repeats a key id` });
      } else if (!isBase64Key(material)) {
        ctx.addIssue({ code: 'custom', message: `entry ${index + 1} is not 32 bytes in base64` });
      } else {
        keys[id] = new Secret(material);
      }
    });
    return keys;
  });

function isBase64Key(material: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(material)) return false;
  return Buffer.from(material, 'base64').length === 32;
}

/**
 * Every server-side variable (plan 2.2). A variable with neither `.default()` nor `.optional()` is
 * required in every environment; what production additionally requires is in refusals.ts.
 * Adding a variable here without an expectation below, or without a line in `.env.example`, fails
 * typecheck or the package tests.
 */
export const serverVariables = {
  // app
  APP_ENV: z.enum(appEnvs),
  PORT: port().default(3000),
  PUBLIC_WEB_URL: httpUrl().optional(),
  PUBLIC_API_URL: httpUrl().optional(),
  // db: one URL per database role (data §4.4), pool sizes for the two pooled roles
  DATABASE_URL_OWNER: secret(postgresUrl()).optional(),
  DATABASE_URL_APP: secret(postgresUrl()).optional(),
  DATABASE_URL_PLATFORM: secret(postgresUrl()).optional(),
  DATABASE_URL_MAINTENANCE: secret(postgresUrl()).optional(),
  DATABASE_POOL_SIZE_APP: count(200).default(10),
  DATABASE_POOL_SIZE_PLATFORM: count(200).default(5),
  // redis
  REDIS_URL: secret(redisUrl()).optional(),
  // storage
  STORAGE_ENDPOINT: httpUrl().optional(),
  STORAGE_BUCKET: z.string().min(1).optional(),
  STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
  STORAGE_SECRET_ACCESS_KEY: secret().optional(),
  STORAGE_PUBLIC_URL: httpUrl().optional(),
  // auth
  AUTH_SIGNING_KEY_ID: keyId().optional(),
  AUTH_SIGNING_KEY: secret(z.string().min(32)).optional(),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: seconds().default(900),
  AUTH_STAFF_REFRESH_TTL_SECONDS: seconds().default(2_592_000),
  AUTH_DRIVER_REFRESH_TTL_SECONDS: seconds().default(7_776_000),
  // messaging
  MESSAGING_PROVIDER: z.enum(messagingProviders).optional(),
  MESSAGING_DISABLED: boolean().default(false),
  MESSAGING_ACCESS_TOKEN: secret().optional(),
  MESSAGING_SENDER_ID: z.string().min(1).optional(),
  // push
  EXPO_ACCESS_TOKEN: secret().optional(),
  // geo
  HUDHUD_API_KEY: secret().optional(),
  VROOM_URL: httpUrl().optional(),
  OSRM_URL: httpUrl().optional(),
  // observability
  OTEL_EXPORTER_OTLP_ENDPOINT: httpUrl().optional(),
  SENTRY_DSN: httpUrl().optional(),
  POSTHOG_API_KEY: z.string().min(1).optional(),
  // credentials
  CREDENTIALS_KEYS: credentialsKeys().optional(),
  CREDENTIALS_ACTIVE_KEY_ID: keyId().optional(),
};

export type ServerVariable = keyof typeof serverVariables;

const seconds1y = 'a number of seconds from 1 to 31536000';

export const serverExpectations = {
  APP_ENV: `one of ${appEnvs.join(', ')}`,
  PORT: 'an integer from 1 to 65535',
  PUBLIC_WEB_URL: 'an http(s) URL',
  PUBLIC_API_URL: 'an http(s) URL',
  DATABASE_URL_OWNER: 'a postgres:// URL',
  DATABASE_URL_APP: 'a postgres:// URL',
  DATABASE_URL_PLATFORM: 'a postgres:// URL',
  DATABASE_URL_MAINTENANCE: 'a postgres:// URL',
  DATABASE_POOL_SIZE_APP: 'an integer from 1 to 200',
  DATABASE_POOL_SIZE_PLATFORM: 'an integer from 1 to 200',
  REDIS_URL: 'a redis:// or rediss:// URL',
  STORAGE_ENDPOINT: 'an http(s) URL',
  STORAGE_BUCKET: 'a bucket name',
  STORAGE_ACCESS_KEY_ID: 'an access key id',
  STORAGE_SECRET_ACCESS_KEY: 'a secret access key',
  STORAGE_PUBLIC_URL: 'an http(s) URL',
  AUTH_SIGNING_KEY_ID: keyIdExpectation,
  AUTH_SIGNING_KEY: 'a key of at least 32 characters',
  AUTH_ACCESS_TOKEN_TTL_SECONDS: seconds1y,
  AUTH_STAFF_REFRESH_TTL_SECONDS: seconds1y,
  AUTH_DRIVER_REFRESH_TTL_SECONDS: seconds1y,
  MESSAGING_PROVIDER: `one of ${messagingProviders.join(', ')}`,
  MESSAGING_DISABLED: 'true or false',
  MESSAGING_ACCESS_TOKEN: 'a provider access token',
  MESSAGING_SENDER_ID: 'a provider sender id',
  EXPO_ACCESS_TOKEN: 'an Expo access token',
  HUDHUD_API_KEY: 'a Hudhud API key',
  VROOM_URL: 'an http(s) URL',
  OSRM_URL: 'an http(s) URL',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'an http(s) URL',
  SENTRY_DSN: 'an http(s) URL',
  POSTHOG_API_KEY: 'a PostHog project API key',
  CREDENTIALS_KEYS: 'comma-separated <key id>:<base64 of 32 bytes> entries',
  CREDENTIALS_ACTIVE_KEY_ID: keyIdExpectation,
} satisfies Record<ServerVariable, string>;

/** The validated server configuration: every group of plan 2.2, deep-frozen, secrets wrapped. */
export interface Config {
  readonly app: {
    readonly env: AppEnv;
    readonly role: AppRole;
    readonly port: number;
    readonly publicWebUrl: string | undefined;
    readonly publicApiUrl: string | undefined;
  };
  readonly db: {
    readonly urls: {
      readonly owner: Secret | undefined;
      readonly app: Secret | undefined;
      readonly platform: Secret | undefined;
      readonly maintenance: Secret | undefined;
    };
    readonly poolSize: { readonly app: number; readonly platform: number };
  };
  readonly redis: { readonly url: Secret | undefined };
  readonly storage: {
    readonly endpoint: string | undefined;
    readonly bucket: string | undefined;
    readonly accessKeyId: string | undefined;
    readonly secretAccessKey: Secret | undefined;
    readonly publicUrl: string | undefined;
  };
  readonly auth: {
    readonly signingKeyId: string | undefined;
    readonly signingKey: Secret | undefined;
    readonly accessTokenTtlSeconds: number;
    readonly staffRefreshTtlSeconds: number;
    readonly driverRefreshTtlSeconds: number;
  };
  readonly messaging: {
    /** `null` only when no provider is set in staging or production; see `resolveProvider`. */
    readonly provider: MessagingProvider | null;
    readonly disabled: boolean;
    readonly accessToken: Secret | undefined;
    readonly senderId: string | undefined;
  };
  readonly push: { readonly expoAccessToken: Secret | undefined };
  readonly geo: {
    readonly hudhudApiKey: Secret | undefined;
    readonly vroomUrl: string | undefined;
    readonly osrmUrl: string | undefined;
  };
  readonly observability: {
    readonly otlpEndpoint: string | undefined;
    readonly sentryDsn: string | undefined;
    readonly posthogApiKey: string | undefined;
  };
  /** `null` when no credentials keys are configured (allowed outside production). */
  readonly credentials: {
    readonly keys: Readonly<Record<string, Secret>>;
    readonly activeKeyId: string;
  } | null;
}

export interface DefineConfigOptions {
  /** The process role from `--role` (platform §2); default `api`. */
  readonly role?: AppRole;
}

/**
 * Validates a plain record of environment variables and returns the frozen, typed configuration.
 * Never reads `process.env` itself: the entry point (`@eeasy-logistics/config/node`) hands it over.
 * Throws one `ConfigError` listing every problem.
 */
export function defineConfig(env: EnvRecord, options: DefineConfigOptions = {}): Config {
  const { values: v, issues } = parseVariables(serverVariables, serverExpectations, env);
  const present = (variable: ServerVariable): boolean => {
    const raw = Object.hasOwn(env, variable) ? env[variable] : undefined;
    return raw !== undefined && raw !== '';
  };

  const role = options.role ?? 'api';
  if (!(appRoles as readonly string[]).includes(role)) {
    issues.push({
      variable: '--role',
      problem: `is invalid: expected one of ${appRoles.join(', ')}`,
    });
  }

  issues.push(...pairRules(present));
  if (v.MESSAGING_PROVIDER === 'meta' || v.MESSAGING_PROVIDER === 'bsp') {
    for (const variable of ['MESSAGING_ACCESS_TOKEN', 'MESSAGING_SENDER_ID'] as const) {
      if (!present(variable)) {
        issues.push({ variable, problem: 'is required when MESSAGING_PROVIDER is meta or bsp' });
      }
    }
  }
  if (v.CREDENTIALS_KEYS !== undefined && v.CREDENTIALS_ACTIVE_KEY_ID !== undefined) {
    if (!Object.hasOwn(v.CREDENTIALS_KEYS, v.CREDENTIALS_ACTIVE_KEY_ID)) {
      issues.push({
        variable: 'CREDENTIALS_ACTIVE_KEY_ID',
        problem: 'names a key id that is not in CREDENTIALS_KEYS',
      });
    }
  }

  // Production refusals (plan 2.3); a variable already reported above is not reported twice.
  const reported = new Set(issues.map((issue) => issue.variable));
  const refusals = productionRefusals({
    appEnv: v.APP_ENV,
    present,
    raw: (variable) => (Object.hasOwn(env, variable) ? env[variable] : undefined),
    messagingDisabled: v.MESSAGING_DISABLED,
  });
  issues.push(...refusals.filter((issue) => !reported.has(issue.variable)));

  if (issues.length > 0) throw new ConfigError(issues);

  const appEnv = v.APP_ENV;
  const config: Config = {
    app: {
      env: appEnv,
      role,
      port: v.PORT,
      publicWebUrl: v.PUBLIC_WEB_URL,
      publicApiUrl: v.PUBLIC_API_URL,
    },
    db: {
      urls: {
        owner: v.DATABASE_URL_OWNER,
        app: v.DATABASE_URL_APP,
        platform: v.DATABASE_URL_PLATFORM,
        maintenance: v.DATABASE_URL_MAINTENANCE,
      },
      poolSize: { app: v.DATABASE_POOL_SIZE_APP, platform: v.DATABASE_POOL_SIZE_PLATFORM },
    },
    redis: { url: v.REDIS_URL },
    storage: {
      endpoint: v.STORAGE_ENDPOINT,
      bucket: v.STORAGE_BUCKET,
      accessKeyId: v.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: v.STORAGE_SECRET_ACCESS_KEY,
      publicUrl: v.STORAGE_PUBLIC_URL,
    },
    auth: {
      signingKeyId: v.AUTH_SIGNING_KEY_ID,
      signingKey: v.AUTH_SIGNING_KEY,
      accessTokenTtlSeconds: v.AUTH_ACCESS_TOKEN_TTL_SECONDS,
      staffRefreshTtlSeconds: v.AUTH_STAFF_REFRESH_TTL_SECONDS,
      driverRefreshTtlSeconds: v.AUTH_DRIVER_REFRESH_TTL_SECONDS,
    },
    messaging: {
      provider: resolveProvider(v.MESSAGING_PROVIDER, appEnv),
      disabled: v.MESSAGING_DISABLED,
      accessToken: v.MESSAGING_ACCESS_TOKEN,
      senderId: v.MESSAGING_SENDER_ID,
    },
    push: { expoAccessToken: v.EXPO_ACCESS_TOKEN },
    geo: { hudhudApiKey: v.HUDHUD_API_KEY, vroomUrl: v.VROOM_URL, osrmUrl: v.OSRM_URL },
    observability: {
      otlpEndpoint: v.OTEL_EXPORTER_OTLP_ENDPOINT,
      sentryDsn: v.SENTRY_DSN,
      posthogApiKey: v.POSTHOG_API_KEY,
    },
    credentials:
      v.CREDENTIALS_KEYS !== undefined && v.CREDENTIALS_ACTIVE_KEY_ID !== undefined
        ? { keys: v.CREDENTIALS_KEYS, activeKeyId: v.CREDENTIALS_ACTIVE_KEY_ID }
        : null,
  };
  return deepFreeze(config);
}

/** Unset means the stub in `local` and `ci` (integrations §9) and no provider elsewhere. */
function resolveProvider(
  provider: MessagingProvider | undefined,
  appEnv: AppEnv,
): MessagingProvider | null {
  if (provider !== undefined) return provider;
  return appEnv === 'local' || appEnv === 'ci' ? 'stub' : null;
}

/** Variables that only make sense together, in every environment. */
const groups: readonly (readonly ServerVariable[])[] = [
  ['AUTH_SIGNING_KEY_ID', 'AUTH_SIGNING_KEY'],
  ['CREDENTIALS_KEYS', 'CREDENTIALS_ACTIVE_KEY_ID'],
  ['STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY'],
];

function pairRules(present: (variable: ServerVariable) => boolean): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const group of groups) {
    const set = group.filter(present);
    if (set.length === 0 || set.length === group.length) continue;
    for (const variable of group.filter((name) => !present(name))) {
      issues.push({ variable, problem: `is required together with ${set.join(', ')}` });
    }
  }
  return issues;
}
