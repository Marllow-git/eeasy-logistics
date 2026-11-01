import { describe, expect, it } from 'vitest';
import {
  canonicalString,
  isFresh,
  parseWireInstant,
  signCanonical,
  signatureMatches,
  signedHeaders,
  wireInstant,
} from './envelope.js';

// PLAT-9 items F and G: the engine contract's signing envelope (§2.1, §2.2, §2.4).

describe('engine envelope', () => {
  it('joins eight lines with one newline and no trailing newline', () => {
    const text = canonicalString({
      method: 'post',
      path: '/internal/v1/commands',
      service: 'svc',
      keyId: 'k1',
      timestamp: '2026-11-01T10:00:00Z',
      nonce: 'a'.repeat(32),
      bodySha256: 'b'.repeat(64),
    });
    expect(text).toBe(
      `v1\nPOST\n/internal/v1/commands\nsvc\nk1\n2026-11-01T10:00:00Z\n${'a'.repeat(32)}\n${'b'.repeat(64)}`,
    );
  });

  it('matches the engine’s HMAC (a fixed vector computed with openssl)', () => {
    // printf 'v1\nPOST\n/p\ns\nk\n2026-11-01T10:00:00Z\n<32 a>\n<64 b>' | openssl dgst -sha256 -hmac secret
    const text = canonicalString({
      method: 'POST',
      path: '/p',
      service: 's',
      keyId: 'k',
      timestamp: '2026-11-01T10:00:00Z',
      nonce: 'a'.repeat(32),
      bodySha256: 'b'.repeat(64),
    });
    expect(signCanonical(text, 'secret')).toBe(
      'v1=41893787d287c404416e8b8acc8248a50adf43671e097a0cccfe81cb839b00d8',
    );
  });

  it('compares signatures only of the v1 shape, in constant time', () => {
    const good = `v1=${'c'.repeat(64)}`;
    expect(signatureMatches(good, good)).toBe(true);
    expect(signatureMatches(good, `v1=${'d'.repeat(64)}`)).toBe(false);
    expect(signatureMatches(good, `v1=${'c'.repeat(63)}`)).toBe(false);
    expect(signatureMatches(good, `V1=${'c'.repeat(64)}`)).toBe(false);
    expect(signatureMatches(good, '')).toBe(false);
  });

  it('accepts only strict second-precision Z instants that round-trip', () => {
    expect(parseWireInstant('2026-11-01T10:00:00Z')).toBe(Date.parse('2026-11-01T10:00:00Z'));
    for (const bad of [
      '2026-11-01T10:00:00.000Z',
      '2026-11-01T10:00:00+03:00',
      '2026-02-30T10:00:00Z',
      '2026-11-01 10:00:00Z',
      123,
    ]) {
      expect(parseWireInstant(bad)).toBeUndefined();
    }
    expect(wireInstant(Date.parse('2026-11-01T10:00:00.900Z'))).toBe('2026-11-01T10:00:00Z');
  });

  it('is fresh within 60 seconds either way, and not beyond', () => {
    const now = Date.parse('2026-11-01T10:00:00Z');
    expect(isFresh('2026-11-01T10:01:00Z', now)).toBe(true);
    expect(isFresh('2026-11-01T09:59:00Z', now)).toBe(true);
    expect(isFresh('2026-11-01T10:01:01Z', now)).toBe(false);
    expect(isFresh('2026-11-01T09:58:59Z', now)).toBe(false);
    expect(isFresh('garbage', now)).toBe(false);
  });

  it('mints a fresh nonce per request', () => {
    const key = { service: 's', keyId: 'k', secret: 'x'.repeat(32) };
    const a = signedHeaders(key, 'POST', '/p', '{}');
    const b = signedHeaders(key, 'POST', '/p', '{}');
    expect(a['x-eeasy-nonce']).not.toBe(b['x-eeasy-nonce']);
  });
});
