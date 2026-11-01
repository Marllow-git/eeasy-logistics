import { describe, expect, it } from 'vitest';
import {
  base32,
  fromBase32,
  hotp,
  matchingStep,
  otpauthUri,
  totpAt,
  totpSecret,
  totpStep,
} from './totp.js';

// RFC 6238 Appendix B (SHA-1 column, ASCII seed "12345678901234567890", X = 30, T0 = 0) and the
// six-digit forms of the research note §2.2; RFC 4226 Appendix D for HOTP; RFC 4648 §10 for base32.

const rfcSecret = Buffer.from('12345678901234567890', 'ascii');

describe('TOTP (RFC 6238)', () => {
  it.each([
    [59, '94287082', '287082'],
    [1111111109, '07081804', '081804'],
    [1111111111, '14050471', '050471'],
    [1234567890, '89005924', '005924'],
    [2000000000, '69279037', '279037'],
    [20000000000, '65353130', '353130'],
  ])('matches Appendix B at T=%i', (time, eight, six) => {
    expect(totpAt(rfcSecret, time, 8)).toBe(eight);
    expect(totpAt(rfcSecret, time)).toBe(six);
  });

  it('matches the RFC 4226 Appendix D HOTP values', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676'];
    expected.forEach((code, counter) => expect(hotp(rfcSecret, counter)).toBe(code));
  });

  it('accepts one step either side and nothing further', () => {
    const now = 1111111111;
    const step = totpStep(now);
    expect(matchingStep(rfcSecret, totpAt(rfcSecret, now), now, null)).toBe(step);
    expect(matchingStep(rfcSecret, totpAt(rfcSecret, now - 30), now, null)).toBe(step - 1);
    expect(matchingStep(rfcSecret, totpAt(rfcSecret, now + 30), now, null)).toBe(step + 1);
    expect(matchingStep(rfcSecret, totpAt(rfcSecret, now - 60), now, null)).toBeUndefined();
    expect(matchingStep(rfcSecret, totpAt(rfcSecret, now + 60), now, null)).toBeUndefined();
  });

  it('refuses a step at or below the last accepted one (replay)', () => {
    const now = 1234567890;
    const step = totpStep(now);
    const code = totpAt(rfcSecret, now);
    expect(matchingStep(rfcSecret, code, now, step)).toBeUndefined();
    expect(matchingStep(rfcSecret, code, now, step + 1)).toBeUndefined();
    expect(matchingStep(rfcSecret, code, now, step - 1)).toBe(step);
    // The previous window's code after the current one was used: refused too.
    expect(matchingStep(rfcSecret, totpAt(rfcSecret, now - 30), now, step)).toBeUndefined();
  });

  it('refuses malformed codes without throwing', () => {
    for (const code of ['', '12345', '1234567', 'abcdef', '28708２']) {
      expect(matchingStep(rfcSecret, code, 59, null)).toBeUndefined();
    }
  });

  it('encodes base32 per RFC 4648 (no padding) and back', () => {
    const vectors: [string, string][] = [
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ];
    for (const [plain, encoded] of vectors) {
      expect(base32(Buffer.from(plain))).toBe(encoded);
      expect(fromBase32(encoded).toString()).toBe(plain);
    }
    const secret = totpSecret();
    expect(secret).toHaveLength(20);
    expect(base32(secret)).toHaveLength(32);
    expect(fromBase32(base32(secret)).equals(secret)).toBe(true);
    expect(() => fromBase32('abc')).toThrow();
  });

  it('builds the otpauth URI of the research note', () => {
    const uri = otpauthUri({
      issuer: 'eeasy-logistics',
      account: 'admin@example.test',
      secret: rfcSecret,
    });
    expect(uri).toBe(
      'otpauth://totp/eeasy-logistics:admin%40example.test' +
        '?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=eeasy-logistics' +
        '&algorithm=SHA1&digits=6&period=30',
    );
  });
});
