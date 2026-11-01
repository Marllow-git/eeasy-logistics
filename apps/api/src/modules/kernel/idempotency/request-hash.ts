import { createHmac, hkdfSync } from 'node:crypto';

// The idempotency request hash (PLAT-6 plan 2.8; contracts README §3 Idempotency; adversary M-2):
// HMAC-SHA256 under a key derived from the signing key, over the method, the concrete path and the
// whole canonical JSON body, secrets included. A replay with a different secret is
// `idempotency_key_reused`; a stored hash cannot be brute-forced offline for a PIN or an OTP
// without the server key. The secret-field list decides only what a stored response keeps.

export const defaultSecretFields = ['cash_pin', 'password', 'otp', 'api_key', 'secret'] as const;

/** The HMAC key for removed secrets: HKDF-SHA256 of the signing key, info `elx-idempotency`. */
export function idempotencyHmacKey(signingKey: string): Buffer {
  return Buffer.from(hkdfSync('sha256', signingKey, Buffer.alloc(0), 'elx-idempotency', 32));
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** JSON with object keys sorted at every level, so key order never changes the hash. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, Json> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) sorted[key] = sortKeys(entry);
    }
    return sorted;
  }
  if (value === undefined) return null;
  return value as Json;
}

export interface Stripped {
  /** The value with every secret field removed, at any depth. */
  readonly value: unknown;
  /** The removed values by JSON pointer, in pointer order. */
  readonly secrets: readonly (readonly [string, unknown])[];
}

/** Removes every field named in `fields` from `value`, at any depth, recording what it removed. */
export function stripSecrets(value: unknown, fields: readonly string[]): Stripped {
  const secrets: [string, unknown][] = [];
  const walk = (node: unknown, pointer: string): unknown => {
    if (Array.isArray(node)) return node.map((item, index) => walk(item, `${pointer}/${index}`));
    if (node !== null && typeof node === 'object') {
      const copy: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(node)) {
        const path = `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
        if (fields.includes(key)) secrets.push([path, entry]);
        else copy[key] = walk(entry, path);
      }
      return copy;
    }
    return node;
  };
  const stripped = walk(value, '');
  secrets.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { value: stripped, secrets };
}

export interface HashInput {
  readonly method: string;
  /** The concrete path and query (`req.originalUrl`), so a key cannot replay another resource. */
  readonly path: string;
  readonly body: unknown;
  readonly hmacKey: Buffer;
}

export function requestHash(input: HashInput): Buffer {
  const material = canonicalJson({
    method: input.method.toUpperCase(),
    path: input.path,
    body: input.body ?? null,
  });
  return createHmac('sha256', input.hmacKey).update(material).digest();
}
