import { z } from 'zod';
import { Secret } from './secret.ts';

// Schema building blocks shared by the server and the public (web, driver) schemas. Every value
// arrives as a string or undefined. No Node-only API here: the public entry points bundle this file.

export const appEnvs = ['local', 'ci', 'staging', 'production'] as const;
export type AppEnv = (typeof appEnvs)[number];

const integer = (min: number, max: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));

export const port = () => integer(1, 65535);
export const count = (max: number) => integer(1, max);
export const seconds = () => integer(1, 31_536_000);

/** Only the literal strings `true` and `false`. */
export const boolean = () => z.enum(['true', 'false']).transform((value) => value === 'true');

export const httpUrl = () => z.url({ protocol: /^https?$/ });
export const postgresUrl = () => z.url({ protocol: /^postgres(?:ql)?$/ });
export const redisUrl = () => z.url({ protocol: /^rediss?$/ });

/** Wraps the parsed string in `Secret`, so it never prints. */
export const secret = (schema: z.ZodType<string> = z.string().min(1)) =>
  schema.transform((value) => new Secret(value));

/** A key id: short and printable, safe to store in a `*_key_id` text column and to name in errors. */
export const keyIdPattern = /^[A-Za-z0-9._-]{1,64}$/;
export const keyId = () => z.string().regex(keyIdPattern);
export const keyIdExpectation = 'a key id of 1 to 64 letters, digits, dot, underscore or dash';
