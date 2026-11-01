import { createCredentialsCipher, Secret } from '@eeasy-logistics/config';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OtpHasher, generateOtpCode, otpHmacKey } from './otp-code.js';

// PLAT-9 plan 2.4, 2.11: six-digit codes, HMAC hashes bound to the challenge, constant-time
// verification across keys, and the code's encryption round trip under the row context.

const material = () => randomBytes(32).toString('base64');
const challengeId = '019a0000-0000-7000-8000-000000000001';

describe('generateOtpCode', () => {
  it('gives six digits, leading zeros kept, from the whole range', () => {
    const codes = Array.from({ length: 2000 }, generateOtpCode);
    for (const code of codes) expect(code).toMatch(/^[0-9]{6}$/);
    expect(new Set(codes).size).toBeGreaterThan(1900);
    expect(codes.some((code) => code.startsWith('0'))).toBe(true);
  });
});

describe('OtpHasher', () => {
  const k1 = otpHmacKey(material());
  const k2 = otpHmacKey(material());

  it('derives a 32-byte key per credentials key, different from the material', () => {
    const raw = material();
    const key = otpHmacKey(raw);
    expect(key).toHaveLength(32);
    expect(key.equals(Buffer.from(raw, 'base64'))).toBe(false);
    expect(otpHmacKey(raw).equals(key)).toBe(true);
  });

  it('stores a hash that is neither the code nor reusable on another challenge', () => {
    const hasher = new OtpHasher(k1, [k1]);
    const hash = hasher.hash(challengeId, '123456');
    expect(hash).toHaveLength(32);
    expect(hash.toString('utf8')).not.toContain('123456');
    expect(hasher.matches(challengeId, '123456', hash)).toBe(true);
    expect(hasher.matches(challengeId, '123457', hash)).toBe(false);
    expect(hasher.matches('019a0000-0000-7000-8000-000000000002', '123456', hash)).toBe(false);
  });

  it('verifies a code hashed under a retired key while it is still configured', () => {
    const before = new OtpHasher(k1, [k1]).hash(challengeId, '654321');
    const after = new OtpHasher(k2, [k1, k2]);
    expect(after.matches(challengeId, '654321', before)).toBe(true);
    expect(new OtpHasher(k2, [k2]).matches(challengeId, '654321', before)).toBe(false);
  });

  it('refuses a stored hash of another length without throwing', () => {
    expect(new OtpHasher(k1, [k1]).matches(challengeId, '123456', Buffer.alloc(3))).toBe(false);
  });

  it('pseudonymises a phone for rate-limit keys', () => {
    const hasher = new OtpHasher(k1, [k1]);
    const ref = hasher.phoneRef('+966551234567');
    expect(ref).toMatch(/^[0-9a-f]{32}$/);
    expect(ref).not.toContain('551234567');
    expect(hasher.phoneRef('+966551234567')).toBe(ref);
    expect(hasher.phoneRef('+966551234568')).not.toBe(ref);
  });
});

describe('the code on the outbox row (data §10)', () => {
  const cipher = createCredentialsCipher({
    keys: { k1: new Secret(material()) },
    activeKeyId: 'k1',
  });

  it('round-trips under the challenge context and fails under any other', () => {
    const { blob } = cipher.encrypt('482913', `core_otp_challenges:${challengeId}`);
    expect(blob.toString('base64')).not.toContain('482913');
    expect(blob.includes(Buffer.from('482913'))).toBe(false);
    expect(cipher.decrypt(blob, `core_otp_challenges:${challengeId}`)).toBe('482913');
    expect(() =>
      cipher.decrypt(blob, 'core_otp_challenges:019a0000-0000-7000-8000-000000000002'),
    ).toThrow();
  });
});
