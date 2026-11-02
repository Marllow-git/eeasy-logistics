import { z } from 'zod';
import type { ConfigIssue } from './errors.ts';
import { ConfigError } from './errors.ts';
import type { EnvRecord } from './fields.ts';
import { deepFreeze, parseVariables } from './fields.ts';
import type { AppEnv, LogLevel } from './formats.ts';
import {
  appEnvs,
  boolean,
  count,
  hops,
  httpUrl,
  keyId,
  keyIdExpectation,
  keyIdPattern,
  logLevels,
  port,
  otlpHeaders,
  postgresUrl,
  ratio,
  redisUrl,
  release,
  releaseExpectation,
  retentionMonths,
  seconds,
  graceSeconds,
  totpIssuer,
  mailFrom,
  secret,
  smtpUrl,
  engineUrl,
  serviceIdentityPattern,
} from './formats.ts';
import { productionRefusals } from './refusals.ts';
import { Secret } from './secret.ts';

// `bootstrap` (PLAT-11 plan 2.12): the one-shot command that invites the first super admin.
export const appRoles = ['api', 'worker', 'migrate', 'bootstrap'] as const;
export type AppRole = (typeof appRoles)[number];

/**
 * `stub` (`tools/whatsapp-stub`, local and ci) or `engine` (the Eeasy WhatsApp engine, ADR-0041);
 * both speak the engine's signed internal API through the same adapter.
 */
export const messagingProviders = ['stub', 'engine'] as const;
export type MessagingProvider = (typeof messagingProviders)[number];

