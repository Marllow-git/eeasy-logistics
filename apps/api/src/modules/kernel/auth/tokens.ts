import { createHash, randomBytes } from 'node:crypto';
import { isUuid } from '@eeasy-logistics/db';

// Opaque one-time tokens (PLAT-11 plan 2.3; data §10): invitation, reset, enrolment link, refresh
// token and challenge secrets. 32 random bytes in base64url; only the SHA-256 is stored, and a row
// is found by looking the hash up, so no comparison of secrets ever runs in application code.

const secretPattern = /^[A-Za-z0-9_-]{43}$/;

/** A fresh opaque token: 32 random bytes, base64url, 43 characters. */
export function opaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The stored form of a token: its SHA-256. */
export function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** Whether `value` has the shape of an `opaqueToken()` (checked before any lookup). */
export function isOpaqueToken(value: string): boolean {
  return secretPattern.test(value);
}

/**
 * The client-facing form of a challenge (`challenge_id`, `selection_token`, `enrolment_token`):
 * `<row id>.<secret>`, so a leaked row id alone is useless.
 */
export function compoundToken(id: string, secret: string): string {
  return `${id}.${secret}`;
}

/** The row id and secret of a compound token, or undefined when it is not one. */
export function parseCompoundToken(value: string): { id: string; secret: string } | undefined {
  if (value.length !== 36 + 1 + 43) return undefined;
  const id = value.slice(0, 36);
  const secret = value.slice(37);
  if (value[36] !== '.' || !isUuid(id) || !secretPattern.test(secret)) return undefined;
  return { id, secret };
}
