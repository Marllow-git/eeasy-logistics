import { describe, expect, it } from 'vitest';
import {
  createCredentialsCipher,
  CredentialsError,
  defineConfig,
  Secret,
  type CredentialsErrorCode,
} from '../src/index.ts';
import { fakeKey } from './fixtures.ts';

// Fake plaintext; tests compare it, never print it.
const plaintext = '{"access_token":"fake-channel-token","refresh_token":"fake-refresh"}';

function cipherWith(activeKeyId: string, ...ids: string[]) {
  const keys: Record<string, Secret> = {};
  ids.forEach((id, index) => (keys[id] = new Secret(fakeKey(index + 1))));
  return createCredentialsCipher({ keys, activeKeyId });
}

function failure(run: () => unknown): CredentialsErrorCode {
  try {
    run();
  } catch (error) {
    if (error instanceof CredentialsError) {
      expect(error.message).not.toContain('fake-channel-token');
      return error.code;
    }
    throw error;
  }
  throw new Error('expected a CredentialsError');
}

describe('credentials encryption (plan 2.4)', () => {
  it('round trip: encrypts under the active key and decrypts to the same text', () => {
    const cipher = cipherWith('k2', 'k1', 'k2');
    const encrypted = cipher.encrypt(plaintext);
    expect(encrypted.keyId).toBe('k2');
    expect(encrypted.blob.includes(Buffer.from('fake-channel-token'))).toBe(false);
    expect(cipher.decrypt(encrypted.blob)).toBe(plaintext);
    // A fresh nonce each time: the same plaintext never gives the same blob.
    expect(cipher.encrypt(plaintext).blob.equals(encrypted.blob)).toBe(false);
  });

  it('unknown key id: a blob whose key is not configured fails with a typed error', () => {
    const old = cipherWith('k1', 'k1').encrypt(plaintext);
    const withoutK1 = createCredentialsCipher({
      keys: { k2: new Secret(fakeKey(2)) },
      activeKeyId: 'k2',
    });
    expect(failure(() => withoutK1.decrypt(old.blob))).toBe('unknown_key_id');
  });

  it('tampered data: a changed tag, ciphertext, key id or context fails authentication', () => {
    const cipher = cipherWith('k1', 'k1', 'k2');
    const { blob } = cipher.encrypt(plaintext, 'core_channel_connections:1');
    const headerLength = 2 + 'k1'.length;
    const flip = (offset: number) => {
      const copy = Buffer.from(blob);
      copy[offset] = (copy[offset] ?? 0) ^ 0x01;
      return copy;
    };
    const tagOffset = headerLength + 12;
    expect(failure(() => cipher.decrypt(flip(tagOffset), 'core_channel_connections:1'))).toBe(
      'authentication_failed',
    );
    expect(failure(() => cipher.decrypt(flip(blob.length - 1), 'core_channel_connections:1'))).toBe(
      'authentication_failed',
    );
    // Relabel the blob as encrypted under k2 (same id length): the header is authenticated.
    const relabelled = Buffer.from(blob);
    relabelled.write('k2', 2, 'utf8');
    expect(failure(() => cipher.decrypt(relabelled, 'core_channel_connections:1'))).toBe(
      'authentication_failed',
    );
    // The same blob moved to another row.
    expect(failure(() => cipher.decrypt(blob, 'core_channel_connections:2'))).toBe(
      'authentication_failed',
    );
    expect(failure(() => cipher.decrypt(blob.subarray(0, 20)))).toBe('malformed');
  });

  it('rotation: re-encrypts an old blob under the active key; the old key can then retire', () => {
    const before = cipherWith('k1', 'k1').encrypt(plaintext, 'ctx');
    const duringRotation = cipherWith('k2', 'k1', 'k2');
    const rotated = duringRotation.rotate(before.blob, 'ctx');
    expect(rotated.keyId).toBe('k2');
    const afterRetirement = createCredentialsCipher({
      keys: { k2: new Secret(fakeKey(2)) },
      activeKeyId: 'k2',
    });
    expect(afterRetirement.decrypt(rotated.blob, 'ctx')).toBe(plaintext);
    expect(failure(() => afterRetirement.decrypt(before.blob, 'ctx'))).toBe('unknown_key_id');
  });

  it('works from the parsed configuration, including an unusual key id such as __proto__', () => {
    const config = defineConfig({
      APP_ENV: 'local',
      CREDENTIALS_KEYS: `__proto__:${fakeKey(1)},k2:${fakeKey(2)}`,
      CREDENTIALS_ACTIVE_KEY_ID: '__proto__',
    });
    if (config.credentials === null) throw new Error('expected credentials');
    expect(Object.keys(config.credentials.keys)).toEqual(['__proto__', 'k2']);
    const cipher = createCredentialsCipher(config.credentials);
    const { keyId, blob } = cipher.encrypt(plaintext);
    expect(keyId).toBe('__proto__');
    expect(cipher.decrypt(blob)).toBe(plaintext);
  });

  it('refuses an active key id that is not among the keys', () => {
    expect(failure(() => cipherWith('k9', 'k1'))).toBe('unknown_key_id');
  });
});
