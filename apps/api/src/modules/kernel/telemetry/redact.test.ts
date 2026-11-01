import { describe, expect, it } from 'vitest';
import {
  capText,
  describeError,
  isTokenSegment,
  isWithheldKey,
  maskedEmail,
  maxDepth,
  maxInputLength,
  maxItems,
  redacted,
  redactText,
  redactValue,
} from './redact.js';

// PLAT-14 item D (plan 2.4; integrations §11 "Logging redaction"): the telemetry redactor.

describe('redactText: phone numbers', () => {
  it.each([
    ['+966512345678', '[phone …5678]'],
    ['+966 51 234 5678', '[phone …5678]'],
    ['+44-20-7946-0958', '[phone …0958]'],
    ['00966512345678', '[phone …5678]'],
    ['966512345678', '[phone …5678]'],
    ['0512345678', '[phone …5678]'],
  ])('masks %s to its last four digits', (phone, masked) => {
    expect(redactText(`sent to ${phone} at noon`)).toBe(`sent to ${masked} at noon`);
  });

  it('leaves ids, counts, timestamps and UUIDs alone', () => {
    const text =
      'row 0192f0e0-1234-7000-8000-00000000abcd took 1730000000000 ms, 12345678 rows, 2026-11-01';
    expect(redactText(text)).toBe(text);
  });
});

describe('redactText: emails and credentials', () => {
  it('masks an email address whole', () => {
    expect(redactText('owner sara.k+ops@merchant.example.sa replied')).toBe(
      `owner ${maskedEmail} replied`,
    );
  });

  it('removes bearer, basic and digest credentials', () => {
    expect(redactText('Authorization: Bearer abc.def-123')).toBe(
      `Authorization: ${redacted} ${redacted}`,
    );
    expect(redactText('sent Bearer abc.def-123 upstream')).toBe(`sent Bearer ${redacted} upstream`);
    expect(redactText('Basic dXNlcjpwYXNz')).toBe(`Basic ${redacted}`);
    expect(redactText('Digest username="a", response="b"')).toBe(`Digest ${redacted}`);
  });

  it('removes a JWT anywhere', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
    expect(redactText(`token was ${jwt}.`)).toBe(`token was ${redacted}.`);
  });

  it('removes URL user-info and secret or personal query values', () => {
    expect(
      redactText('GET https://user:pw@host.example/hook?token=abc&page=2&phone=0512345678'),
    ).toBe(`GET https://${redacted}@host.example/hook?token=${redacted}&page=2&phone=${redacted}`);
  });

  it('removes values of secret-named pairs in JSON and key=value text', () => {
    expect(redactText('{"api_key":"k-1","otp_code":"123456","status":"failed"}')).toBe(
      `{"api_key":"${redacted}","otp_code":"${redacted}","status":"failed"}`,
    );
    expect(redactText('password = hunter2, user=7')).toBe(`password = ${redacted}, user=7`);
  });

  it('redacts every segment after a webhook path marker (the Zid path secret)', () => {
    expect(redactText('POST https://api.example.test/hooks/zid/s3cr3tPathValue failed 401')).toBe(
      `POST https://api.example.test/hooks/${redacted}/${redacted} failed 401`,
    );
    expect(redactText('/v1/public/webhook/abc/def')).toBe(
      `/v1/public/webhook/${redacted}/${redacted}`,
    );
    expect(redactText('GET /callbacks/salla?x=1')).toBe(`GET /callbacks/${redacted}?x=1`);
    // A route template names its parameters, never their values.
    expect(redactText('POST /hooks/:provider/:secret')).toBe('POST /hooks/:provider/:secret');
  });

  it('redacts token-shaped path segments anywhere: JWT, long hex, long base64url', () => {
    const hex = 'a3f9c2e1b4d6078912ab34cd56ef7890';
    const b64 = 'Zk9x_2LmQ8vR4tYw7pNs3KdA';
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
    expect(redactText(`GET /v1/recipient/tracking/${b64}`)).toBe(
      `GET /v1/recipient/tracking/${redacted}`,
    );
    expect(redactText(`https://cdn.example.test/files/${hex}/label.pdf`)).toBe(
      `https://cdn.example.test/files/${redacted}/label.pdf`,
    );
    expect(redactText(`/v1/driver/session/${jwt}`)).toBe(`/v1/driver/session/${redacted}`);
  });

  it('redacts a 22-character base64url token, with digits or by mixed case alone (A-5)', () => {
    expect(redactText('/v1/recipient/tracking/Zk9xLmQ8vR4tYw7pNs3KdA')).toBe(
      `/v1/recipient/tracking/${redacted}`,
    );
    expect(redactText('/v1/recipient/tracking/ZkxLmQvRtYwpNsKdAbCdEf')).toBe(
      `/v1/recipient/tracking/${redacted}`,
    );
    expect(isTokenSegment('delivery-attempts-summaries')).toBe(false);
    expect(isTokenSegment('zkxlmqvrtywpnskdabcdef')).toBe(false);
  });

  it('leaves ordinary paths untouched: UUIDs, route words, templates, versions', () => {
    for (const path of [
      '/v1/staff/orders/0192f0e0-1234-7000-8000-00000000abcd',
      '/v1/platform/accounts/0192f0e0-1234-7000-8000-00000000abcd/audit-log',
      '/v1/platform/outbox/replay-dead',
      '/v1/staff/delivery-attempts-summaries',
      '/v1/platform/outbox/:outbox_id',
      'GET /ready and/or /health',
      'released 2026/11/01',
    ]) {
      expect(redactText(path)).toBe(path);
    }
  });

  it('replaces control characters, so a value cannot forge a second log line', () => {
    expect(redactText('a\nb\r\u0000c')).toBe('a b c');
  });

  it('caps text at the given length', () => {
    expect(capText('x'.repeat(10), 4)).toBe('xxxx…');
    expect(redactText('y'.repeat(3_000))).toHaveLength(2_001);
  });
});

