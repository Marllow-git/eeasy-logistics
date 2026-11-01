import { createHash } from 'node:crypto';
import { uuidv7 } from '@eeasy-logistics/db';
import { describe, expect, it } from 'vitest';
import {
  compoundToken,
  isOpaqueToken,
  opaqueToken,
  parseCompoundToken,
  tokenHash,
} from './tokens.js';

// PLAT-11 plan 2.3, 2.16: opaque tokens and their stored hashes.

describe('opaqueToken and tokenHash', () => {
  it('makes 32 random bytes in base64url, never twice the same', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => opaqueToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      expect(isOpaqueToken(token)).toBe(true);
    }
  });

  it('stores the SHA-256 of the token', () => {
    const token = opaqueToken();
    expect(tokenHash(token)).toEqual(createHash('sha256').update(token).digest());
    expect(tokenHash(token)).toHaveLength(32);
    expect(tokenHash(token).equals(tokenHash(opaqueToken()))).toBe(false);
  });

  it.each(['', 'short', `${opaqueToken()}x`, `${opaqueToken().slice(1)}+`])(
    'refuses %j as an opaque token',
    (value) => {
      expect(isOpaqueToken(value)).toBe(false);
    },
  );
});

describe('compound tokens', () => {
  it('round-trips <row id>.<secret>', () => {
    const id = uuidv7();
    const secret = opaqueToken();
    expect(parseCompoundToken(compoundToken(id, secret))).toEqual({ id, secret });
  });

  it.each([
    () => opaqueToken(),
    () => `${uuidv7()}${opaqueToken()}`,
    () => `${uuidv7()}.${opaqueToken().slice(1)}`,
    () => `not-a-uuid-not-a-uuid-not-a-uuid-123.${opaqueToken()}`,
    () => `${uuidv7()}:${opaqueToken()}`,
    () => `${uuidv7()}.${opaqueToken()}.`,
  ])('refuses a malformed token (%#)', (make) => {
    expect(parseCompoundToken(make())).toBeUndefined();
  });
});
