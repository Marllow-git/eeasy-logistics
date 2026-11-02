import type { Argon2id } from '../platform/argon2';
import { secretKeys, type SecretStore } from '../platform/secure-store';

// The device-held cash PIN verifier (ADR-0034, driver app §5.3, DRV-1 plan 2.6). Armed only from a
// PIN the server has just accepted; Argon2id with a random 16-byte salt; kept in the secure store
// with its failure counter, never in SQLite, logs or analytics. Five consecutive local failures lock
// cash recording on this phone until an online PIN check succeeds and re-arms it. Wiped on sign-out,
// device revocation, a server lock (`423 cash_pin_locked`) and a PIN change seen from elsewhere.
// DRV-2 and DRV-4 call `check` before a cash collection is written to the outbox.

export const maxLocalFailures = 5;
const saltBytes = 16;

export type PinCheck = 'match' | 'mismatch' | 'locked' | 'unarmed';

interface StoredVerifier {
  readonly v: 1;
  readonly salt: string;
  readonly hash: string;
  readonly failures: number;
}

export interface PinVerifierDeps {
  readonly secrets: SecretStore;
  readonly argon2id: Argon2id;
  readonly randomBytes: (length: number) => Uint8Array;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** Compares in time independent of where the first difference is. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index]! ^ b[index]!;
  return difference === 0;
}

function parse(raw: string | null): StoredVerifier | undefined {
  if (raw === null) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<StoredVerifier>;
    if (
      value.v === 1 &&
      typeof value.salt === 'string' &&
      typeof value.hash === 'string' &&
      typeof value.failures === 'number'
    ) {
      return value as StoredVerifier;
    }
  } catch {
    // A damaged entry counts as no verifier; the next online check re-arms it.
  }
  return undefined;
}

export class PinVerifier {
  constructor(private readonly deps: PinVerifierDeps) {}

  /** Computes and stores a fresh verifier from a PIN the server has just accepted; clears the lock. */
  async arm(pin: string): Promise<void> {
    const salt = this.deps.randomBytes(saltBytes);
    const hash = await this.deps.argon2id(pin, salt);
    await this.write({ v: 1, salt: toHex(salt), hash: toHex(hash), failures: 0 });
  }

  async isArmed(): Promise<boolean> {
    return (await this.read()) !== undefined;
  }

  async isLocked(): Promise<boolean> {
    const stored = await this.read();
    return stored !== undefined && stored.failures >= maxLocalFailures;
  }

  /** Checks a PIN offline; a mismatch counts toward the local lock, a match resets the count. */
  async check(pin: string): Promise<PinCheck> {
    const stored = await this.read();
    if (stored === undefined) return 'unarmed';
    if (stored.failures >= maxLocalFailures) return 'locked';
    const hash = await this.deps.argon2id(pin, fromHex(stored.salt));
    if (sameBytes(hash, fromHex(stored.hash))) {
      if (stored.failures !== 0) await this.write({ ...stored, failures: 0 });
      return 'match';
    }
    const failures = stored.failures + 1;
    await this.write({ ...stored, failures });
    return failures >= maxLocalFailures ? 'locked' : 'mismatch';
  }

  async wipe(): Promise<void> {
    await this.deps.secrets.delete(secretKeys.pinVerifier);
  }

  private async read(): Promise<StoredVerifier | undefined> {
    return parse(await this.deps.secrets.get(secretKeys.pinVerifier));
  }

  private write(value: StoredVerifier): Promise<void> {
    return this.deps.secrets.set(secretKeys.pinVerifier, JSON.stringify(value));
  }
}