/** `CREDENTIALS_KEYS`: comma-separated `<key id>:<base64 of exactly 32 bytes>` entries. */
const credentialsKeys = () =>
  z.string().transform((text, ctx) => {
    // No prototype: a key id such as `__proto__` must stay an ordinary entry.
    const keys = Object.create(null) as Record<string, Secret>;
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
  TRUST_PROXY_HOPS: hops().default(0),
  PUBLIC_WEB_URL: httpUrl().optional(),
  // The platform console's own origin (ADR-0038, WEB-19).
  PUBLIC_ADMIN_URL: httpUrl().optional(),
  PUBLIC_API_URL: httpUrl().optional(),
  // db: one URL per database role (data §4.4), pool sizes for the two pooled roles
  DATABASE_URL_OWNER: secret(postgresUrl()).optional(),
  DATABASE_URL_APP: secret(postgresUrl()).optional(),
  DATABASE_URL_PLATFORM: secret(postgresUrl()).optional(),
  DATABASE_URL_MAINTENANCE: secret(postgresUrl()).optional(),
  DATABASE_POOL_SIZE_APP: count(200).default(10),
  DATABASE_POOL_SIZE_PLATFORM: count(200).default(5),
  // A superuser for local and ci tooling only (scratch test databases, the elx_seed template);
  // refused in staging and production (refusals.ts).
  DATABASE_URL_ADMIN: secret(postgresUrl()).optional(),
  // Row-level security switch read by the migration job (PLAT-5 plan 2.6, data §4.5).
  ELX_RLS: z.enum(['on', 'off']).default('off'),
  // audit log (PLAT-7): months core_audit_log keeps; the migration job (--role migrate) drops
  // older monthly partitions on every run (OPS-1 schedules it daily).
  AUDIT_RETENTION_MONTHS: retentionMonths().default(24),
  // redis
  REDIS_URL: secret(redisUrl()).optional(),
  // outbox (PLAT-8): --role worker runs the single-leader relay unless OUTBOX_RELAY=off (then it
  // runs the queues only); rows per relay batch; the daily pruning job.
  OUTBOX_RELAY: z.enum(['on', 'off']).default('on'),
  OUTBOX_RELAY_BATCH: count(5000).default(500),
  OUTBOX_PRUNE: z.enum(['on', 'off']).default('on'),
  // storage
  STORAGE_ENDPOINT: httpUrl().optional(),
  STORAGE_BUCKET: z.string().min(1).optional(),
  STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
  STORAGE_SECRET_ACCESS_KEY: secret().optional(),
  STORAGE_PUBLIC_URL: httpUrl().optional(),
  // auth
  AUTH_SIGNING_KEY_ID: keyId().optional(),
  AUTH_SIGNING_KEY: secret(
    z
      .string()
      .min(32)
      .refine((value) => new Set(value).size >= 16, {
        message: 'has fewer than 16 distinct characters; generate one with openssl rand -base64 48',
      }),
  ).optional(),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: seconds().default(900),
  AUTH_STAFF_REFRESH_TTL_SECONDS: seconds().default(2_592_000),
  AUTH_DRIVER_REFRESH_TTL_SECONDS: seconds().default(7_776_000),
  // PLAT-11 plan 2.14: the platform session's sliding idle expiry (identity §3.3: 12 h), the refresh
  // reuse grace (Q-23: 30 s, 0 disables) and the issuer authenticator apps show for TOTP.
  AUTH_PLATFORM_IDLE_TTL_SECONDS: seconds().default(43_200),
  AUTH_REFRESH_REUSE_GRACE_SECONDS: graceSeconds().default(30),
  AUTH_TOTP_ISSUER: totpIssuer().default('eeasy-logistics'),
  // messaging
  MESSAGING_PROVIDER: z.enum(messagingProviders).optional(),
  MESSAGING_DISABLED: boolean().default(false),
  // The WhatsApp stub's URL (local and ci only).
  MESSAGING_STUB_URL: httpUrl().optional(),
  // OTP requests across the platform per hour (PLAT-9 adversary M-1).
  OTP_GLOBAL_HOURLY_BUDGET: count(100_000).default(500),
  // The engine's signed internal API (PLAT-9 plan 2A.1; engine contract §2): its base URL, our
  // service identity and command key, the separate callback key, and the platform's linked sender
  // instance (OTP and platform messages, 2A.4). The stub reads the same signing variables.
  WHATSAPP_ENGINE_URL: secret(engineUrl()).optional(),
  WHATSAPP_ENGINE_SERVICE_ID: secret(z.string().regex(serviceIdentityPattern)).optional(),
  WHATSAPP_ENGINE_KEY_ID: secret(keyId()).optional(),
  WHATSAPP_ENGINE_COMMAND_SECRET: secret(z.string().min(32)).optional(),
  WHATSAPP_ENGINE_CALLBACK_KEY_ID: secret(keyId()).optional(),
  WHATSAPP_ENGINE_CALLBACK_SECRET: secret(z.string().min(32)).optional(),
  WHATSAPP_ENGINE_PLATFORM_INSTANCE_ID: z.uuid().optional(),
  // mail (PLAT-9 plan 2.2): SMTP for invitations and resets; Mailpit locally and in ci.
  MAIL_SMTP_URL: secret(smtpUrl()).optional(),
  MAIL_FROM: mailFrom().optional(),
  // push
  EXPO_ACCESS_TOKEN: secret().optional(),
  // geo
  HUDHUD_API_KEY: secret().optional(),
  VROOM_URL: httpUrl().optional(),
  OSRM_URL: httpUrl().optional(),
  // observability
  OTEL_EXPORTER_OTLP_ENDPOINT: httpUrl().optional(),
  // The collector's headers (its credentials), `name=value,...` percent-encoded (adversary A-7).
  OTEL_EXPORTER_OTLP_HEADERS: otlpHeaders().optional(),
  SENTRY_DSN: httpUrl().optional(),
  POSTHOG_API_KEY: z.string().min(1).optional(),
  // PLAT-14: the image tag (`sha-<commit>`) the Dockerfile bakes in from its build argument;
  // `service.version` of every span and the Sentry release. `dev` outside an image.
  ELX_RELEASE: release().default('dev'),
  // Log level of the JSON logger; unset means `debug` in local and `info` elsewhere.
  LOG_LEVEL: z.enum(logLevels).optional(),
  // Root-span sampling ratio (parent-based); unset means 1.0, or 0.1 in production.
  OTEL_TRACES_SAMPLER_ARG: ratio().optional(),
  // credentials
  CREDENTIALS_KEYS: credentialsKeys().optional(),
  CREDENTIALS_ACTIVE_KEY_ID: keyId().optional(),
};

export type ServerVariable = keyof typeof serverVariables;

const seconds1y = 'a number of seconds from 1 to 31536000';

export const serverExpectations = {
  APP_ENV: `one of ${appEnvs.join(', ')}`,
  PORT: 'an integer from 1 to 65535',
  TRUST_PROXY_HOPS: 'an integer from 0 to 10',
  PUBLIC_WEB_URL: 'an http(s) URL',
  PUBLIC_ADMIN_URL: 'an http(s) URL',
  PUBLIC_API_URL: 'an http(s) URL',
  DATABASE_URL_OWNER: 'a postgres:// URL',
  DATABASE_URL_APP: 'a postgres:// URL',
  DATABASE_URL_PLATFORM: 'a postgres:// URL',
  DATABASE_URL_MAINTENANCE: 'a postgres:// URL',
  DATABASE_POOL_SIZE_APP: 'an integer from 1 to 200',
  DATABASE_POOL_SIZE_PLATFORM: 'an integer from 1 to 200',
  DATABASE_URL_ADMIN: 'a postgres:// URL',
  ELX_RLS: 'on or off',
  AUDIT_RETENTION_MONTHS: 'an integer from 24 to 120 (months; two years at least)',
  REDIS_URL: 'a redis:// or rediss:// URL',
  OUTBOX_RELAY: 'on or off',
  OUTBOX_RELAY_BATCH: 'an integer from 1 to 5000',
  OUTBOX_PRUNE: 'on or off',
  STORAGE_ENDPOINT: 'an http(s) URL',
  STORAGE_BUCKET: 'a bucket name',
  STORAGE_ACCESS_KEY_ID: 'an access key id',
  STORAGE_SECRET_ACCESS_KEY: 'a secret access key',
  STORAGE_PUBLIC_URL: 'an http(s) URL',
  AUTH_SIGNING_KEY_ID: keyIdExpectation,
  AUTH_SIGNING_KEY: 'a key of at least 32 characters, at least 16 of them distinct',
  AUTH_ACCESS_TOKEN_TTL_SECONDS: seconds1y,
  AUTH_STAFF_REFRESH_TTL_SECONDS: seconds1y,
  AUTH_DRIVER_REFRESH_TTL_SECONDS: seconds1y,
  AUTH_PLATFORM_IDLE_TTL_SECONDS: seconds1y,
  AUTH_REFRESH_REUSE_GRACE_SECONDS: 'a number of seconds from 0 (off) to 3600',
  AUTH_TOTP_ISSUER: 'a name of 1 to 64 letters, digits, space, dot, underscore or dash',
  MESSAGING_PROVIDER: `one of ${messagingProviders.join(', ')}`,
  MESSAGING_DISABLED: 'true or false',
  MESSAGING_STUB_URL: 'an http(s) URL',
  OTP_GLOBAL_HOURLY_BUDGET: 'an integer from 1 to 100000',
  WHATSAPP_ENGINE_URL: 'an https URL, or http on a loopback host (engine contract §2.8)',
  WHATSAPP_ENGINE_SERVICE_ID:
    'a service identity of 1 to 64 letters, digits, dot, underscore or dash',
  WHATSAPP_ENGINE_KEY_ID: keyIdExpectation,
  WHATSAPP_ENGINE_COMMAND_SECRET: 'a secret of at least 32 characters',
  WHATSAPP_ENGINE_CALLBACK_KEY_ID: keyIdExpectation,
  WHATSAPP_ENGINE_CALLBACK_SECRET: 'a secret of at least 32 characters',
  WHATSAPP_ENGINE_PLATFORM_INSTANCE_ID: 'a UUID (the engine sender instance of the platform)',
  MAIL_SMTP_URL: 'an smtp:// or smtps:// URL',
  MAIL_FROM: 'a sender address, optionally with a display name: Name <user@example.com>',
  EXPO_ACCESS_TOKEN: 'an Expo access token',
  HUDHUD_API_KEY: 'a Hudhud API key',
  VROOM_URL: 'an http(s) URL',
  OSRM_URL: 'an http(s) URL',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'an http(s) URL',
  OTEL_EXPORTER_OTLP_HEADERS: 'comma-separated name=value pairs, values percent-encoded',
  SENTRY_DSN: 'an http(s) URL',
  POSTHOG_API_KEY: 'a PostHog project API key',
  ELX_RELEASE: releaseExpectation,
  LOG_LEVEL: `one of ${logLevels.join(', ')}`,
  OTEL_TRACES_SAMPLER_ARG: 'a number from 0 to 1',
  CREDENTIALS_KEYS: 'comma-separated <key id>:<base64 of 32 bytes> entries',
  CREDENTIALS_ACTIVE_KEY_ID: keyIdExpectation,
} satisfies Record<ServerVariable, string>;

/** The validated server configuration: every group of plan 2.2, deep-frozen, secrets wrapped. */
export interface Config {
  readonly app: {
    readonly env: AppEnv;
    readonly role: AppRole;
    readonly port: number;
    /** Proxies in front of the API whose `X-Forwarded-For` is trusted (platform §8: Cloudflare). */
    readonly trustProxyHops: number;
    readonly publicWebUrl: string | undefined;
    /** The platform console's origin (apps/admin, ADR-0038). */
    readonly publicAdminUrl: string | undefined;
    readonly publicApiUrl: string | undefined;
  };
  readonly db: {
    readonly urls: {
      readonly owner: Secret | undefined;
      readonly app: Secret | undefined;
      readonly platform: Secret | undefined;
      readonly maintenance: Secret | undefined;
      /** Superuser for local and ci tooling only; never set in staging or production. */
      readonly admin: Secret | undefined;
    };
    readonly poolSize: { readonly app: number; readonly platform: number };
    /** `ELX_RLS=on`: the migration job enables RLS on every table with a tenant_isolation policy. */
    readonly rls: boolean;
  };
  readonly audit: {
    /** Months core_audit_log keeps; the migration job drops older monthly partitions. */
    readonly retentionMonths: number;
  };
  readonly redis: { readonly url: Secret | undefined };
  readonly outbox: {
    /** `OUTBOX_RELAY=on`: the worker competes for the relay lock (PLAT-8 plan 2.3). */
    readonly relay: boolean;
    /** Rows per relay batch (`OUTBOX_RELAY_BATCH`, default 500; data §5.2). */
    readonly relayBatch: number;
    /** `OUTBOX_PRUNE=on`: the worker runs the daily outbox pruning job (plan 2.8). */
    readonly prune: boolean;
  };
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
    /** The platform session's sliding idle expiry (refresh rotation sets now + this). */
    readonly platformIdleTtlSeconds: number;
    /** Seconds after a rotation in which the same refresh token is answered again (0: off). */
    readonly refreshReuseGraceSeconds: number;
    readonly totpIssuer: string;
  };
  readonly messaging: {
    /** `null` only when no provider is set in staging or production; see `resolveProvider`. */
    readonly provider: MessagingProvider | null;
    readonly disabled: boolean;
    /** The WhatsApp stub (`tools/whatsapp-stub`); local and ci only. */
    readonly stubUrl: string | undefined;
    /** OTP requests across the platform per hour (`OTP_GLOBAL_HOURLY_BUDGET`, default 500). */
    readonly otpGlobalHourlyBudget: number;
    /** The engine's signed internal API (ADR-0041); all set when the provider is `engine`. */
    readonly engine: EngineSettings;
  };
  readonly mail: {
    /** SMTP URL (Mailpit locally); required in production for the api and worker. */
    readonly smtpUrl: Secret | undefined;
    readonly from: string | undefined;
  };
  readonly push: { readonly expoAccessToken: Secret | undefined };
  readonly geo: {
    readonly hudhudApiKey: Secret | undefined;
    readonly vroomUrl: string | undefined;
    readonly osrmUrl: string | undefined;
  };
  readonly observability: {
    readonly otlpEndpoint: string | undefined;
    /** `OTEL_EXPORTER_OTLP_HEADERS`; parse the revealed text with `parseOtlpHeaders`. */
    readonly otlpHeaders: Secret | undefined;
    readonly sentryDsn: string | undefined;
    readonly posthogApiKey: string | undefined;
    /** The image tag the process runs (`ELX_RELEASE`, `sha-<commit>`), `dev` outside an image. */
    readonly release: string;
    /** The lowest level the JSON logger writes. */
    readonly logLevel: LogLevel;
    /** Ratio of root traces sampled (parent-based sampling keeps a sampled parent's children). */
    readonly traceSampleRatio: number;
  };
  /** `null` when no credentials keys are configured (allowed outside production). */
  readonly credentials: {
    readonly keys: Readonly<Record<string, Secret>>;
    readonly activeKeyId: string;
  } | null;
}

