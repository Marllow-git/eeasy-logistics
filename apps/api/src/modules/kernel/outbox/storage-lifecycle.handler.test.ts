import { describe, expect, it, vi } from 'vitest';
import { StubObjectStorage, StubStorageRefused } from '../storage/object-storage.js';
import type { OutboxRow } from './kind-handlers.js';
import {
  StorageLifecycleHandler,
  batchKeys,
  deletedBatchAudit,
  storageAuditAction,
} from './storage-lifecycle.handler.js';

// PLAT-8 item E: the storage_lifecycle handler with the stub adapter (plan 2.5; ADR-0036).

const account = '0190f0b2-7c4e-7a10-8000-000000000001';
const other = '0190f0b2-7c4e-7a10-8000-000000000002';
const rowOf = (payload: unknown, accountId: string | null = account) =>
  ({ id: '0190f0b2-7c4e-7a10-8000-0000000000aa', accountId, payload }) as OutboxRow;

describe('the stub object storage', () => {
  it('exists only in local and ci', () => {
    expect(() => new StubObjectStorage('local')).not.toThrow();
    expect(() => new StubObjectStorage('ci')).not.toThrow();
    expect(() => new StubObjectStorage('staging')).toThrow(StubStorageRefused);
    expect(() => new StubObjectStorage('production')).toThrow(StubStorageRefused);
  });
});

describe('batchKeys', () => {
  it('accepts keys under the row account prefix, deduplicated', () => {
    const a = `acc/${account}/proofs/2026/11/a`;
    expect(batchKeys(rowOf({ keys: [a, a] }))).toEqual([a]);
    expect(batchKeys(rowOf({ keys: ['platform/x'] }, null))).toEqual(['platform/x']);
  });

  it("refuses another account's key, traversal, an empty or oversized batch", () => {
    for (const keys of [
      [`acc/${other}/proofs/a`],
      [`acc/${account}/../${other}/a`],
      [`acc/${account}//a`],
      ['platform/x'],
      [],
      Array.from({ length: 1_001 }, (_, i) => `acc/${account}/x/${i}`),
      [42],
    ]) {
      expect(typeof batchKeys(rowOf({ keys }))).toBe('string');
    }
    expect(typeof batchKeys(rowOf({ keys: [`acc/${account}/a`] }, null))).toBe('string');
    expect(typeof batchKeys(rowOf(null))).toBe('string');
  });
});

describe('StorageLifecycleHandler', () => {
  it('deletes the batch, then audits it through recordCommitted', async () => {
    const storage = new StubObjectStorage('ci');
    const recordCommitted = vi.fn(() => Promise.resolve());
    const handler = new StorageLifecycleHandler(storage, { recordCommitted });
    const keys = [`acc/${account}/exports/2`, `acc/${account}/exports/1`];
    expect(await handler.execute(rowOf({ keys }))).toEqual({ outcome: 'done' });
    expect(storage.deleted).toEqual(keys);
    expect(recordCommitted).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'system',
        actorId: null,
        accountId: account,
        targetType: 'outbox_row',
        targetId: rowOf(null).id,
        action: storageAuditAction,
        requestId: rowOf(null).id,
      }),
    );
    expect(recordCommitted.mock.calls[0]).toMatchObject([
      { after: { count: 2, objects: [...keys].sort() } },
    ]);
  });

  it('is dead at once on a refused batch, deleting and auditing nothing', async () => {
    const storage = new StubObjectStorage('ci');
    const recordCommitted = vi.fn(() => Promise.resolve());
    const handler = new StorageLifecycleHandler(storage, { recordCommitted });
    const outcome = await handler.execute(rowOf({ keys: [`acc/${other}/a`] }));
    expect(outcome).toMatchObject({ outcome: 'dead', error: { status: 'invalid_batch' } });
    expect(storage.deleted).toEqual([]);
    expect(recordCommitted).not.toHaveBeenCalled();
  });

  it('lists the keys in the audit row only while they fit', () => {
    const many = Array.from({ length: 1_000 }, (_, i) => `acc/${account}/proofs/2026/11/${i}`);
    const audit = deletedBatchAudit(many);
    expect(audit).toMatchObject({ count: 1_000, objects_listed: false });
    expect(audit['objects_sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(audit).length).toBeLessThan(32 * 1024);
  });
});
