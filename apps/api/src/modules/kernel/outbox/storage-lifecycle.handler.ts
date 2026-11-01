import { createHash } from 'node:crypto';
import type { AuditSink } from '../audit/audit-sink.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import type { KindHandler, KindOutcome, OutboxRow } from './kind-handlers.js';

// The `storage_lifecycle` kind (ADR-0036; integrations §2.6, §4.1; PLAT-8 plan 2.5): one row is a
// batch of up to 1,000 object keys to delete, written by the retention scheduler or the account
// closure tool. The handler checks the batch, calls `ObjectStorage.deleteMany`, then writes one
// audit row per executed batch, committed on its own (platform §6: every deletion is audited).

export const storageBatchMax = 1_000;
export const storageKeyMaxLength = 1_024;
export const storageAuditAction = 'core.storage_objects.deleted';
/** Keys listed in the audit row up to this many bytes (the audit document caps at 32 KB). */
export const auditedKeysMaxBytes = 24 * 1024;

/**
 * The audit `after` of a deleted batch: the count and a SHA-256 of the keys (sorted, one per
 * line) always; the keys themselves when they fit, else the first and last (the row's payload
 * keeps the full list until pruning). The fields say `objects`, not `keys`: the audit redaction
 * treats any field named `key`/`keys` as a secret.
 */
export function deletedBatchAudit(keys: readonly string[]): Record<string, unknown> {
  const sorted = [...keys].sort();
  const sha256 = createHash('sha256').update(sorted.join('\n')).digest('hex');
  const bytes = Buffer.byteLength(JSON.stringify(sorted), 'utf8');
  return bytes <= auditedKeysMaxBytes
    ? { count: sorted.length, objects_sha256: sha256, objects: sorted }
    : {
        count: sorted.length,
        objects_sha256: sha256,
        first_object: sorted[0],
        last_object: sorted.at(-1),
        objects_listed: false,
      };
}

/**
 * The keys of a row's payload `{ keys: string[] }`, or why the batch is refused. Every key must
 * sit under the row's own account prefix `acc/{account_id}/` (integrations §2.6 layout), or under
 * `platform/` for a row without an account, with no empty, `.` or `..` segment: a row can never
 * delete another account's objects.
 */
export function batchKeys(row: Pick<OutboxRow, 'accountId' | 'payload'>): string[] | string {
  const payload = row.payload as { keys?: unknown } | null;
  const keys = payload !== null && typeof payload === 'object' ? payload.keys : undefined;
  if (!Array.isArray(keys) || keys.length === 0) return 'payload.keys must be a non-empty array';
  if (keys.length > storageBatchMax) return `payload.keys holds more than ${storageBatchMax} keys`;
  const prefix = row.accountId === null ? 'platform/' : `acc/${row.accountId}/`;
  for (const key of keys) {
    if (typeof key !== 'string' || key.length > storageKeyMaxLength || !key.startsWith(prefix)) {
      return `every key must be a string under ${row.accountId === null ? 'platform/' : 'the row account prefix'}`;
    }
    if (key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
      return 'a key has an empty, "." or ".." segment';
    }
  }
  return [...new Set(keys as string[])];
}

export class StorageLifecycleHandler implements KindHandler {
  readonly kind = 'storage_lifecycle' as const;

  constructor(
    private readonly storage: ObjectStorage,
    private readonly audit: Pick<AuditSink, 'recordCommitted'>,
  ) {}

  /** No ordering (integrations §4.1). */
  orderingKey(): null {
    return null;
  }

  /**
   * A refused batch is dead at once (retrying cannot fix it) and deletes nothing. A storage or
   * audit failure throws: the batch is retried whole (`deleteMany` tolerates gone keys) and the
   * audit row is written only after the deletion succeeded.
   */
  async execute(row: OutboxRow): Promise<KindOutcome> {
    const keys = batchKeys(row);
    if (typeof keys === 'string') {
      return { outcome: 'dead', error: { status: 'invalid_batch', message: keys } };
    }
    await this.storage.deleteMany(keys);
    await this.audit.recordCommitted({
      actorType: 'system',
      actorId: null,
      accountId: row.accountId,
      targetType: 'outbox_row',
      targetId: row.id,
      action: storageAuditAction,
      after: deletedBatchAudit(keys),
      requestId: row.id,
    });
    return { outcome: 'done' };
  }
}