describe('redactText: bounded work (adversary A-1)', () => {
  const timed = (text: string) => {
    const started = performance.now();
    const out = redactText(text);
    return { out, ms: performance.now() - started };
  };

  it.each([
    ['a', 'a'.repeat(100_000)],
    ['key characters', 'a.b-c_d'.repeat(15_000)],
    ['address characters', 'a.b%c+d'.repeat(15_000)],
    ['quoted pairs without a closing quote', 'k="'.repeat(30_000)],
    ['digits', '1'.repeat(100_000)],
  ])('redacts 100 kB of %s in under 50 ms', (_name, text) => {
    timed(text.slice(0, 1_000)); // warm the patterns
    const { ms } = timed(text);
    expect(ms).toBeLessThan(50);
  });

  it('cuts the input before redacting and drops a JWT or phone number cut in half', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
    const atEdge = (tail: string) => `${'x '.repeat((maxInputLength - 10) / 2)}${tail}`;
    expect(redactText(atEdge(jwt), 10_000)).not.toMatch(/eyJ|c2ln/);
    expect(redactText(atEdge('+966512345678'), 10_000)).not.toMatch(/9665/);
    expect(redactText('z'.repeat(10_000), 10_000)).toHaveLength(maxInputLength + 1);
  });
});

describe('isWithheldKey', () => {
  it.each([
    'authorization',
    'Cookie',
    'x-api-key',
    'apiKey',
    'recipient_phone',
    'phoneNumber',
    'email',
    'contactEmail',
    'address',
    'requestBody',
    'headers',
    'payload',
    'otp',
    'otp_code',
    'verificationCode',
    'signing_key',
    'clientSecret',
  ])('withholds %s', (key) => {
    expect(isWithheldKey(key)).toBe(true);
  });

  it.each(['status', 'code', 'status_code', 'kind', 'account_id', 'shipping_fee', 'attempts'])(
    'keeps %s',
    (key) => {
      expect(isWithheldKey(key)).toBe(false);
    },
  );
});

describe('redactValue', () => {
  it('withholds secret and personal keys at any depth and redacts every string', () => {
    const value = {
      order: { id: 'o-1', recipient: { phone: '+966512345678', name: 'Sara' } },
      headers: { authorization: 'Bearer x' },
      note: 'call +966512345678',
      list: [{ email: 'a@b.example' }, 'Bearer abc'],
      attempts: 3,
      at: new Date('2026-11-01T00:00:00Z'),
    };
    expect(redactValue(value)).toEqual({
      order: { id: 'o-1', recipient: { phone: redacted, name: 'Sara' } },
      headers: redacted,
      note: 'call [phone …5678]',
      list: [{ email: redacted }, `Bearer ${redacted}`],
      attempts: 3,
      at: '2026-11-01T00:00:00.000Z',
    });
  });

  it('describes an error by class and redacted message only', () => {
    const error = Object.assign(new TypeError('no route to +966512345678'), {
      config: { headers: { authorization: 'Bearer x' } },
    });
    expect(redactValue({ error })).toEqual({
      error: { type: 'TypeError', message: 'no route to [phone …5678]' },
    });
    expect(describeError(error)).toEqual({
      type: 'TypeError',
      message: 'no route to [phone …5678]',
    });
  });

  it('reduces bytes, maps and sets to their size (adversary A-2)', () => {
    const body = Buffer.from(`{"phone":"${'+966512345678'}"}`);
    expect(
      redactValue({
        body: 1,
        raw: body,
        view: new Uint8Array([1, 2, 3]),
        array: new ArrayBuffer(8),
        map: new Map([['phone', '+966512345678']]),
        set: new Set(['a@b.example']),
      }),
    ).toEqual({
      body: redacted,
      raw: `[bytes ${body.byteLength}]`,
      view: '[bytes 3]',
      array: '[bytes 8]',
      map: '[map 1]',
      set: '[set 1]',
    });
  });

  it('redacts keys as text: a phone number or an email used as a key (adversary A-4)', () => {
    expect(redactValue({ '+966512345678': 1, 'sara@merchant.example': 'x' })).toEqual({
      '[phone …5678]': 1,
      [maskedEmail]: 'x',
    });
  });

  it('stops at its depth, its item count and on cycles', () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < maxDepth + 2; i += 1) deep = { next: deep };
    expect(JSON.stringify(redactValue(deep))).toContain('[too_deep]');
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(redactValue(cyclic)).toEqual({ a: 1, self: '[too_deep]' });
    expect(redactValue(Array.from({ length: 80 }, (_, i) => i))).toHaveLength(maxItems);
  });

  it('drops functions, symbols and __proto__ keys; turns bigint and non-finite numbers into JSON', () => {
    const parsed = JSON.parse('{"__proto__":{"polluted":true},"n":1}') as object;
    expect(redactValue(parsed)).toEqual({ n: 1 });
    expect(redactValue({ f: () => 1, s: Symbol('x'), b: 10n, inf: Infinity })).toEqual({
      b: '10',
      inf: null,
    });
  });
});