/** The engine's signed internal API (PLAT-9 plan 2A.1); every value from its own variable. */
export interface EngineSettings {
  readonly url: Secret | undefined;
  /** Our service identity, `X-Eeasy-Service` on commands. */
  readonly serviceId: Secret | undefined;
  /** The command key id (`X-Eeasy-Key-Id` on commands). */
  readonly keyId: Secret | undefined;
  readonly commandSecret: Secret | undefined;
  /** The key id the engine signs callbacks under. */
  readonly callbackKeyId: Secret | undefined;
  readonly callbackSecret: Secret | undefined;
  /** The platform's linked sender instance (OTP and platform messages, plan 2A.4). */
  readonly platformInstanceId: string | undefined;
}

/** Required together when `MESSAGING_PROVIDER=engine`. */
const engineVariables: readonly ServerVariable[] = [
  'WHATSAPP_ENGINE_URL',
  'WHATSAPP_ENGINE_SERVICE_ID',
  'WHATSAPP_ENGINE_KEY_ID',
  'WHATSAPP_ENGINE_COMMAND_SECRET',
  'WHATSAPP_ENGINE_CALLBACK_KEY_ID',
  'WHATSAPP_ENGINE_CALLBACK_SECRET',
  'WHATSAPP_ENGINE_PLATFORM_INSTANCE_ID',
];

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
  if (v.MESSAGING_PROVIDER === 'engine') {
    for (const variable of engineVariables) {
      if (!present(variable)) {
        issues.push({ variable, problem: 'is required when MESSAGING_PROVIDER is engine' });
      }
    }
  }
  // Engine contract §2.1: the two directions never share a secret.
  const command = v.WHATSAPP_ENGINE_COMMAND_SECRET;
  const callback = v.WHATSAPP_ENGINE_CALLBACK_SECRET;
  if (command !== undefined && callback !== undefined && command.reveal() === callback.reveal()) {
    issues.push({
      variable: 'WHATSAPP_ENGINE_CALLBACK_SECRET',
      problem: 'must differ from WHATSAPP_ENGINE_COMMAND_SECRET (engine contract §2.1)',
    });
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
    role,
  });
  issues.push(...refusals.filter((issue) => !reported.has(issue.variable)));

  if (issues.length > 0) throw new ConfigError(issues);

  const appEnv = v.APP_ENV;
  const config: Config = {
    app: {
      env: appEnv,
      role,
      port: v.PORT,
      trustProxyHops: v.TRUST_PROXY_HOPS,
      publicWebUrl: v.PUBLIC_WEB_URL,
      publicAdminUrl: v.PUBLIC_ADMIN_URL,
      publicApiUrl: v.PUBLIC_API_URL,
    },
    db: {
      urls: {
        owner: v.DATABASE_URL_OWNER,
        app: v.DATABASE_URL_APP,
        platform: v.DATABASE_URL_PLATFORM,
        maintenance: v.DATABASE_URL_MAINTENANCE,
        admin: v.DATABASE_URL_ADMIN,
      },
      poolSize: { app: v.DATABASE_POOL_SIZE_APP, platform: v.DATABASE_POOL_SIZE_PLATFORM },
      rls: v.ELX_RLS === 'on',
    },
    audit: { retentionMonths: v.AUDIT_RETENTION_MONTHS },
    redis: { url: v.REDIS_URL },
    outbox: {
      relay: v.OUTBOX_RELAY === 'on',
      relayBatch: v.OUTBOX_RELAY_BATCH,
      prune: v.OUTBOX_PRUNE === 'on',
    },
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
      platformIdleTtlSeconds: v.AUTH_PLATFORM_IDLE_TTL_SECONDS,
      refreshReuseGraceSeconds: v.AUTH_REFRESH_REUSE_GRACE_SECONDS,
      totpIssuer: v.AUTH_TOTP_ISSUER,
    },
    messaging: {
      provider: resolveProvider(v.MESSAGING_PROVIDER, appEnv),
      disabled: v.MESSAGING_DISABLED,
      stubUrl: v.MESSAGING_STUB_URL,
      otpGlobalHourlyBudget: v.OTP_GLOBAL_HOURLY_BUDGET,
      engine: {
        url: v.WHATSAPP_ENGINE_URL,
        serviceId: v.WHATSAPP_ENGINE_SERVICE_ID,
        keyId: v.WHATSAPP_ENGINE_KEY_ID,
        commandSecret: v.WHATSAPP_ENGINE_COMMAND_SECRET,
        callbackKeyId: v.WHATSAPP_ENGINE_CALLBACK_KEY_ID,
        callbackSecret: v.WHATSAPP_ENGINE_CALLBACK_SECRET,
        platformInstanceId: v.WHATSAPP_ENGINE_PLATFORM_INSTANCE_ID,
      },
    },
    mail: { smtpUrl: v.MAIL_SMTP_URL, from: v.MAIL_FROM },
    push: { expoAccessToken: v.EXPO_ACCESS_TOKEN },
    geo: { hudhudApiKey: v.HUDHUD_API_KEY, vroomUrl: v.VROOM_URL, osrmUrl: v.OSRM_URL },
    observability: {
      otlpEndpoint: v.OTEL_EXPORTER_OTLP_ENDPOINT,
      otlpHeaders: v.OTEL_EXPORTER_OTLP_HEADERS,
      sentryDsn: v.SENTRY_DSN,
      posthogApiKey: v.POSTHOG_API_KEY,
      release: v.ELX_RELEASE,
      logLevel: v.LOG_LEVEL ?? (appEnv === 'local' ? 'debug' : 'info'),
      traceSampleRatio: v.OTEL_TRACES_SAMPLER_ARG ?? (appEnv === 'production' ? 0.1 : 1),
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
