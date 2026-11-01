import { createHmac, hkdfSync, randomInt, timingSafeEqual } from 'node:crypto';

// OTP codes (identity and tenancy §3.2; data §10; PLAT-9 plan 2.4): six digits from the CSPRNG,
// never stored readable. The challenge row keeps HMAC-SHA256(key, "<challenge id>:<code>") under a
// key derived from the credentials key (HKDF-SHA256, info `elx-otp`), so a hash is bound to its row
// and cannot be brute-forced offline without the server key. Verification compares in constant time
// against every configured credentials key, so a key rotation inside the five-minute window does
// not invalidate a code already sent.

export const otpCodeLength = 6;

/** Six decimal digits, uniformly from `crypto.randomInt`, leading zeros kept. */
export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** otpCodeLength)).padStart(otpCodeLength, '0');
}

/** HKDF-SHA256 of one credentials key (base64 key material), info `elx-otp`. */
export function otpHmacKey(base64Material: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(base64Material, 'base64'), Buffer.alloc(0), 'elx-otp', 32),
  );
}

function hmac(key: Buffer, label: string, value: string): Buffer {
  return createHmac('sha256', key).update(`${label}:${value}`).digest();
}

export class OtpHasher {
  readonly #active: Buffer;
  readonly #all: readonly Buffer[];

  /** `active` hashes new codes; `all` (active included) are tried on verification. */
  constructor(active: Buffer, all: readonly Buffer[]) {
    this.#active = active;
    this.#all = all.includes(active) ? all : [active, ...all];
  }

  /** The stored `code_hash` of a challenge. */
  hash(challengeId: string, code: string): Buffer {
    return hmac(this.#active, challengeId, code);
  }

  /**
   * Whether `code` is the challenge's code: every key is tried and every comparison runs, so the
   * time taken does not depend on which key, if any, matched.
   */
  matches(challengeId: string, code: string, stored: Uint8Array): boolean {
    const expected = Buffer.from(stored);
    let found = false;
    for (const key of this.#all) {
      const candidate = hmac(key, challengeId, code);
      const equal =
        candidate.length === expected.length ? timingSafeEqual(candidate, expected) : false;
      found = found || equal;
    }
    return found;
  }

  /**
   * A stable pseudonym of a phone for rate-limit keys in Redis, so the counters hold no phone
   * number (integrations §11 PII minimisation).
   */
  phoneRef(phone: string): string {
    return hmac(this.#active, 'phone', phone).subarray(0, 16).toString('hex');
  }
}
