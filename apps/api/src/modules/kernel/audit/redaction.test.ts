import { describe, expect, it } from 'vitest';
import { keyTokens, maxDocumentBytes, redactForAudit, redactText } from './redaction.js';

// PLAT-7 plan 2.5: what reaches core_audit_log is redacted first.

describe('redactForAudit', () => {
  it('replaces a nested password, at any depth and in arrays', () => {
    expect(
      redactForAudit({
        user: { name: 'Sara', password: 'hunter2', profile: { newPassword: 'x' } },
        members: [{ id: 'm1', cash_pin: '1234' }],
      }),
    ).toEqual({
      user: { name: 'Sara', password: '[redacted]', profile: { newPassword: '[redacted]' } },
      members: [{ id: 'm1', cash_pin: '[redacted]' }],
    });
  });

  it.each([
    'password',
    'client_secret',
    'refresh_token',
    'PIN',
    'otp_code',
    'api_key',
    'signing_key_id',
    'ciphertext',
    'Authorization',
    'Cookie',
  ])('redacts the key %s whatever its value', (key) => {
    expect(redactForAudit({ [key]: { nested: 'value' } })).toEqual({ [key]: '[redacted]' });
  });

  it.each([
    'private_key',
    'accessKey',
    'signing-key',
    'credentials',
    'encryption_key',
    'access.key',
    'APIKey',
    'session_cookies',
    'idempotency_key',
    'key_id',
    'passwd',
  ])('redacts %s by its key tokens (lead review round 1)', (key) => {
    expect(redactForAudit({ [key]: 'value' })).toEqual({ [key]: '[redacted]' });
  });

  it.each(['shipping_fee', 'shipping_address', 'spinner', 'keyboard_layout', 'pinned', 'monkey'])(
    'keeps %s: a secret word inside a token is not a token',
    (key) => {
      expect(redactForAudit({ [key]: 'value' })).toEqual({ [key]: 'value' });
    },
  );

  it('redacts by tokens inside nested arrays and objects', () => {
    expect(
      redactForAudit({
        connections: [{ provider: 'salla', credentials: { clientId: 'c', clientSecret: 's' } }],
        shipping: { shipping_fee: 1500, signingKey: { kid: 'k1' } },
      }),
    ).toEqual({
      connections: [{ provider: 'salla', credentials: '[redacted]' }],
      shipping: { shipping_fee: 1500, signingKey: '[redacted]' },
    });
  });

  it('splits keys on separators and camelCase', () => {
    expect(keyTokens('newPassword')).toEqual(['new', 'password']);
    expect(keyTokens('APIKey')).toEqual(['api', 'key']);
    expect(keyTokens('signing-key.id_v2')).toEqual(['signing', 'key', 'id', 'v', '2']);
  });

  it.each([
    'apiKey',
    'keyId',
    'x-api-key',
    'apikey',
    'privateKey',
    'passcode',
    'session_id',
    'jwt',
    'webhook_signature',
    'password_salt',
    'card_cvv',
    'iban',
  ])('redacts %s (adversary M-2 words, separators removed)', (key) => {
    expect(redactForAudit({ [key]: 'value' })).toEqual({ [key]: '[redacted]' });
  });

  it.each(['shipping_fee', 'footprint', 'sessionless_count'])('keeps %s (adversary M-2)', (key) => {
    expect(redactForAudit({ [key]: 'value' })).toEqual({ [key]: 'value' });
  });

  it('redacts a JWT or a Bearer credential whatever its key, also in an array of pairs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6ImF0K2p3dCJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLWJ5dGVz';
    expect(
      redactForAudit({
        note: jwt,
        headers: [
          ['accept', 'application/json'],
          ['x-forwarded', 'Bearer abc.def'],
        ],
        version: '1.2.3',
      }),
    ).toEqual({
      note: '[redacted]',
      headers: [
        ['accept', 'application/json'],
        ['x-forwarded', '[redacted]'],
      ],
      version: '1.2.3',
    });
    expect(redactText(`Bearer ${jwt}`)).toBe('[redacted]');
  });

  it('keeps keys that name no secret', () => {
    const value = { name: 'Main site', status: 'active', count: 3, ok: true, none: null };
    expect(redactForAudit(value)).toEqual(value);
  });

  it('caps strings at 2,000 characters without splitting a surrogate pair', () => {
    const result = redactForAudit({ note: 'ب'.repeat(2_500), emoji: '😀'.repeat(2_001) }) as {
      note: string;
      emoji: string;
    };
    expect(result.note).toHaveLength(2_000);
    expect(Array.from(result.emoji)).toHaveLength(2_000);
  });

  it('replaces a document over 32 KB by its size', () => {
    const items = Array.from({ length: 40 }, (_, index) => ({ index, text: 'x'.repeat(1_000) }));
    const result = redactForAudit({ items }) as { truncated: boolean; bytes: number };
    expect(result.truncated).toBe(true);
    expect(result.bytes).toBeGreaterThan(maxDocumentBytes);
  });

  it('drops __proto__ keys and never pollutes a prototype', () => {
    const parsed: unknown = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}');
    const result = redactForAudit(parsed);
    expect(result).toEqual({ a: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('turns non-JSON values into JSON and stops at cycles', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(
      redactForAudit({
        when: new Date('2026-11-01T00:00:00Z'),
        big: 10n,
        skip: undefined,
        fn: () => 1,
        nan: Number.NaN,
        cyclic,
      }),
    ).toEqual({
      when: '2026-11-01T00:00:00.000Z',
      big: '10',
      nan: null,
      cyclic: { a: 1, self: '[too_deep]' },
    });
  });

  it('answers null for nothing', () => {
    expect(redactForAudit(undefined)).toBeNull();
    expect(redactForAudit(null)).toBeNull();
  });
});

describe('redactText', () => {
  it('caps the reason and keeps null', () => {
    expect(redactText('x'.repeat(2_100))).toHaveLength(2_000);
    expect(redactText(null)).toBeNull();
    expect(redactText('Ticket 1')).toBe('Ticket 1');
  });
});
