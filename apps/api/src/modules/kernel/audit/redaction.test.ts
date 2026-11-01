import { describe, expect, it } from 'vitest';
import { maxDocumentBytes, redactForAudit, redactText } from './redaction.js';

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
