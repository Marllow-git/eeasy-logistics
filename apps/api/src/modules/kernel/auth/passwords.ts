import { argon2, argon2Sync, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Passwords (PLAT-11 plan 2.2; identity and tenancy §3.1; data §10; research note
// auth-libraries-2026-11 §1). Argon2id through Node's built-in `crypto.argon2` (Node 24.7+), with
// the OWASP parameters, stored as a PHC string this file encodes and parses itself. The rules:
// 12 to 256 characters, no composition rule, and not on the bundled breached list.

/** The cost of a new hash (OWASP: m=19 MiB, t=2, p=1). A stored hash keeps its own parameters. */
export const argon2Parameters = { memory: 19_456, passes: 2, parallelism: 1 } as const;
const saltLength = 16;
const tagLength = 32;

export const passwordRules = { minLength: 12, maxLength: 256 } as const;

/** Why a password cannot be set, as `details.fields` reports it, or undefined. */
export type PasswordProblem = 'too_short' | 'too_long' | 'breached';

interface Phc {
  readonly memory: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

const phcPattern =
  /^\$argon2id\$v=19\$m=([1-9][0-9]{0,6}),t=([1-9][0-9]?),p=([1-9][0-9]?)\$([A-Za-z0-9+/]{11,64})\$([A-Za-z0-9+/]{22,128})$/;

/** Bounds on the parameters of a stored hash, so a planted string cannot cost a minute of CPU. */
const bounds = { memory: [8, 262_144], passes: [1, 10], parallelism: [1, 8] } as const;

/** The PHC string of an Argon2id hash (standard base64 without padding, as the PHC format says). */
export function encodePhc(phc: Phc): string {
  const b64 = (value: Buffer) => value.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=${phc.memory},t=${phc.passes},p=${phc.parallelism}$${b64(phc.salt)}$${b64(phc.hash)}`;
}

/** The parts of a PHC Argon2id string, or undefined when it is not one this file accepts. */
export function parsePhc(value: string): Phc | undefined {
  const match = phcPattern.exec(value);
  if (match === null) return undefined;
  const [, m, t, p, salt, hash] = match;
  const memory = Number(m);
  const passes = Number(t);
  const parallelism = Number(p);
  const within = (n: number, [low, high]: readonly [number, number]) => n >= low && n <= high;
  if (
    !within(memory, bounds.memory) ||
    !within(passes, bounds.passes) ||
    !within(parallelism, bounds.parallelism) ||
    memory < 8 * parallelism
  ) {
    return undefined;
  }
  return {
    memory,
    passes,
    parallelism,
    salt: Buffer.from(salt ?? '', 'base64'),
    hash: Buffer.from(hash ?? '', 'base64'),
  };
}

function derive(password: string, phc: Omit<Phc, 'hash'>, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: Buffer.from(password, 'utf8'),
        nonce: phc.salt,
        parallelism: phc.parallelism,
        tagLength: length,
        memory: phc.memory,
        passes: phc.passes,
      },
      (error, key) => (error === null ? resolve(key) : reject(error)),
    );
  });
}

export interface PasswordCheck {
  readonly ok: boolean;
  /** The stored hash was made with other parameters than today's: hash again after sign-in. */
  readonly needsRehash: boolean;
}

/**
 * Hashes and verifies passwords. `dummyHash` is a hash of a random password made at construction
 * with today's parameters: sign-in verifies against it when the email is unknown, the user is
 * disabled or has no password yet, so every answer costs one verification (identity and tenancy §8).
 */
export class PasswordHasher {
  readonly dummyHash: string;

  constructor() {
    const salt = randomBytes(saltLength);
    const hash = argon2Sync('argon2id', {
      message: randomBytes(32),
      nonce: salt,
      parallelism: argon2Parameters.parallelism,
      tagLength,
      memory: argon2Parameters.memory,
      passes: argon2Parameters.passes,
    });
    this.dummyHash = encodePhc({ ...argon2Parameters, salt, hash });
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(saltLength);
    const hash = await derive(password, { ...argon2Parameters, salt }, tagLength);
    return encodePhc({ ...argon2Parameters, salt, hash });
  }

  /**
   * Whether `password` matches `stored`, compared in constant time. A stored value that is not a
   * PHC Argon2id string this file accepts is verified as the dummy (same cost) and never matches.
   */
  async verify(password: string, stored: string): Promise<PasswordCheck> {
    const parsed = parsePhc(stored);
    const phc = parsed ?? parsePhc(this.dummyHash);
    if (phc === undefined) throw new Error('The dummy hash does not parse');
    const derived = await derive(password, phc, phc.hash.length);
    const ok = parsed !== undefined && timingSafeEqual(derived, phc.hash);
    const needsRehash =
      ok &&
      (phc.memory !== argon2Parameters.memory ||
        phc.passes !== argon2Parameters.passes ||
        phc.parallelism !== argon2Parameters.parallelism ||
        phc.hash.length !== tagLength);
    return { ok, needsRehash };
  }
}

/**
 * The bundled breached-password list (`apps/api/resources/breached-passwords.sha1`, README there):
 * sorted 20-byte SHA-1 digests, binary-searched in memory. Read once; a missing or malformed file
 * stops the boot rather than letting every password through.
 */
export class BreachedPasswords {
  readonly #digests: Buffer;

  constructor(digests: Buffer) {
    if (digests.length === 0 || digests.length % 20 !== 0) {
      throw new Error('The breached-password list is empty or not a list of SHA-1 digests');
    }
    for (let at = 20; at < digests.length; at += 20) {
      if (Buffer.compare(digests.subarray(at - 20, at), digests.subarray(at, at + 20)) >= 0) {
        throw new Error('The breached-password list is not sorted');
      }
    }
    this.#digests = digests;
  }

  /** The list shipped with the API (resolved from this file, so `src/` and `dist/` both find it). */
  static bundled(): BreachedPasswords {
    return new BreachedPasswords(
      readFileSync(new URL('../../../../resources/breached-passwords.sha1', import.meta.url)),
    );
  }

  get size(): number {
    return this.#digests.length / 20;
  }

  has(password: string): boolean {
    const digest = createHash('sha1').update(password, 'utf8').digest();
    let low = 0;
    let high = this.size - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const at = middle * 20;
      const order = Buffer.compare(this.#digests.subarray(at, at + 20), digest);
      if (order === 0) return true;
      if (order < 0) low = middle + 1;
      else high = middle - 1;
    }
    return false;
  }
}

/** The first rule `password` breaks, or undefined (lengths in Unicode code points). */
export function passwordProblem(
  password: string,
  breached: Pick<BreachedPasswords, 'has'>,
): PasswordProblem | undefined {
  const length = Array.from(password).length;
  if (length < passwordRules.minLength) return 'too_short';
  if (length > passwordRules.maxLength) return 'too_long';
  if (breached.has(password)) return 'breached';
  return undefined;
}
