import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { keyIdPattern } from './formats.ts';
import type { Secret } from './secret.ts';

// Per-account credentials at rest (plan 2.4, data §10, integrations §11): AES-256-GCM, a random
// 12-byte nonce per encryption, and the key id stored with the ciphertext so rotation never makes a
// stored credential unreadable.
//
// Blob layout (one `bytea`):
//   version (1 byte, = 1) | key id length (1 byte) | key id (UTF-8) | nonce (12) | tag (16) | ciphertext
// The header (version, length, key id) is authenticated as additional data, so changing the key id
// in a blob fails decryption. A required `context`, `<table>:<row id>` (for example
// `core_channel_connections:01J…`), is authenticated too: a blob copied to another row or table then
// fails to decrypt.

const formatVersion = 1;
const nonceBytes = 12;
const tagBytes = 16;
const keyBytes = 32;

export interface EncryptedCredential {
  /** The id of the key that encrypted it; store it in the row's `*_key_id` column. */
  readonly keyId: string;
  /** Header, nonce, tag and ciphertext in one buffer, ready for a `bytea` column. */
  readonly blob: Buffer;
}

export type CredentialsErrorCode =
  /** The blob names a key id this process does not hold (retired, or never configured). */
  | 'unknown_key_id'
  /** The blob is not in the format above (truncated, wrong version, bad key id). */
  | 'malformed'
  /** The tag did not verify: the blob, the key id or the context was altered, or the key is wrong. */
  | 'authentication_failed'
  /** The context is missing or not of the form `<table>:<row id>`. */
  | 'invalid_context';

/** A typed failure. Its message never contains plaintext, key material or ciphertext. */
export class CredentialsError extends Error {
  readonly code: CredentialsErrorCode;

  constructor(code: CredentialsErrorCode, message: string) {
    super(message);
    this.name = 'CredentialsError';
    this.code = code;
  }
}

export interface CredentialsKeys {
  /** Key id to base64 key of 32 bytes, as `Config['credentials']` holds them. */
  readonly keys: Readonly<Record<string, Secret>>;
  readonly activeKeyId: string;
}

export interface CredentialsCipher {
  readonly activeKeyId: string;
  /** Encrypts under the active key with a fresh random nonce. */
  encrypt(plaintext: string, context: string): EncryptedCredential;
  /** Picks the key by the id in the blob; throws `CredentialsError` on any failure. */
  decrypt(blob: Uint8Array, context: string): string;
  /** Decrypts with whichever key the blob names and re-encrypts under the active key. */
  rotate(blob: Uint8Array, context: string): EncryptedCredential;
}

export function createCredentialsCipher(credentials: CredentialsKeys): CredentialsCipher {
  const keys = new Map<string, Buffer>();
  for (const id of Object.keys(credentials.keys)) {
    const material = credentials.keys[id];
    const key = material === undefined ? undefined : Buffer.from(material.reveal(), 'base64');
    if (!keyIdPattern.test(id) || key?.length !== keyBytes) {
      throw new CredentialsError(
        'malformed',
        'Every credentials key needs a valid id and 32 bytes',
      );
    }
    keys.set(id, key);
  }
  const activeKeyId = credentials.activeKeyId;
  const configuredActiveKey = keys.get(activeKeyId);
  if (configuredActiveKey === undefined) {
    throw new CredentialsError('unknown_key_id', 'The active credentials key id is not configured');
  }
  const activeKey: Buffer = configuredActiveKey;

  function encrypt(plaintext: string, context: string): EncryptedCredential {
    checkContext(context);
    const header = encodeHeader(activeKeyId);
    const nonce = randomBytes(nonceBytes);
    const cipher = createCipheriv('aes-256-gcm', activeKey, nonce, {
      authTagLength: tagBytes,
    });
    cipher.setAAD(additionalData(header, context));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const blob = Buffer.concat([header, nonce, cipher.getAuthTag(), ciphertext]);
    return { keyId: activeKeyId, blob };
  }

  function decrypt(blob: Uint8Array, context: string): string {
    checkContext(context);
    const { header, keyId, nonce, tag, ciphertext } = parseBlob(Buffer.from(blob));
    const key = keys.get(keyId);
    if (key === undefined) {
      throw new CredentialsError(
        'unknown_key_id',
        'The credential names a key id that is not configured',
      );
    }
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: tagBytes });
    decipher.setAAD(additionalData(header, context));
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new CredentialsError('authentication_failed', 'The credential failed authentication');
    }
  }

  return {
    activeKeyId,
    encrypt,
    decrypt,
    rotate: (blob, context) => encrypt(decrypt(blob, context), context),
  };
}

function encodeHeader(keyId: string): Buffer {
  const id = Buffer.from(keyId, 'utf8');
  return Buffer.concat([Buffer.from([formatVersion, id.length]), id]);
}

/** `<table>:<row id>`: a lower-case table name, a colon, and a row id without spaces. */
const contextPattern = /^[a-z][a-z0-9_]*:\S+$/;

function checkContext(context: unknown): void {
  if (typeof context !== 'string' || !contextPattern.test(context)) {
    throw new CredentialsError(
      'invalid_context',
      'A context of the form <table>:<row id> is required',
    );
  }
}

function additionalData(header: Buffer, context: string): Buffer {
  return Buffer.concat([header, Buffer.from(context, 'utf8')]);
}

function parseBlob(blob: Buffer) {
  const malformed = () => new CredentialsError('malformed', 'The credential blob is malformed');
  if (blob.length < 2 || blob[0] !== formatVersion) throw malformed();
  const idLength = blob[1] ?? 0;
  const headerLength = 2 + idLength;
  if (blob.length < headerLength + nonceBytes + tagBytes) throw malformed();
  const keyId = blob.subarray(2, headerLength).toString('utf8');
  if (!keyIdPattern.test(keyId)) throw malformed();
  const nonceEnd = headerLength + nonceBytes;
  return {
    header: blob.subarray(0, headerLength),
    keyId,
    nonce: blob.subarray(headerLength, nonceEnd),
    tag: blob.subarray(nonceEnd, nonceEnd + tagBytes),
    ciphertext: blob.subarray(nonceEnd + tagBytes),
  };
}
