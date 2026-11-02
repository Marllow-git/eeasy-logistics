import { argon2Sync, randomBytes } from 'node:crypto';
import { argon2Parameters, type Argon2id } from '../src/platform/argon2';
import { secretKeys } from '../src/platform/secure-store';
import { maxLocalFailures, PinVerifier } from '../src/sync/pin-verifier';
import { memorySecrets } from './helpers';

// The device verifier of ADR-0034 (DRV-1 plan 2.6, 2.11): armed from an accepted PIN, Argon2id with
// the ADR's parameters, five local failures lock, a server lock or sign-out wipes it, and it never
// sits anywhere but the secure store. Node's `crypto.argon2Sync` has the signature the native module
// copies, so the same call runs here.

jest.mock('react-native-quick-crypto', () => ({}));

const nodeArgon2id: Argon2id = (secret, salt) =>
  Promise.resolve(
    new Uint8Array(argon2Sync('argon2id', { message: secret, nonce: salt, ...argon2Parameters })),
  );

function verifier() {
  const secrets = memorySecrets();
  const calls: Uint8Array[] = [];
  const subject = new PinVerifier({
    secrets,
    argon2id: async (secret, salt) => {
      calls.push(salt);
      return nodeArgon2id(secret, salt);
    },
    randomBytes: (length) => new Uint8Array(randomBytes(length)),
  });
  return { secrets, subject, calls };
}

describe('PIN verifier', () => {
  it('uses the ADR-0034 parameters: Argon2id, 19 MiB, 2 passes, a 16-byte salt', async () => {
    expect(argon2Parameters).toEqual({ memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 });
    const { subject, calls, secrets } = verifier();
    await subject.arm('4821');
    expect(calls[0]).toHaveLength(16);
    const stored = JSON.parse(secrets.values.get(secretKeys.pinVerifier)!) as Record<
      string,
      unknown
    >;
    expect(Object.keys(stored).sort()).toEqual(['failures', 'hash', 'salt', 'v']);
    expect(JSON.stringify(stored)).not.toContain('4821');
  });

  it('is unarmed until a server-accepted PIN arms it, then matches only that PIN', async () => {
    const { subject } = verifier();
    expect(await subject.check('4821')).toBe('unarmed');
    await subject.arm('4821');
    expect(await subject.isArmed()).toBe(true);
    expect(await subject.check('4821')).toBe('match');
    expect(await subject.check('4822')).toBe('mismatch');
  });

  it('salts every arming afresh', async () => {
    const { subject, secrets } = verifier();
    await subject.arm('4821');
    const first = secrets.values.get(secretKeys.pinVerifier);
    await subject.arm('4821');
    expect(secrets.values.get(secretKeys.pinVerifier)).not.toBe(first);
  });

  it('locks after five consecutive local failures, even for the right PIN', async () => {
    const { subject } = verifier();
    await subject.arm('4821');
    const results = [];
    for (let attempt = 0; attempt < maxLocalFailures; attempt += 1) {
      results.push(await subject.check('0000'));
    }
    expect(results).toEqual(['mismatch', 'mismatch', 'mismatch', 'mismatch', 'locked']);
    expect(await subject.isLocked()).toBe(true);
    expect(await subject.check('4821')).toBe('locked');
  });

  it('resets the count on a match, and an online re-arm clears a lock', async () => {
    const { subject } = verifier();
    await subject.arm('4821');
    for (let attempt = 0; attempt < maxLocalFailures - 1; attempt += 1) await subject.check('0000');
    expect(await subject.check('4821')).toBe('match');
    for (let attempt = 0; attempt < maxLocalFailures - 1; attempt += 1) {
      expect(await subject.check('0000')).toBe('mismatch');
    }
    expect(await subject.check('0000')).toBe('locked');
    await subject.arm('4821'); // after driverVerifyCashPin succeeded online
    expect(await subject.check('4821')).toBe('match');
  });

  it('is wiped on a server lock or sign-out', async () => {
    const { subject, secrets } = verifier();
    await subject.arm('4821');
    await subject.wipe();
    expect(secrets.values.has(secretKeys.pinVerifier)).toBe(false);
    expect(await subject.check('4821')).toBe('unarmed');
  });
  // "Never in SQLite" is structural: rule driver-pin-never-in-sqlite in .dependency-cruiser.cjs.
});
