// Test-only access-token signer (PLAT-6 plan 2.3): issuing tokens is PLAT-11's, so tests mint them
// here with the same key, key id and claim shape the verifier expects. Never imported by src/.
import { randomBytes } from 'node:crypto';
import { uuidv7 } from '@eeasy-logistics/db';
import { SignJWT } from 'jose';
import type { TokenSurface } from '../../src/modules/kernel/auth/surfaces.js';

export interface TestSigningKey {
  readonly keyId: string;
  /** The raw key; tests pass it to the config as AUTH_SIGNING_KEY. */
  readonly key: string;
}

/** A fresh random key per test file; nothing reusable is committed. */
export function testSigningKey(keyId = 'test-key-1'): TestSigningKey {
  return { keyId, key: randomBytes(48).toString('base64') };
}

export interface TokenOptions {
  readonly claims?: Record<string, unknown>;
  /** Claims to delete after defaults are applied. */
  readonly omit?: readonly string[];
  readonly keyId?: string;
  readonly algorithm?: 'HS256' | 'HS384' | 'HS512';
  /** The `typ` header; `null` omits it (default `at+jwt`). */
  readonly typ?: string | null;
  /** Seconds from now; negative for an expired token. */
  readonly expiresIn?: number;
}

/** The default claims of a token for `surface`; `acc` and friends follow the surface rules. */
export function defaultClaims(surface: TokenSurface): Record<string, unknown> {
  const tenant =
    surface === 'platform' ? { acc: null, mem: null } : { acc: uuidv7(), mem: uuidv7() };
  return {
    iss: 'eeasy-logistics',
    sub: uuidv7(),
    ...tenant,
    roles: surface === 'driver' ? ['driver'] : ['owner'],
    scopes: 'scopes-hash',
    sites: [],
    ver: 1,
    ...(surface === 'driver' ? { dev: uuidv7() } : {}),
  };
}

export async function signAccessToken(
  signing: TestSigningKey,
  surface: TokenSurface,
  options: TokenOptions = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    ...defaultClaims(surface),
    aud: surface,
    iat: now,
    exp: now + (options.expiresIn ?? 900),
    ...options.claims,
  };
  for (const name of options.omit ?? []) delete claims[name];
  return new SignJWT(claims)
    .setProtectedHeader({
      alg: options.algorithm ?? 'HS256',
      kid: options.keyId ?? signing.keyId,
      ...(options.typ === null ? {} : { typ: options.typ ?? 'at+jwt' }),
    })
    .sign(new TextEncoder().encode(signing.key));
}
