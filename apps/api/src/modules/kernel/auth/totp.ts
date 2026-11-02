import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// TOTP (RFC 6238 over RFC 4226 HOTP; PLAT-11 plan 2.9; research note §2): HMAC-SHA-1, a 30-second
// step from the Unix epoch, six digits, one step of tolerance either way. The verifier refuses a
// step at or below the last one accepted (RFC 6238 §5.2: a code is never accepted twice), which the
// caller stores in `core_platform_staff.totp_last_step` in the transaction that completes the
// factor. Pinned to the RFC 6238 Appendix B SHA-1 vectors in totp.test.ts; no dependency.

export const totpRules = {
  stepSeconds: 30,
  digits: 6,
  /** Steps accepted on either side of the current one (RFC 6238 §5.2 recommends one). */
  tolerance: 1,
  /** 160-bit secrets, the HMAC-SHA-1 block the RFC 4226 §4 recommends. */
  secretBytes: 20,
} as const;

/** RFC 4226 §5.3: HMAC-SHA-1 of the 8-byte big-endian counter, dynamic truncation, `digits`. */
export function hotp(secret: Buffer, counter: number, digits: number = totpRules.digits): string {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new Error('Bad HOTP counter');
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The time step of a Unix time in seconds (T0 = 0, X = 30). */
export function totpStep(unixSeconds: number): number {
  return Math.floor(unixSeconds / totpRules.stepSeconds);
}

/** The code of a Unix time. */
export function totpAt(
  secret: Buffer,
  unixSeconds: number,
  digits: number = totpRules.digits,
): string {
  return hotp(secret, totpStep(unixSeconds), digits);
}

const codePattern = /^[0-9]{6}$/;

/**
 * The step `code` belongs to within the tolerance of `unixSeconds` and above `lastStep`, or
 * undefined. Every candidate step is compared in constant time, whatever matched, so the time does
 * not tell which window a code fell in.
 */
export function matchingStep(
  secret: Buffer,
  code: string,
  unixSeconds: number,
  lastStep: number | null,
): number | undefined {
  const wellFormed = codePattern.test(code);
  const given = Buffer.from(wellFormed ? code : '000000', 'utf8');
  const current = totpStep(unixSeconds);
  let found: number | undefined;
  for (let offset = -totpRules.tolerance; offset <= totpRules.tolerance; offset += 1) {
    const step = current + offset;
    if (step < 0) continue;
    const expected = Buffer.from(hotp(secret, step), 'utf8');
    const equal = timingSafeEqual(expected, given);
    if (equal && wellFormed && found === undefined && (lastStep === null || step > lastStep)) {
      found = step;
    }
  }
  return found;
}

/** A fresh 20-byte secret. */
export function totpSecret(): Buffer {
  return randomBytes(totpRules.secretBytes);
}

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 §6 base32 without padding (the form authenticator apps take). */
export function base32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += base32Alphabet[(value << (5 - bits)) & 31];
  return out;
}

/** The inverse of `base32` (upper case, no padding); throws on any other character. */
export function fromBase32(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text) {
    const index = base32Alphabet.indexOf(char);
    if (index === -1) throw new Error('Bad base32');
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * The Key URI of an enrolment (research note §2.3): label `<issuer>:<account>`, the same issuer as
 * a parameter, SHA1, six digits, 30 seconds, so every authenticator shows and computes the same.
 */
export function otpauthUri(input: { issuer: string; account: string; secret: Buffer }): string {
  const issuer = encodeURIComponent(input.issuer);
  const label = `${issuer}:${encodeURIComponent(input.account)}`;
  return (
    `otpauth://totp/${label}?secret=${base32(input.secret)}&issuer=${issuer}` +
    `&algorithm=SHA1&digits=${totpRules.digits}&period=${totpRules.stepSeconds}`
  );
}
