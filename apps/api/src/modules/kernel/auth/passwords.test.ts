import { argon2, createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BreachedPasswords,
  PasswordHasher,
  argon2Parameters,
  encodePhc,
  parsePhc,
  passwordProblem,
} from './passwords.js';

// PLAT-11 plan 2.2, 2.16: Argon2id through Node's built-in, the PHC encoding, the rules and the
// bundled breached list.

const hasher = new PasswordHasher();

describe('crypto.argon2 (the primitive)', () => {
  it('matches the RFC 9106 §5.3 Argon2id test vector', async () => {
    const tag = await new Promise<Buffer>((resolve, reject) =>
      argon2(
        'argon2id',
        {
          message: Buffer.alloc(32, 0x01),
          nonce: Buffer.alloc(16, 0x02),
          secret: Buffer.alloc(8, 0x03),
          associatedData: Buffer.alloc(12, 0x04),
          parallelism: 4,
          tagLength: 32,
          memory: 32,
          passes: 3,
        },
        (error, key) => (error === null ? resolve(key) : reject(error)),
      ),
    );
    expect(tag.toString('hex')).toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
    );
  });
});

describe('PasswordHasher', () => {
  it('stores a PHC string with the OWASP parameters and verifies it', async () => {
    const stored = await hasher.hash('correct horse battery staple');
    expect(stored).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
    expect(await hasher.verify('correct horse battery staple', stored)).toEqual({
      ok: true,
      needsRehash: false,
    });
    expect((await hasher.verify('correct horse battery stapl', stored)).ok).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hasher.hash('the same password')).not.toBe(await hasher.hash('the same password'));
  });

  it('reads the parameters back from the string, and asks for a rehash when they are old', async () => {
    const salt = randomBytes(16);
    const hash = await new Promise<Buffer>((resolve, reject) =>
      argon2(
        'argon2id',
        {
          message: Buffer.from('an older password'),
          nonce: salt,
          parallelism: 1,
          tagLength: 32,
          memory: 8192,
          passes: 3,
        },
        (error, key) => (error === null ? resolve(key) : reject(error)),
      ),
    );
    const older = encodePhc({ memory: 8192, passes: 3, parallelism: 1, salt, hash });
    expect(await hasher.verify('an older password', older)).toEqual({
      ok: true,
      needsRehash: true,
    });
  });

  it('never matches a stored value that is not a PHC Argon2id string, and does not throw', async () => {
    for (const stored of [
      '',
      'plain',
      '$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaA',
      'x'.repeat(5000),
    ]) {
      expect(await hasher.verify('anything at all', stored)).toEqual({
        ok: false,
        needsRehash: false,
      });
    }
  });

  it('verifies against the dummy hash without matching anything', async () => {
    expect(parsePhc(hasher.dummyHash)).toMatchObject(argon2Parameters);
    expect((await hasher.verify('correct horse battery staple', hasher.dummyHash)).ok).toBe(false);
  });

  it('hashes in under 150 ms here (plan item B)', async () => {
    const started = performance.now();
    await hasher.hash('a timing measurement password');
    const elapsed = performance.now() - started;
    console.info(`argon2id hash: ${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(150);
  });
});

describe('parsePhc', () => {
  const salt = 'c2FsdHNhbHRzYWx0c2FsdA';
  const hash = 'aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
  it.each([
    `$argon2id$v=19$m=262145,t=2,p=1$${salt}$${hash}`,
    `$argon2id$v=19$m=19456,t=11,p=1$${salt}$${hash}`,
    `$argon2id$v=19$m=19456,t=2,p=9$${salt}$${hash}`,
    `$argon2id$v=19$m=16,t=2,p=4$${salt}$${hash}`,
    `$argon2id$v=16$m=19456,t=2,p=1$${salt}$${hash}`,
    `$argon2id$v=19$m=019456,t=2,p=1$${salt}$${hash}`,
    `$argon2id$v=19$m=19456,t=2,p=1$${salt}$${hash}=`,
  ])('refuses %s', (value) => {
    expect(parsePhc(value)).toBeUndefined();
  });
});

describe('BreachedPasswords', () => {
  const bundled = BreachedPasswords.bundled();

  it('holds the 1,212 digests of the bundled list', () => {
    expect(bundled.size).toBe(1212);
  });

  it('finds an entry of the NCSC list and misses one that is not on it', () => {
    expect(bundled.has('1qaz2wsx3edc')).toBe(true);
    expect(bundled.has('q1w2e3r4t5y6')).toBe(true);
    expect(bundled.has('1qaz2wsx3edC')).toBe(false);
    expect(bundled.has(randomBytes(16).toString('base64'))).toBe(false);
  });

  it('refuses a list that is empty, ragged or unsorted', () => {
    const digest = (text: string) => createHash('sha1').update(text).digest();
    const [a, b] = [digest('a'), digest('b')].sort((x, y) => Buffer.compare(x, y)) as [
      Buffer,
      Buffer,
    ];
    expect(() => new BreachedPasswords(Buffer.alloc(0))).toThrow();
    expect(() => new BreachedPasswords(Buffer.alloc(21))).toThrow();
    expect(() => new BreachedPasswords(Buffer.concat([b, a]))).toThrow();
    expect(new BreachedPasswords(Buffer.concat([a, b])).has('a')).toBe(true);
  });
});

describe('passwordProblem', () => {
  const none = { has: () => false };
  it('counts characters, not bytes or UTF-16 units', () => {
    expect(passwordProblem('a'.repeat(11), none)).toBe('too_short');
    expect(passwordProblem('a'.repeat(12), none)).toBeUndefined();
    expect(passwordProblem('🔑'.repeat(11), none)).toBe('too_short');
    expect(passwordProblem('كلمة مرور طويلة', none)).toBeUndefined();
    expect(passwordProblem('a'.repeat(256), none)).toBeUndefined();
    expect(passwordProblem('a'.repeat(257), none)).toBe('too_long');
  });

  it('has no composition rule but refuses a breached password', () => {
    expect(passwordProblem('aaaaaaaaaaaaaaaa', none)).toBeUndefined();
    expect(passwordProblem('1qaz2wsx3edc', BreachedPasswords.bundled())).toBe('breached');
  });
});
