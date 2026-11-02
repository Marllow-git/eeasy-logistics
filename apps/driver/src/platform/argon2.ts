import { argon2 } from 'react-native-quick-crypto';

// The native Argon2 of ADR-0034 (DRV-1 plan 2.6): react-native-quick-crypto's `argon2`, OpenSSL's
// implementation behind a Nitro module, with Node's `crypto.argon2` signature (so tests run the same
// call on Node). Parameters: Argon2id, 19 MiB, 2 passes, parallelism 1, 32-byte tag.
export const argon2Parameters = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 };

export type Argon2id = (secret: string, salt: Uint8Array) => Promise<Uint8Array>;

export const argon2id: Argon2id = (secret, salt) =>
  new Promise((resolve, reject) => {
    argon2('argon2id', { message: secret, nonce: salt, ...argon2Parameters }, (error, result) => {
      if (error) reject(error);
      else resolve(new Uint8Array(result));
    });
  });
