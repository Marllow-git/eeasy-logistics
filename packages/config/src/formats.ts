import { z } from 'zod';
import { Secret } from './secret.ts';

// Schema building blocks shared by the server and the public (web, driver) schemas. Every value
// arrives as a string or undefined. No Node-only API here: the public entry points bundle this file.

export const appEnvs = ['local', 'ci', 'staging', 'production'] as const;
export type AppEnv = (typeof appEnvs)[number];

const integer = (min: number, max: number) =>
  // No sign, no leading zero (re-check N-1: `00` is not a distinct spelling of 0).
  z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

export const port = () => integer(1, 65535);
export const count = (max: number) => integer(1, max);
export const seconds = () => integer(1, 31_536_000);
/** Reverse-proxy hops in front of the API (`trust proxy`); 0 trusts no forwarded header. */
export const hops = () => integer(0, 10);
/** Months the audit log is kept (identity and tenancy §7: two years at least; PLAT-7). */
export const retentionMonths = () => integer(24, 120);

/** A ratio from 0 to 1 in plain decimal notation (`0`, `1`, `0.1`, `1.0`). */
export const ratio = () =>
  z
    .string()
    .regex(/^(0|1)(\.\d{1,6})?$/)
    .transform(Number)
    .pipe(z.number().min(0).max(1));

/** Levels of the JSON logger, most severe first (PLAT-14). */
export const logLevels = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof logLevels)[number];

/** A release name: the image tag `sha-<commit>`, a version or `dev`; printable, at most 128. */
export const release = () => z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
export const releaseExpectation =
  'a release name of 1 to 128 letters, digits, dot, underscore or dash';

/** Only the literal strings `true` and `false`. */
export const boolean = () => z.enum(['true', 'false']).transform((value) => value === 'true');

/**
 * An http(s) URL that carries no password: these fields are not secrets and may be logged, so
 * credentials belong in their own secret variables. (A user name alone, as in a Sentry DSN, is fine.)
 * Database and Redis URLs are `Secret` and may carry a password.
 */
export const httpUrl = () =>
  z.url({ protocol: /^https?$/ }).refine((value) => !hasPassword(value), {
    message: 'must not carry a password; put credentials in their own secret variable',
  });

// Zod runs refinements even after the URL check failed, so an unparseable value must not throw here.
// (No `URL.canParse`: the driver app's URL polyfill may lack it.)
function hasPassword(value: string): boolean {
  try {
    return new URL(value).password !== '';
  } catch {
    return false;
  }
}

export const postgresUrl = () => z.url({ protocol: /^postgres(?:ql)?$/ });
export const redisUrl = () => z.url({ protocol: /^rediss?$/ });

/** Wraps the parsed string in `Secret`, so it never prints. */
export const secret = (schema: z.ZodType<string> = z.string().min(1)) =>
  schema.transform((value) => new Secret(value));

/** A key id: short and printable, safe to store in a `*_key_id` text column and to name in errors. */
export const keyIdPattern = /^[A-Za-z0-9._-]{1,64}$/;
export const keyId = () => z.string().regex(keyIdPattern);
export const keyIdExpectation = 'a key id of 1 to 64 letters, digits, dot, underscore or dash';
