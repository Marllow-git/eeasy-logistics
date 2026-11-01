import type { UnitOfWork } from '@eeasy-logistics/db';
import { isUuid } from '@eeasy-logistics/db';
import { Injectable } from '@nestjs/common';
import type { PlatformUnitOfWork } from '../platform/outbox.repository.js';
import { PlatformOutbox } from '../platform/outbox.repository.js';
import type { OutboxKind } from '../schema/outbox.js';
import { outboxKinds } from '../schema/outbox.js';
import type { DomainEvent, DomainEventType, EventPayload } from './domain-event.js';
import { isDomainEventType } from './domain-event.js';
import { nextOutboxId } from './outbox-id.js';
import type { OutboxAppender } from './outbox.repository.js';
import { OutboxRepository } from './outbox.repository.js';

/** What a producer hands the writer. There is no account: it comes from the unit of work only. */
export interface OutboxEntry<TPayload extends EventPayload = EventPayload> {
  readonly type: DomainEventType;
  /** Payload schema version (ADR-0027). */
  readonly version: number;
  /** The aggregate the event belongs to; `version` is its version after the change (K-10). */
  readonly aggregate: { readonly type: string; readonly id: string; readonly version: number };
  readonly payload: TPayload;
  readonly kind: OutboxKind;
  /** A newer row with the same key replaces the pending one (integrations §4.3). */
  readonly supersedeKey?: string;
  readonly causationId?: string;
  /** Defaults to the request id of the unit of work, when that is a UUID. */
  readonly correlationId?: string;
}

/** Thrown for an entry the writer refuses; a programming error, never a client's input. */
export class OutboxEntryError extends Error {
  constructor(problem: string) {
    super(`Outbox entry refused: ${problem}`);
    this.name = 'OutboxEntryError';
  }
}

const kinds: ReadonlySet<string> = new Set(outboxKinds);
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2_147_483_647;

function check(entry: OutboxEntry): void {
  if (!isDomainEventType(entry.type)) throw new OutboxEntryError('type is not in the catalogue');
  if (!positive(entry.version)) throw new OutboxEntryError('version is not a positive integer');
  if (!kinds.has(entry.kind)) throw new OutboxEntryError('kind is unknown');
  const { aggregate } = entry;
  if (typeof aggregate.type !== 'string' || !/^[a-z]+(_[a-z]+)*$/.test(aggregate.type)) {
    throw new OutboxEntryError('aggregate type is not snake_case');
  }
  if (!isUuid(aggregate.id)) throw new OutboxEntryError('aggregate id is not a UUID');
  if (!positive(aggregate.version)) {
    throw new OutboxEntryError('aggregate version is not a positive integer');
  }
  const { payload } = entry;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new OutboxEntryError('payload is not a JSON object');
  }
  if (entry.supersedeKey !== undefined) {
    if (typeof entry.supersedeKey !== 'string' || entry.supersedeKey.length === 0) {
      throw new OutboxEntryError('supersede key is empty');
    }
  }
  for (const [name, value] of [
    ['causation id', entry.causationId],
    ['correlation id', entry.correlationId],
  ] as const) {
    if (value !== undefined && !isUuid(value)) throw new OutboxEntryError(`${name} is not a UUID`);
  }
}

/** A tenant unit of work carries an account; a platform one does not (`@eeasy-logistics/db`). */
function isTenantUnitOfWork(uow: UnitOfWork | PlatformUnitOfWork): uow is UnitOfWork {
  return uow.context !== null && 'accountId' in uow.context;
}

/**
 * The only writer of `core_outbox` (ADR-0024, ADR-0027; PLAT-8 plan 2.2). Every side effect leaves
 * the business transaction as a row written here, in the caller's unit of work, so the row and
 * the business change commit or roll back together (K-10). The account comes from the unit of
 * work alone: a tenant one (staff, driver, the cross-tenant door) writes for its account; a
 * platform one writes a platform-only row (`account_id` NULL). `sequence` is the aggregate's
 * version the caller passes (no sequence table). A supersede key first marks the pending row of
 * that key `superseded`, in the same transaction. The insert wakes the relay through the table's
 * `NOTIFY elx_outbox` trigger, delivered by PostgreSQL on commit only. No external call is made.
 */
@Injectable()
export class OutboxWriter {
  async enqueue<TPayload extends EventPayload>(
    uow: UnitOfWork | PlatformUnitOfWork,
    entry: OutboxEntry<TPayload>,
  ): Promise<DomainEvent<TPayload>> {
    check(entry);
    let appender: OutboxAppender;
    let accountId: string | null;
    let requestId: string | undefined;
    if (isTenantUnitOfWork(uow)) {
      appender = new OutboxRepository(uow);
      accountId = uow.context.accountId;
      requestId = uow.context.requestId;
    } else {
      appender = new PlatformOutbox(uow);
      accountId = null;
      requestId = uow.context?.requestId;
    }

    const event = {
      id: nextOutboxId(),
      type: entry.type,
      version: entry.version,
      accountId,
      aggregateType: entry.aggregate.type,
      aggregateId: entry.aggregate.id,
      sequence: entry.aggregate.version,
      causationId: entry.causationId ?? null,
      correlationId: entry.correlationId ?? (isUuid(requestId) ? requestId : null),
      payload: entry.payload,
    };
    if (entry.supersedeKey !== undefined) await appender.supersedePending(entry.supersedeKey);
    const occurredAt = await appender.append({
      id: event.id,
      type: event.type,
      eventVersion: event.version,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      sequence: event.sequence,
      causationId: event.causationId,
      correlationId: event.correlationId,
      payload: event.payload,
      kind: entry.kind,
      supersedeKey: entry.supersedeKey ?? null,
    });
    return Object.freeze({ ...event, occurredAt });
  }
}
