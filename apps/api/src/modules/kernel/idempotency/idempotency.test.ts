import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { IdempotencyClaim, IdempotencyStore, StoredKey } from './idempotency.js';
import { reserve } from './idempotency.js';
import {
  canonicalJson,
  defaultSecretFields,
  idempotencyHmacKey,
  requestHash,
  stripSecrets,
} from './request-hash.js';

const hmacKey = idempotencyHmacKey('a-test-signing-key-with-enough-distinct-chars');
const hash = (body: unknown, path = '/v1/driver/cash/handovers') =>
  requestHash({ method: 'POST', path, body, hmacKey });

describe('request hash (plan 2.8)', () => {
  it('ignores key order at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}',
    );
    expect(hash({ a: 1, b: { c: 2, d: 3 } })).toEqual(hash({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('differs by method, path and body', () => {
    const base = hash({ amount: 100 });
    expect(hash({ amount: 101 })).not.toEqual(base);
    expect(hash({ amount: 100 }, '/v1/driver/cash/handovers?x=1')).not.toEqual(base);
    expect(
      requestHash({
        method: 'PUT',
        path: '/v1/driver/cash/handovers',
        body: { amount: 100 },
        hmacKey,
      }),
    ).not.toEqual(base);
  });

  it('is keyed (adversary M-2): another server key is another hash, a bare SHA-256 never matches', () => {
    const body = { amount: 100, cash_pin: '1234' };
    const other = idempotencyHmacKey('another-signing-key-with-enough-distinct-chars');
    expect(requestHash({ method: 'POST', path: '/p', body, hmacKey: other })).not.toEqual(
      requestHash({ method: 'POST', path: '/p', body, hmacKey }),
    );
    const bare = createHash('sha256')
      .update(canonicalJson({ method: 'POST', path: '/p', body }))
      .digest();
    expect(requestHash({ method: 'POST', path: '/p', body, hmacKey })).not.toEqual(bare);
    expect(requestHash({ method: 'POST', path: '/p', body, hmacKey })).toEqual(
      createHmac('sha256', hmacKey)
        .update(canonicalJson({ method: 'POST', path: '/p', body }))
        .digest(),
    );
  });

  it('covers secret fields: another secret is another hash', () => {
    expect(hash({ amount: 100, cash_pin: '1234' })).toEqual(
      hash({ amount: 100, cash_pin: '1234' }),
    );
    expect(hash({ amount: 100, cash_pin: '1234' })).not.toEqual(
      hash({ amount: 100, cash_pin: '9999' }),
    );
    expect(hash({ amount: 100, cash_pin: '1234' })).not.toEqual(hash({ amount: 100 }));
  });

  it('removes secrets at any depth and never keeps them in the stripped value', () => {
    const stripped = stripSecrets(
      { user: { password: 'hunter2', name: 'x' }, keys: [{ api_key: 'k1', label: 'a' }] },
      defaultSecretFields,
    );
    expect(stripped.value).toEqual({ user: { name: 'x' }, keys: [{ label: 'a' }] });
    expect(stripped.secrets).toEqual([
      ['/keys/0/api_key', 'k1'],
      ['/user/password', 'hunter2'],
    ]);
    expect(canonicalJson(stripped.value)).not.toContain('hunter2');
  });

  it('derives a stable 32-byte key distinct from the signing key', () => {
    expect(hmacKey).toHaveLength(32);
    expect(idempotencyHmacKey('a-test-signing-key-with-enough-distinct-chars')).toEqual(hmacKey);
    expect(idempotencyHmacKey('another-signing-key-with-enough-distinct-chs')).not.toEqual(hmacKey);
  });
});

/** An in-memory store with the semantics of the SQL one, to pin the reserve decisions. */
function memoryStore(existing?: Partial<StoredKey>, locked = false): IdempotencyStore {
  return {
    lock: () => Promise.resolve(!locked),
    insert: () => Promise.resolve(existing === undefined ? 'new-id' : undefined),
    find: () =>
      Promise.resolve(
        existing === undefined
          ? undefined
          : {
              id: 'old-id',
              requestHash: Buffer.from('h1'),
              state: 'completed',
              responseStatus: 201,
              responseBody: { id: 'r1' },
              expired: false,
              ...existing,
            },
      ),
    restart: () => Promise.resolve(),
    complete: () => Promise.resolve(),
  };
}

const claim: IdempotencyClaim = {
  principalType: 'staff',
  principalId: 'p',
  key: 'k',
  route: 'POST /x',
  requestHash: Buffer.from('h1'),
};

describe('reserve (data §5.1)', () => {
  it('reserves a new key', async () => {
    expect(await reserve(memoryStore(), claim)).toEqual({ kind: 'reserved', id: 'new-id' });
  });

  it('answers in_progress while another request holds the key', async () => {
    expect(await reserve(memoryStore(undefined, true), claim)).toEqual({ kind: 'in_progress' });
  });

  it('replays a completed key with the same hash', async () => {
    expect(await reserve(memoryStore({}), claim)).toEqual({
      kind: 'replay',
      status: 201,
      body: { id: 'r1' },
    });
  });

  it('refuses the same key with another request', async () => {
    const other = { ...claim, requestHash: Buffer.from('h2') };
    expect(await reserve(memoryStore({}), other)).toEqual({ kind: 'reused' });
  });

  it('restarts an expired key the purge has not removed yet', async () => {
    const other = { ...claim, requestHash: Buffer.from('h2') };
    expect(await reserve(memoryStore({ expired: true }), other)).toEqual({
      kind: 'reserved',
      id: 'old-id',
    });
  });
});
