import type {
  ConsumerList,
  Envelope,
  OutboxRow,
  PlatformListOutbox200,
} from '@eeasy-logistics/contracts/platform/schemas';
import type { OutboxMetadata, OutboxRecord } from './outbox-list.js';

// core_outbox rows to the contract's `OutboxRow` and the consumer counts to `ConsumerList` (PLAT-8
// plan 2.7; A-17). Every row carries its metadata; the envelope, which holds the payload, only
// when the caller read the row through the door of its account. `last_error` and `supersede_key`
// may hold personal data (`pii:` in 0007), so a row read without the door leaves them out too.

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

function isRecord(row: OutboxMetadata | OutboxRecord): row is OutboxRecord {
  return Object.hasOwn(row, 'payload');
}

function envelopeOf(row: OutboxRecord, accountId: string): Envelope {
  const payload = row.payload;
  return {
    id: row.id,
    type: row.type,
    version: row.eventVersion,
    occurred_at: row.occurredAt.toISOString(),
    account_id: accountId,
    aggregate_type: row.aggregateType,
    aggregate_id: row.aggregateId,
    sequence: row.sequence,
    causation_id: row.causationId,
    // A chain's first event correlates to itself (domain model §6.1) when the writer had no
    // request id to carry.
    correlation_id: row.correlationId ?? row.id,
    payload:
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : { value: payload },
  };
}

/**
 * `withEnvelope`: the caller holds the door of the row's account. A row read without it (or a
 * platform-only row, which no door opens on) is metadata only.
 */
export function presentOutboxRow(
  row: OutboxMetadata | OutboxRecord,
  options: { readonly withEnvelope: boolean },
): OutboxRow {
  const full = options.withEnvelope && isRecord(row) && row.accountId !== null;
  const base: OutboxRow = {
    id: row.id,
    account_id: row.accountId,
    type: row.type,
    aggregate_type: row.aggregateType,
    aggregate_id: row.aggregateId,
    sequence: row.sequence,
    created_at: row.createdAt.toISOString(),
    enqueued_at: iso(row.enqueuedAt),
    done_at: iso(row.doneAt),
    kind: row.kind,
    status: row.status,
    attempts: row.attempts,
    next_attempt_at: iso(row.nextAttemptAt),
  };
  if (!full || row.accountId === null) return base;
  return {
    ...base,
    last_error: row.lastError,
    supersede_key: row.supersedeKey,
    envelope: envelopeOf(row, row.accountId),
  };
}

export function presentOutboxPage(
  rows: readonly (OutboxMetadata | OutboxRecord)[],
  nextCursor: string | null,
  options: { readonly withEnvelope: boolean },
): PlatformListOutbox200 {
  return {
    data: rows.map((row) => presentOutboxRow(row, options)),
    next_cursor: nextCursor,
  };
}

export interface ConsumerCounts {
  readonly consumer: string;
  readonly lagSeconds: number;
  readonly parked: number;
  readonly dead: number;
}

export function presentConsumers(counts: readonly ConsumerCounts[]): ConsumerList {
  return {
    data: counts.map((c) => ({
      consumer: c.consumer,
      lag_seconds: c.lagSeconds,
      parked: c.parked,
      dead: c.dead,
    })),
  };
}
